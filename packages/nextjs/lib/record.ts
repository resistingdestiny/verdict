import { DecodedTopicMessage, getAllTopicMessages } from "~~/lib/mirror";
import verdictConfig from "~~/verdict.config";

/**
 * Client-side helpers for the HCS record: reading the topic through the mirror
 * node and asking /api/record to write any missing messages for a market.
 */

export type RecordMessagePayload = {
  v: 1;
  type: "market_created" | "market_settled";
  market: number;
  [key: string]: unknown;
};

export type FeedMessage = DecodedTopicMessage & {
  payload: RecordMessagePayload | null;
};

export type SyncRecordResult = {
  written: { type: string; market: number; sequenceNumber: number }[];
  skipped: string[];
  topic: string;
};

/** Parse the JSON payload of a decoded topic message, or null when it is not a Verdict message. */
export function parseRecordPayload(text: string): RecordMessagePayload | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { v?: unknown }).v === 1 &&
      ((parsed as { type?: unknown }).type === "market_created" || (parsed as { type?: unknown }).type === "market_settled") &&
      typeof (parsed as { market?: unknown }).market === "number"
    ) {
      return parsed as RecordMessagePayload;
    }
    return null;
  } catch {
    return null;
  }
}

/** The topic as a feed, newest first. Throws a MirrorError when the mirror node fails. */
export async function fetchRecordFeed(): Promise<FeedMessage[]> {
  const topicId = verdictConfig.hcsTopicId;
  if (!topicId) return [];
  const messages = await getAllTopicMessages(topicId, { order: "desc" }, { baseUrl: verdictConfig.mirrorNodeUrl });
  return messages.map(m => ({ ...m, payload: parseRecordPayload(m.text) }));
}

/** Ask /api/record to write any missing messages (terms, settlement) for one market. */
export async function syncRecord(marketId: number): Promise<SyncRecordResult> {
  const res = await fetch("/api/record", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ marketId }),
  });
  const data = (await res.json()) as SyncRecordResult & { error?: string; detail?: string };
  if (!res.ok) {
    throw new Error(data.detail ? `${data.error}: ${data.detail}` : data.error ?? `Record sync failed with status ${res.status}`);
  }
  return data;
}

/** Market ids that are settled or void but have no market_settled message in the feed. */
export function marketsMissingSettlement(markets: { id: number; status: string }[], feed: FeedMessage[]): number[] {
  const recorded = new Set(feed.filter(m => m.payload?.type === "market_settled").map(m => m.payload?.market));
  return markets
    .filter(m => (m.status === "Settled" || m.status === "Void") && !recorded.has(m.id))
    .map(m => m.id);
}
