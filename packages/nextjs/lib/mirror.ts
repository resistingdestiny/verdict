/**
 * Typed fetchers for the Hedera mirror node REST API.
 * HCS is used for order and proof; the mirror node is used for every query.
 * Defaults to the Hedera testnet mirror node. Every fetch has a timeout and
 * raises a MirrorError with a typed code instead of a raw exception.
 */

export const DEFAULT_MIRROR_BASE_URL = "https://testnet.mirrornode.hedera.com";
export const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_PAGES = 50;

export type MirrorErrorCode = "HTTP" | "TIMEOUT" | "NETWORK" | "BAD_JSON";

export class MirrorError extends Error {
  constructor(
    public readonly code: MirrorErrorCode,
    public readonly status: number | null,
    public readonly url: string,
    message: string,
  ) {
    super(message);
    this.name = "MirrorError";
  }
}

export type MirrorOptions = {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export type MirrorLog = {
  address: string;
  data: string;
  topics: string[];
  transaction_hash: string;
  timestamp: string;
  block_number: number;
  index: number;
};

export type MirrorContractResult = {
  from: string;
  to: string | null;
  hash: string;
  timestamp: string;
  result: string;
  logs: MirrorLog[];
};

export type MirrorTopicMessage = {
  consensus_timestamp: string;
  sequence_number: number;
  message: string;
  running_hash: string;
  topic_id: string;
};

export type DecodedTopicMessage = {
  sequenceNumber: number;
  consensusTimestamp: string;
  text: string;
};

export type MirrorAccountToken = {
  token_id: string;
  balance: number;
  decimals: number;
  automatic_association: boolean;
};

type Page<T> = {
  items: T[];
  next: string | null;
};

async function mirrorGet<T>(path: string, options: MirrorOptions = {}): Promise<T> {
  const base = (options.baseUrl ?? DEFAULT_MIRROR_BASE_URL).replace(/\/$/, "");
  const url = path.startsWith("http") ? path : `${base}${path.startsWith("/") ? "" : "/"}${path}`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let res: Response;
  try {
    res = await fetchImpl(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json" },
    });
  } catch (e) {
    const isTimeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new MirrorError(isTimeout ? "TIMEOUT" : "NETWORK", null, url, `Mirror node request failed: ${url}`);
  }

  if (!res.ok) {
    throw new MirrorError("HTTP", res.status, url, `Mirror node answered ${res.status} for ${url}`);
  }

  try {
    return (await res.json()) as T;
  } catch {
    throw new MirrorError("BAD_JSON", res.status, url, `Mirror node returned invalid JSON for ${url}`);
  }
}

async function mirrorGetOrNull<T>(path: string, options: MirrorOptions = {}): Promise<T | null> {
  try {
    return await mirrorGet<T>(path, options);
  } catch (e) {
    if (e instanceof MirrorError && e.code === "HTTP" && e.status === 404) return null;
    throw e;
  }
}

