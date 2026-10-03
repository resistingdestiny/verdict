import { toTransactionId } from "../../../nextjs/lib/mirror";

/**
 * HashScan links for Hedera testnet and the mirror node lookups the evidence ledger needs: the
 * `0.0.x@seconds.nanos` transaction id behind an EVM transaction hash, the gas it used and the HBAR
 * it was charged, and the execution record of a schedule entity.
 *
 * Everything here is read-only against the public mirror node. `HEDERA_MIRROR_URL` overrides the
 * base URL.
 */

export const HASHSCAN_TESTNET = "https://hashscan.io/testnet";
export const MIRROR_BASE_URL = (process.env.HEDERA_MIRROR_URL ?? "https://testnet.mirrornode.hedera.com").replace(
  /\/$/,
  "",
);

/** Link to a contract page by EVM address or `0.0.x` id. */
export function hashscanContract(addressOrId: string): string {
  return `${HASHSCAN_TESTNET}/contract/${addressOrId}`;
}

/** Link to a token page by EVM address or `0.0.x` id. */
export function hashscanToken(addressOrId: string): string {
  return `${HASHSCAN_TESTNET}/token/${addressOrId}`;
}

/** Link to an account page by EVM address or `0.0.x` id. */
export function hashscanAccount(addressOrId: string): string {
  return `${HASHSCAN_TESTNET}/account/${addressOrId}`;
}

/** Link to a transaction page by EVM hash or `0.0.x@seconds.nanos` id. */
export function hashscanTransaction(hashOrId: string): string {
  return `${HASHSCAN_TESTNET}/transaction/${hashOrId}`;
}

/** Link to a schedule entity by `0.0.x` id. */
export function hashscanSchedule(scheduleId: string): string {
  return `${HASHSCAN_TESTNET}/schedule/${scheduleId}`;
}

/** Link to an HCS topic by `0.0.x` id. */
export function hashscanTopic(topicId: string): string {
  return `${HASHSCAN_TESTNET}/topic/${topicId}`;
}

/**
 * The `0.0.x` id of a long-zero EVM address (the form HTS tokens, schedules and system entities use),
 * or null when the address is not long-zero.
 */
export function longZeroToEntityId(evmAddress: string): string | null {
  const hex = evmAddress.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(hex) || !hex.startsWith("000000000000000000000000")) return null;
  return `0.0.${BigInt(`0x${hex.slice(24)}`).toString()}`;
}

/** The mirror node form of a transaction id: `0.0.x-seconds-nanos` instead of `0.0.x@seconds.nanos`. */
export function mirrorTransactionId(transactionId: string): string {
  const [account, stamp] = transactionId.split("@");
  if (!account || !stamp) throw new Error(`Not a transaction id: ${transactionId}`);
  const [seconds, nanos = "0"] = stamp.split(".");
  return `${account}-${seconds}-${nanos}`;
}

export class MirrorLookupError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = "MirrorLookupError";
  }
}

async function mirrorGet<T>(path: string): Promise<T> {
  const url = `${MIRROR_BASE_URL}${path}`;
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { accept: "application/json" } });
  } catch (e) {
    throw new MirrorLookupError(url, null, `Mirror node request failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) throw new MirrorLookupError(url, res.status, `Mirror node answered ${res.status} for ${url}`);
  return (await res.json()) as T;
}

type MirrorContractResultRecord = {
  from: string;
  to: string | null;
  hash: string;
  timestamp: string;
  result: string;
  status: string;
  gas_used: number;
  contract_id: string | null;
};

type MirrorTransactionRecord = {
  transaction_id: string;
  charged_tx_fee: number;
  consensus_timestamp: string;
  result: string;
  name: string;
  nonce: number;
  scheduled: boolean;
};

export type TransactionEvidence = {
  /** `0.0.x@seconds.nanos`, the id HashScan resolves. */
  transactionId: string;
  /** Gas the EVM call consumed. */
  gasUsed: number;
  /** Tinybars charged across the transaction and its children (HTS token creations inside a call show up as children). */
  chargedTinybars: bigint;
  /** How many records the mirror node returned for the id: 1 for a plain call, more when the call created entities. */
  recordCount: number;
  /** Mirror consensus timestamp, `seconds.nanos`. */
  consensusTimestamp: string;
  /** The mirror node's result string, `SUCCESS` for a call that did not revert. */
  result: string;
};

/**
 * Turns an EVM transaction hash into its Hedera transaction id and reads what it cost. The mirror node
 * lags consensus by a few seconds, so the lookup retries on 404 for up to `maxWaitMs`.
 */
export async function transactionEvidence(txHash: string, maxWaitMs = 45_000): Promise<TransactionEvidence> {
  const deadline = Date.now() + maxWaitMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const result = await mirrorGet<MirrorContractResultRecord>(`/api/v1/contracts/results/${txHash}`);
      // An EVM transaction relayed through the JSON-RPC relay is paid by the relay's account with its own
      // valid-start time, so the Hedera id cannot be derived from the sender; the mirror node finds it by
      // consensus timestamp instead.
      const byTimestamp = await mirrorGet<{ transactions: MirrorTransactionRecord[] }>(
        `/api/v1/transactions?timestamp=${result.timestamp}`,
      );
      const parent = byTimestamp.transactions[0];
      if (!parent) throw new MirrorLookupError(txHash, 404, `No transaction at ${result.timestamp}`);
      const [payer, seconds, nanos] = parent.transaction_id.split("-");
      const transactionId = `${payer}@${seconds}.${nanos}`;
      const records = await mirrorGet<{ transactions: MirrorTransactionRecord[] }>(
        `/api/v1/transactions/${parent.transaction_id}`,
      );
      const chargedTinybars = records.transactions.reduce((sum, t) => sum + BigInt(t.charged_tx_fee), 0n);
      return {
        transactionId,
        gasUsed: result.gas_used,
        chargedTinybars,
        recordCount: records.transactions.length,
        consensusTimestamp: result.timestamp,
        result: result.result,
      };
    } catch (e) {
      lastError = e;
      const retryable = e instanceof MirrorLookupError && (e.status === 404 || e.status === null);
      if (!retryable) throw e;
      await new Promise(resolve => setTimeout(resolve, 3_000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Mirror node has no record of ${txHash}`);
}

