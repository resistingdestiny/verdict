import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import { createRequire } from "module";
import * as path from "path";
import { ethers } from "ethers";

import {
  evmToContractId,
  evmToHederaId,
  getAllContractLogs,
  getAllTopicMessages,
  getContractResultByHash,
  transactionIdAt,
} from "../../nextjs/lib/mirror";
import { isKind, kindName, kindUsesUpper } from "../../nextjs/lib/kinds";

/**
 * Walks every Verdict market and writes any missing HCS record messages.
 *
 * Default mode posts { marketId } to /api/record on VERDICT_APP_URL (default
 * http://localhost:3000), which builds and submits the messages server side.
 * When HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY are set, the script instead
 * builds the messages itself from chain data and submits them directly with
 * the Hiero SDK from the nextjs package.
 *
 * Run with: yarn ts-node scripts/record-sync.ts
 * Testnet only. Untested until a funded operator account is available.
 */

const APP_URL = (process.env.VERDICT_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const RPC_URL = process.env.HEDERA_RPC_URL ?? "https://testnet.hashio.io/api";
const MIRROR_BASE_URL = process.env.HEDERA_MIRROR_URL ?? "https://testnet.mirrornode.hedera.com";
const MESSAGE_MAX_BYTES = 1000;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const MARKET_CREATED_SIG =
  "MarketCreated(uint256,address,address,bytes32,uint8,int256,int256,uint64,uint8,address,address,address,uint256)";
const RESOLVED_SIG = "Resolved(uint256,uint64,int256,uint80,uint64,bool)";
const VOIDED_SIG = "Voided(uint256,address)";

type MarketView = {
  resolver: string;
  feedId: string;
  kind: number;
  status: number;
  decimals: number;
  expiry: bigint;
  lower: bigint;
  upper: bigint;
  yes: string;
  no: string;
  schedule: string;
  payout: bigint;
  answer: bigint;
  roundId: bigint;
  updatedAt: bigint;
  settledBySchedule: boolean;
};

type RecordMessage = Record<string, unknown> & { v: 1; type: string; market: number };

// --- minimal typed surface of the Hiero SDK, loaded from the nextjs package ---

type SdkReceipt = { topicSequenceNumber: { toString(): string } };
type SdkTxResponse = { getReceipt(client: SdkClient): Promise<SdkReceipt> };
type SdkSubmitTx = {
  setTopicId(id: unknown): SdkSubmitTx;
  setMessage(message: string): SdkSubmitTx;
  execute(client: SdkClient): Promise<SdkTxResponse>;
};
type SdkClient = { setOperator(id: unknown, key: unknown): SdkClient; close(): void };
type HieroSdk = {
  Client: { forTestnet(): SdkClient };
  AccountId: { fromString(value: string): unknown };
  PrivateKey: { fromString(value: string): unknown; fromStringECDSA(value: string): unknown };
  TopicId: { fromString(value: string): unknown };
  TopicMessageSubmitTransaction: new () => SdkSubmitTx;
};

function loadSdk(): HieroSdk {
  const requireFromHere = createRequire(__filename);
  return requireFromHere("../../nextjs/node_modules/@hiero-ledger/sdk") as HieroSdk;
}

// --- small format helpers (ports of app/api/_lib/messages.ts) ---

function isoSeconds(unixSeconds: bigint | number): string {
  return new Date(Number(unixSeconds) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function fixed8(value: bigint): string {
  const whole = value / 100_000_000n;
  const frac = (value % 100_000_000n).toString().padStart(8, "0");
  return `${whole.toString()}.${frac}`;
}

function parseMessageKey(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { v?: unknown; type?: unknown; market?: unknown };
    if (parsed.v === 1 && typeof parsed.type === "string" && typeof parsed.market === "number") {
      return `${parsed.type}:${parsed.market}`;
    }
    return null;
  } catch {
    return null;
  }
}

function serialize(message: RecordMessage): string {
  const text = JSON.stringify(message);
  if (text.length > MESSAGE_MAX_BYTES) throw new Error(`Message for market ${message.market} is over 1 KB`);
  return text;
}

// --- repo config ---

function readTopicId(): string | null {
  if (process.env.HCS_TOPIC_ID) return process.env.HCS_TOPIC_ID;
  const configPath = path.join(__dirname, "..", "..", "nextjs", "verdict.config.ts");
  const source = fs.readFileSync(configPath, "utf8");
  const match = source.match(/hcsTopicId:\s*(null|"(0\.0\.\d+)")/);
  return match && match[2] ? match[2] : null;
}

function readVerdictAddress(): string | null {
  if (process.env.VERDICT_ADDRESS) return process.env.VERDICT_ADDRESS;
  const deployedPath = path.join(__dirname, "..", "..", "nextjs", "contracts", "deployedContracts.ts");
  if (!fs.existsSync(deployedPath)) return null;
  const source = fs.readFileSync(deployedPath, "utf8");
  const match = source.match(/Verdict:\s*\{\s*address:\s*"(0x[0-9a-fA-F]{40})"/);
  return match ? match[1] : null;
}

function loadInterfaceAbi(name: string): ethers.InterfaceAbi {
  const artifactPath = path.join(
    __dirname,
    "..",
    "artifacts",
    "contracts",
    "interfaces",
    `${name}.sol`,
    `${name}.json`,
  );
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as { abi: ethers.InterfaceAbi };
  return artifact.abi;
}

// --- mirror helpers ---

async function transactionIdFor(txHash: string): Promise<string | null> {
  const result = await getContractResultByHash(txHash, { baseUrl: MIRROR_BASE_URL });
  return transactionIdAt(result.timestamp, { baseUrl: MIRROR_BASE_URL });
}

async function findEventHash(contractAddress: string, signature: string, marketId: bigint): Promise<string | null> {
  const selector = ethers.id(signature);
  const idTopic = `0x${marketId.toString(16).padStart(64, "0")}`;
  const logs = await getAllContractLogs(
    contractAddress,
    { topics: [selector, idTopic], order: "asc", limit: 100 },
    { baseUrl: MIRROR_BASE_URL },
  );
  return logs[0]?.transaction_hash ?? null;
}

async function existingKeys(topicId: string): Promise<Set<string>> {
  const messages = await getAllTopicMessages(topicId, { order: "asc" }, { baseUrl: MIRROR_BASE_URL });
  const keys = new Set<string>();
  for (const m of messages) {
    const key = parseMessageKey(m.text);
    if (key) keys.add(key);
  }
  return keys;
}

// --- message building from chain data ---

async function buildMarketCreated(id: bigint, market: MarketView, verdictAddress: string): Promise<RecordMessage> {
  let feed: string | null = null;
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const resolver = new ethers.Contract(
      market.resolver,
      ["function describe(bytes32 feedId) view returns (string)"],
      provider,
    );
    feed = (await resolver.describe(market.feedId)) as string;
  } catch {
    // The resolver may not answer; the message still records the event data.
    feed = null;
  }
  const txHash = await findEventHash(verdictAddress, MARKET_CREATED_SIG, id);
  const kind = Number(market.kind);
  const usesUpper = isKind(kind) && kindUsesUpper(kind);
  return {
    v: 1,
    type: "market_created",
    market: Number(id),
    contract: await evmToContractId(verdictAddress, { baseUrl: MIRROR_BASE_URL }),
    feed,
    kind: kindName(kind),
    lower: ethers.formatUnits(market.lower, market.decimals),
    upper: usesUpper ? ethers.formatUnits(market.upper, market.decimals) : null,
    expiry: isoSeconds(market.expiry),
    yes: await evmToHederaId(market.yes, { baseUrl: MIRROR_BASE_URL }),
    no: await evmToHederaId(market.no, { baseUrl: MIRROR_BASE_URL }),
    schedule:
      market.schedule.toLowerCase() === ZERO_ADDRESS
        ? null
        : await evmToHederaId(market.schedule, { baseUrl: MIRROR_BASE_URL }),
    tx: txHash ? await transactionIdFor(txHash) : null,
  };
}

async function buildMarketSettled(id: bigint, market: MarketView, verdictAddress: string): Promise<RecordMessage> {
  const isVoid = Number(market.status) === 2;
  const txHash = await findEventHash(verdictAddress, isVoid ? VOIDED_SIG : RESOLVED_SIG, id);
  return {
    v: 1,
    type: "market_settled",
    market: Number(id),
    yesPayout: fixed8(market.payout),
    roundId: isVoid ? null : market.roundId.toString(),
    answer: isVoid ? null : ethers.formatUnits(market.answer, market.decimals),
    updatedAt: isVoid ? null : isoSeconds(market.updatedAt),
    settledBy: isVoid ? "void" : market.settledBySchedule ? "schedule" : "account",
    tx: txHash ? await transactionIdFor(txHash) : null,
  };
}

// --- the two modes ---

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(30_000), ...init });
  } catch (e) {
    throw new Error(`Could not reach ${url}: ${e instanceof Error ? e.message : String(e)}. Is the app running?`);
  }
  const text = await res.text();
  let data: T & { error?: string };
  try {
    data = JSON.parse(text) as T & { error?: string };
  } catch {
    throw new Error(
      `${url} did not return JSON (status ${res.status}). Is the Verdict app running at VERDICT_APP_URL?`,
    );
  }
  if (!res.ok) throw new Error(`${url} answered ${res.status}: ${data.error ?? res.statusText}`);
  return data;
}