function encodeQuery(params: Record<string, string | number | undefined>): string {
  const parts = Object.entries(params)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

/** Contract result (including logs) for one transaction hash, for example `0x...`. */
export async function getContractResultByHash(txHash: string, options: MirrorOptions = {}): Promise<MirrorContractResult> {
  return mirrorGet<MirrorContractResult>(`/api/v1/contracts/results/${txHash}`, options);
}

export type ContractLogsParams = {
  /** topic0 to topic3 filters; null entries are skipped. */
  topics?: (string | null)[];
  order?: "asc" | "desc";
  limit?: number;
};

/** One page of event logs for a contract, filtered by topics. */
export async function getContractLogs(
  contractAddress: string,
  params: ContractLogsParams = {},
  options: MirrorOptions = {},
): Promise<Page<MirrorLog>> {
  const query: Record<string, string | number | undefined> = {
    order: params.order ?? "asc",
    limit: params.limit ?? 100,
  };
  params.topics?.forEach((topic, i) => {
    if (topic) query[`topic${i}`] = topic;
  });
  const data = await mirrorGet<{ logs: MirrorLog[]; links: { next: string | null } }>(
    `/api/v1/contracts/${contractAddress}/results/logs${encodeQuery(query)}`,
    options,
  );
  return { items: data.logs ?? [], next: data.links?.next ?? null };
}

/** All pages of event logs for a contract, oldest first unless asked otherwise. */
export async function getAllContractLogs(
  contractAddress: string,
  params: ContractLogsParams = {},
  options: MirrorOptions = {},
): Promise<MirrorLog[]> {
  const first = await getContractLogs(contractAddress, params, options);
  const items = [...first.items];
  let next = first.next;
  let pages = 1;
  while (next && pages < MAX_PAGES) {
    const data = await mirrorGet<{ logs: MirrorLog[]; links: { next: string | null } }>(next, options);
    items.push(...(data.logs ?? []));
    next = data.links?.next ?? null;
    pages += 1;
  }
  return items;
}

/** One page of HCS topic messages. Messages arrive base64 encoded. */
export async function getTopicMessages(
  topicId: string,
  params: { order?: "asc" | "desc"; limit?: number; sequenceNumber?: number } = {},
  options: MirrorOptions = {},
): Promise<Page<MirrorTopicMessage>> {
  const query = encodeQuery({
    order: params.order ?? "asc",
    limit: params.limit ?? 100,
    sequencenumber: params.sequenceNumber,
  });
  const data = await mirrorGet<{ messages: MirrorTopicMessage[]; links: { next: string | null } }>(
    `/api/v1/topics/${topicId}/messages${query}`,
    options,
  );
  return { items: data.messages ?? [], next: data.links?.next ?? null };
}

/** Decode the base64 message field of a mirror topic message. Works in Node and in the browser. */
export function decodeTopicMessageBody(base64: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(base64, "base64").toString("utf8");
  }
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Every message on a topic, decoded to UTF-8 text, following pagination. */
export async function getAllTopicMessages(
  topicId: string,
  params: { order?: "asc" | "desc"; limit?: number } = {},
  options: MirrorOptions = {},
): Promise<DecodedTopicMessage[]> {
  const out: DecodedTopicMessage[] = [];
  let page = await getTopicMessages(topicId, params, options);
  let pages = 0;
  for (;;) {
    for (const m of page.items) {
      out.push({
        sequenceNumber: m.sequence_number,
        consensusTimestamp: m.consensus_timestamp,
        text: decodeTopicMessageBody(m.message),
      });
    }
    pages += 1;
    if (!page.next || pages >= MAX_PAGES) break;
    const data = await mirrorGet<{ messages: MirrorTopicMessage[]; links: { next: string | null } }>(page.next, options);
    page = { items: data.messages ?? [], next: data.links?.next ?? null };
  }
  return out;
}

/** All tokens held by an account, following pagination. */
export async function getAccountTokens(accountId: string, options: MirrorOptions = {}): Promise<MirrorAccountToken[]> {
  const out: MirrorAccountToken[] = [];
  let path: string | null = `/api/v1/accounts/${accountId}/tokens?limit=100`;
  let pages = 0;
  while (path && pages < MAX_PAGES) {
    const data: { tokens: MirrorAccountToken[]; links: { next: string | null } } = await mirrorGet<{
      tokens: MirrorAccountToken[];
      links: { next: string | null };
    }>(path, options);
    out.push(...(data.tokens ?? []));
    path = data.links?.next ?? null;
    pages += 1;
  }
  return out;
}

/** The `0.0.x` account id behind an EVM address, or null when none exists. */
export async function evmToAccountId(evmAddress: string, options: MirrorOptions = {}): Promise<string | null> {
  const data = await mirrorGetOrNull<{ account?: string }>(`/api/v1/accounts/${evmAddress}`, options);
  return typeof data?.account === "string" ? data.account : null;
}

/** The `0.0.x` contract id behind an EVM address, or null when none exists. */
export async function evmToContractId(evmAddress: string, options: MirrorOptions = {}): Promise<string | null> {
  const data = await mirrorGetOrNull<{ contract_id?: string }>(`/api/v1/contracts/${evmAddress}`, options);
  return typeof data?.contract_id === "string" ? data.contract_id : null;
}

/** The `0.0.x` token id behind an EVM address, or null when none exists. */
export async function evmToTokenId(evmAddress: string, options: MirrorOptions = {}): Promise<string | null> {
  const data = await mirrorGetOrNull<{ token_id?: string }>(`/api/v1/tokens/${evmAddress}`, options);
  return typeof data?.token_id === "string" ? data.token_id : null;
}

/** Resolve an EVM address to its Hedera `0.0.x` id, trying account, contract and token in turn. */
export async function evmToHederaId(evmAddress: string, options: MirrorOptions = {}): Promise<string | null> {
  return (
    (await evmToAccountId(evmAddress, options)) ??
    (await evmToContractId(evmAddress, options)) ??
    (await evmToTokenId(evmAddress, options))
  );
}

/**
 * Build the `0.0.x@seconds.nanoseconds` transaction id used by HashScan from the payer account id
 * and a mirror timestamp (ISO string as on contract results, or `seconds.nanos` as on messages).
 */
export function toTransactionId(accountId: string, timestamp: string): string {
  let seconds: string;
  let nanos: string;
  if (timestamp.includes("T")) {
    const ms = new Date(timestamp).getTime();
    seconds = Math.floor(ms / 1000).toString();
    nanos = ((ms % 1000) * 1_000_000).toString().padStart(9, "0");
  } else {
    const [s, n = "0"] = timestamp.split(".");
    seconds = s;
    nanos = n.padEnd(9, "0").slice(0, 9);
  }
  return `${accountId}@${seconds}.${nanos}`;
}
