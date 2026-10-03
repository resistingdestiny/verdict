import { NextResponse } from "next/server";
import { AccountId, Client, PrivateKey, TopicId, TopicMessageSubmitTransaction } from "@hiero-ledger/sdk";
import { type AbiEvent, decodeEventLog, toEventSelector } from "viem";
import {
  MarketCreatedEventArgs,
  RecordMessage,
  ResolvedEventArgs,
  VoidedEventArgs,
  ZERO_ADDRESS,
  buildMarketCreatedMessage,
  buildResolvedMessage,
  buildVoidedMessage,
  messageKey,
  parseMessageKey,
  serializeMessage,
} from "~~/app/api/_lib/messages";
import { DeployedContract, RESOLVER_ABI, getDeployedContract, verdictPublicClient } from "~~/app/api/_lib/verdict";
import {
  MirrorError,
  evmToContractId,
  evmToHederaId,
  getAllContractLogs,
  getAllTopicMessages,
  getContractResultByHash,
  transactionIdAt,
} from "~~/lib/mirror";
import verdictConfig from "~~/verdict.config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;

const hitsByIp = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hitsByIp.get(ip) ?? []).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) {
    hitsByIp.set(ip, recent);
    return true;
  }
  recent.push(now);
  hitsByIp.set(ip, recent);
  return false;
}

function jsonError(status: number, error: string, detail?: string) {
  return NextResponse.json({ error, ...(detail ? { detail } : {}) }, { status });
}

function eventSelector(abi: unknown, name: string): `0x${string}` | null {
  const list = abi as readonly { type: string; name?: string }[];
  const entry = list.find(e => e.type === "event" && e.name === name);
  return entry ? toEventSelector(entry as unknown as AbiEvent) : null;
}

/** The `0.0.x@seconds.nanos` id of the transaction behind a mirror transaction hash. */
/** A 0x-prefixed 32-byte hex key is ECDSA; `PrivateKey.fromString` would read it as ED25519. */
function operatorPrivateKey(key: string): PrivateKey {
  return /^(0x)?[0-9a-fA-F]{64}$/.test(key) ? PrivateKey.fromStringECDSA(key) : PrivateKey.fromString(key);
}

async function transactionIdFor(txHash: string): Promise<string | null> {
  const result = await getContractResultByHash(txHash, { baseUrl: verdictConfig.mirrorNodeUrl });
  return transactionIdAt(result.timestamp, { baseUrl: verdictConfig.mirrorNodeUrl });
}

async function feedName(resolver: string, feedId: `0x${string}`): Promise<string | null> {
  try {
    return await verdictPublicClient.readContract({
      address: resolver as `0x${string}`,
      abi: RESOLVER_ABI,
      functionName: "describe",
      args: [feedId],
    });
  } catch {
    // The resolver may be unreachable or not implement describe; the message still records the event data.
    return null;
  }
}

type BuiltRecord = { key: string; message: RecordMessage };

async function buildFromMarketCreated(
  args: MarketCreatedEventArgs,
  txHash: string,
  contractAddress: string,
): Promise<BuiltRecord> {
  const mirror = { baseUrl: verdictConfig.mirrorNodeUrl };
  const [contract, feed, yes, no, schedule, tx] = await Promise.all([
    evmToContractId(contractAddress, mirror),
    feedName(args.resolver, args.feedId),
    evmToHederaId(args.yes, mirror),
    evmToHederaId(args.no, mirror),
    args.schedule.toLowerCase() === ZERO_ADDRESS ? Promise.resolve(null) : evmToHederaId(args.schedule, mirror),
    transactionIdFor(txHash),
  ]);
  const message = buildMarketCreatedMessage(args, { contract, feed, yes, no, schedule, tx });
  return { key: messageKey(message.type, message.market), message };
}

async function buildFromResolved(args: ResolvedEventArgs, txHash: string, decimals: number): Promise<BuiltRecord> {
  const tx = await transactionIdFor(txHash);
  const message = buildResolvedMessage(args, decimals, tx);
  return { key: messageKey(message.type, message.market), message };
}

async function buildFromVoided(args: VoidedEventArgs, txHash: string): Promise<BuiltRecord> {
  const tx = await transactionIdFor(txHash);
  const message = buildVoidedMessage(args, tx);
  return { key: messageKey(message.type, message.market), message };
}