async function syncViaApi(topicId: string): Promise<void> {
  const data = await fetchJson<{ markets?: { id: number; status: string }[] }>(`${APP_URL}/api/markets`);
  if (!data.markets) throw new Error("/api/markets returned no markets array");

  const keys = await existingKeys(topicId);
  const missing = data.markets.filter(
    m =>
      !keys.has(`market_created:${m.id}`) ||
      ((m.status === "Settled" || m.status === "Void") && !keys.has(`market_settled:${m.id}`)),
  );
  console.log(`${missing.length} market(s) with missing record messages.`);
  for (const m of missing) {
    const result = await fetchJson<{ written?: unknown[]; detail?: string }>(`${APP_URL}/api/record`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ marketId: m.id }),
    });
    console.log(`Market ${m.id}: wrote ${result.written?.length ?? 0} message(s).`);
  }
}

async function syncDirect(topicId: string, operatorId: string, operatorKey: string): Promise<void> {
  const verdictAddress = readVerdictAddress();
  if (!verdictAddress) {
    throw new Error("No Verdict address. Set VERDICT_ADDRESS or deploy so deployedContracts.ts gains a Verdict entry.");
  }
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const verdict = new ethers.Contract(verdictAddress, loadInterfaceAbi("IVerdict"), provider);
  const count = (await verdict.marketCount()) as bigint;
  const keys = await existingKeys(topicId);
  console.log(`${count} market(s) on chain.`);

  const sdk = loadSdk();
  const client = sdk.Client.forTestnet().setOperator(
    sdk.AccountId.fromString(operatorId),
    /^(0x)?[0-9a-fA-F]{64}$/.test(operatorKey)
      ? sdk.PrivateKey.fromStringECDSA(operatorKey)
      : sdk.PrivateKey.fromString(operatorKey),
  );
  let written = 0;
  try {
    for (let i = 0n; i < count; i++) {
      const market = (await verdict.getMarket(i)) as unknown as MarketView;
      const pending: RecordMessage[] = [];
      // RECORD_RESEND=4,6 appends a fresh market_created for those ids (an append-only topic cannot edit a
      // message; readers take the latest message per type and market).
      const resend = (process.env.RECORD_RESEND ?? "").split(",").filter(Boolean).map(BigInt);
      if (!keys.has(`market_created:${i}`) || resend.includes(i)) {
        pending.push(await buildMarketCreated(i, market, verdictAddress));
      }
      if ((Number(market.status) === 1 || Number(market.status) === 2) && !keys.has(`market_settled:${i}`)) {
        pending.push(await buildMarketSettled(i, market, verdictAddress));
      }
      for (const message of pending) {
        const response = await new sdk.TopicMessageSubmitTransaction()
          .setTopicId(sdk.TopicId.fromString(topicId))
          .setMessage(serialize(message))
          .execute(client);
        const receipt = await response.getReceipt(client);
        console.log(`Market ${i}: wrote ${message.type} as message #${receipt.topicSequenceNumber.toString()}.`);
        written += 1;
      }
    }
  } finally {
    client.close();
  }
  console.log(`Done: wrote ${written} message(s).`);
}

async function main() {
  const topicId = readTopicId();
  if (!topicId) {
    throw new Error("No HCS topic. Set HCS_TOPIC_ID or create the topic (yarn record:create-topic) first.");
  }
  const operatorId = process.env.HEDERA_OPERATOR_ID;
  const operatorKey = process.env.HEDERA_OPERATOR_KEY;
  if (operatorId && operatorKey) {
    console.log("Operator credentials found: submitting directly with the Hiero SDK.");
    await syncDirect(topicId, operatorId, operatorKey);
  } else {
    console.log(`No operator credentials: posting to ${APP_URL}/api/record instead.`);
    await syncViaApi(topicId);
  }
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