export type ScheduleExecution = {
  scheduleId: string;
  executed: boolean;
  /** `seconds.nanos` of the scheduled execution, or null when it has not run. */
  executedTimestamp: string | null;
  /** The scheduled transaction's id, or null when it has not run. */
  transactionId: string | null;
  /** Tinybars the scheduled transaction was charged, or null when it has not run. */
  chargedTinybars: bigint | null;
  /** Gas the scheduled call used, when a contract result exists for it. */
  gasUsed: number | null;
};

type MirrorSchedule = {
  schedule_id: string;
  executed_timestamp: string | null;
  deleted: boolean;
  payer_account_id: string | null;
  creator_account_id: string | null;
};

/**
 * Reads a schedule entity and, once it has executed, the scheduled transaction it produced. The
 * `transactionId` is what `docs/EVIDENCE.md` links for the "no account sent it" row.
 */
export async function scheduleExecution(scheduleId: string, contractAddress: string): Promise<ScheduleExecution> {
  const schedule = await mirrorGet<MirrorSchedule>(`/api/v1/schedules/${scheduleId}`);
  if (!schedule.executed_timestamp) {
    return {
      scheduleId,
      executed: false,
      executedTimestamp: null,
      transactionId: null,
      chargedTinybars: null,
      gasUsed: null,
    };
  }
  const ts = schedule.executed_timestamp;
  const records = await mirrorGet<{ transactions: MirrorTransactionRecord[] }>(`/api/v1/transactions?timestamp=${ts}`);
  const scheduled = records.transactions.find(t => t.scheduled) ?? records.transactions[0] ?? null;
  let gasUsed: number | null = null;
  try {
    const results = await mirrorGet<{ results: { gas_used: number }[] }>(
      `/api/v1/contracts/${contractAddress}/results?timestamp=${ts}`,
    );
    gasUsed = results.results[0]?.gas_used ?? null;
  } catch {
    gasUsed = null;
  }
  return {
    scheduleId,
    executed: true,
    executedTimestamp: ts,
    transactionId: scheduled ? scheduled.transaction_id : null,
    chargedTinybars: scheduled ? BigInt(scheduled.charged_tx_fee) : null,
    gasUsed,
  };
}

export type TopicMessageEvidence = {
  sequenceNumber: number;
  consensusTimestamp: string;
  transactionId: string;
  text: string;
};

type MirrorTopicMessageRecord = {
  consensus_timestamp: string;
  sequence_number: number;
  message: string;
  payer_account_id: string;
};

/**
 * Lists a topic's messages (oldest first) with the transaction id of each submission, so the evidence
 * table can link the HCS record messages of one market.
 */
export async function topicMessages(topicId: string, limit = 100): Promise<TopicMessageEvidence[]> {
  const out: TopicMessageEvidence[] = [];
  let path: string | null = `/api/v1/topics/${topicId}/messages?order=asc&limit=${limit}`;
  while (path) {
    const page: { messages: MirrorTopicMessageRecord[]; links?: { next?: string | null } } = await mirrorGet(path);
    for (const m of page.messages) {
      out.push({
        sequenceNumber: m.sequence_number,
        consensusTimestamp: m.consensus_timestamp,
        transactionId: toTransactionId(m.payer_account_id, m.consensus_timestamp),
        text: Buffer.from(m.message, "base64").toString("utf8"),
      });
    }
    path = page.links?.next ?? null;
  }
  return out;
}