/** Decoded Verdict events of one transaction, in log order. */
async function buildFromTransaction(txHash: string, contract: DeployedContract): Promise<BuiltRecord[]> {
  const result = await getContractResultByHash(txHash, { baseUrl: verdictConfig.mirrorNodeUrl });
  const selectors = {
    MarketCreated: eventSelector(contract.abi, "MarketCreated"),
    Resolved: eventSelector(contract.abi, "Resolved"),
    Voided: eventSelector(contract.abi, "Voided"),
  };
  const out: BuiltRecord[] = [];
  for (const log of result.logs ?? []) {
    if (log.address.toLowerCase() !== contract.address.toLowerCase()) continue;
    const topic0 = log.topics[0];
    try {
      if (topic0 === selectors.MarketCreated) {
        const decoded = decodeEventLog({
          abi: contract.abi,
          data: log.data as `0x${string}`,
          topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
        });
        out.push(
          await buildFromMarketCreated(decoded.args as unknown as MarketCreatedEventArgs, txHash, contract.address),
        );
      } else if (topic0 === selectors.Resolved) {
        const decoded = decodeEventLog({
          abi: contract.abi,
          data: log.data as `0x${string}`,
          topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
        });
        const args = decoded.args as unknown as ResolvedEventArgs;
        const market = await readMarket(args.id);
        out.push(await buildFromResolved(args, txHash, market?.decimals ?? 8));
      } else if (topic0 === selectors.Voided) {
        const decoded = decodeEventLog({
          abi: contract.abi,
          data: log.data as `0x${string}`,
          topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
        });
        out.push(await buildFromVoided(decoded.args as unknown as VoidedEventArgs, txHash));
      }
    } catch (e) {
      if (e instanceof MirrorError) throw e;
      throw new Error(`Failed to build a record message from ${txHash}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}

type MarketView = { status: number; decimals: number };

async function readMarket(id: bigint): Promise<MarketView | null> {
  const contract = getDeployedContract("Verdict");
  if (!contract) return null;
  try {
    const market = (await verdictPublicClient.readContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "getMarket",
      args: [id],
    })) as unknown as MarketView;
    return market;
  } catch {
    return null;
  }
}

/** Find one event log for a market id, oldest first. */
async function findEventLog(contractAddress: string, selector: `0x${string}` | null, marketId: bigint) {
  if (!selector) return null;
  const idTopic = `0x${marketId.toString(16).padStart(64, "0")}` as `0x${string}`;
  const logs = await getAllContractLogs(
    contractAddress,
    { topics: [selector, idTopic], order: "asc", limit: 100 },
    { baseUrl: verdictConfig.mirrorNodeUrl },
  );
  return logs[0] ?? null;
}

/** Every message a market is missing: its terms, and its settlement once settled or void. */
async function buildForMarket(marketId: bigint, contract: DeployedContract): Promise<BuiltRecord[]> {
  const selectors = {
    MarketCreated: eventSelector(contract.abi, "MarketCreated"),
    Resolved: eventSelector(contract.abi, "Resolved"),
    Voided: eventSelector(contract.abi, "Voided"),
  };
  const out: BuiltRecord[] = [];

  const createdLog = await findEventLog(contract.address, selectors.MarketCreated, marketId);
  if (createdLog) {
    const decoded = decodeEventLog({
      abi: contract.abi,
      data: createdLog.data as `0x${string}`,
      topics: createdLog.topics as [`0x${string}`, ...`0x${string}`[]],
    });
    out.push(
      await buildFromMarketCreated(
        decoded.args as unknown as MarketCreatedEventArgs,
        createdLog.transaction_hash,
        contract.address,
      ),
    );
  }

  const market = await readMarket(marketId);
  if (market && market.status === 1) {
    const resolvedLog = await findEventLog(contract.address, selectors.Resolved, marketId);
    if (resolvedLog) {
      const decoded = decodeEventLog({
        abi: contract.abi,
        data: resolvedLog.data as `0x${string}`,
        topics: resolvedLog.topics as [`0x${string}`, ...`0x${string}`[]],
      });
      out.push(
        await buildFromResolved(
          decoded.args as unknown as ResolvedEventArgs,
          resolvedLog.transaction_hash,
          market.decimals,
        ),
      );
    }
  } else if (market && market.status === 2) {
    const voidedLog = await findEventLog(contract.address, selectors.Voided, marketId);
    if (voidedLog) {
      const decoded = decodeEventLog({
        abi: contract.abi,
        data: voidedLog.data as `0x${string}`,
        topics: voidedLog.topics as [`0x${string}`, ...`0x${string}`[]],
      });
      out.push(await buildFromVoided(decoded.args as unknown as VoidedEventArgs, voidedLog.transaction_hash));
    }
  }
  return out;
}

async function existingMessageKeys(topicId: string): Promise<Set<string>> {
  const messages = await getAllTopicMessages(topicId, { order: "asc" }, { baseUrl: verdictConfig.mirrorNodeUrl });
  const keys = new Set<string>();
  for (const m of messages) {
    const key = parseMessageKey(m.text);
    if (key) keys.add(key);
  }
  return keys;
}

async function submitToTopic(
  topicId: string,
  operatorId: string,
  operatorKey: string,
  messages: string[],
): Promise<number[]> {
  const client = Client.forTestnet().setOperator(AccountId.fromString(operatorId), operatorPrivateKey(operatorKey));
  try {
    const sequenceNumbers: number[] = [];
    for (const text of messages) {
      const response = await new TopicMessageSubmitTransaction()
        .setTopicId(TopicId.fromString(topicId))
        .setMessage(text)
        .execute(client);
      const receipt = await response.getReceipt(client);
      sequenceNumbers.push(Number(receipt.topicSequenceNumber));
    }
    return sequenceNumbers;
  } finally {
    client.close();
  }
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (isRateLimited(ip)) {
    return jsonError(429, "Rate limit exceeded", `At most ${RATE_LIMIT_MAX} record requests per minute per IP.`);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "Invalid JSON body");
  }
  const txHash =
    typeof (body as { txHash?: unknown })?.txHash === "string" ? (body as { txHash: string }).txHash : null;
  const marketIdRaw = (body as { marketId?: unknown })?.marketId;
  const marketId =
    typeof marketIdRaw === "number" && Number.isInteger(marketIdRaw) && marketIdRaw >= 0
      ? BigInt(marketIdRaw)
      : typeof marketIdRaw === "string" && /^\d+$/.test(marketIdRaw)
        ? BigInt(marketIdRaw)
        : null;
  if (!txHash && marketId === null) {
    return jsonError(400, "Body must contain a txHash string or a marketId integer");
  }

  const topicId = verdictConfig.hcsTopicId;
  if (!topicId) {
    return jsonError(
      503,
      "HCS topic not configured",
      "verdict.config.ts has no hcsTopicId yet; create the topic first.",
    );
  }
  const operatorId = process.env.HEDERA_OPERATOR_ID;
  const operatorKey = process.env.HEDERA_OPERATOR_KEY;
  if (!operatorId || !operatorKey) {
    return jsonError(
      503,
      "HCS operator not configured",
      "Set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY in the server environment.",
    );
  }

  const contract = getDeployedContract("Verdict");
  if (!contract) {
    return jsonError(
      503,
      "Verdict contract not deployed",
      "No Verdict entry for chain 296 in contracts/deployedContracts.ts.",
    );
  }

  try {
    const built = txHash
      ? await buildFromTransaction(txHash, contract)
      : await buildForMarket(marketId as bigint, contract);
    if (built.length === 0) {
      return jsonError(
        404,
        "No Verdict event found",
        txHash ? `No MarketCreated, Resolved or Voided event in ${txHash}.` : `No events found for market ${marketId}.`,
      );
    }

    const existing = await existingMessageKeys(topicId);
    const fresh = built.filter(b => !existing.has(b.key));
    const skipped = built.filter(b => existing.has(b.key)).map(b => b.key);

    if (fresh.length === 0) {
      return NextResponse.json({ written: [], skipped, topic: topicId });
    }

    const texts = fresh.map(b => serializeMessage(b.message));
    const sequenceNumbers = await submitToTopic(topicId, operatorId, operatorKey, texts);

    return NextResponse.json({
      written: fresh.map((b, i) => ({
        type: b.message.type,
        market: b.message.market,
        sequenceNumber: sequenceNumbers[i],
      })),
      skipped,
      topic: topicId,
    });
  } catch (e) {
    if (e instanceof MirrorError) {
      return jsonError(502, "Mirror node request failed", `${e.code} ${e.status ?? ""} ${e.url}`.trim());
    }
    return jsonError(502, "Record failed", e instanceof Error ? e.message : String(e));
  }
}
