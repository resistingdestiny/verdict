import { formatUnits } from "viem";

/**
 * The two HCS message shapes of the Verdict record. Messages are built from chain
 * data only (mirror node events and contract views), never from request bodies.
 */

export const KIND_NAMES = ["Above", "Below", "Between", "Scalar"] as const;

export const MESSAGE_MAX_BYTES = 1000;

export type MarketCreatedMessage = {
  v: 1;
  type: "market_created";
  market: number;
  contract: string | null;
  feed: string | null;
  kind: string;
  lower: string;
  upper: string | null;
  expiry: string;
  yes: string | null;
  no: string | null;
  schedule: string | null;
  tx: string | null;
};

export type MarketSettledMessage = {
  v: 1;
  type: "market_settled";
  market: number;
  yesPayout: string;
  roundId: string | null;
  answer: string | null;
  updatedAt: string | null;
  settledBy: "schedule" | "account" | "void";
  tx: string | null;
};

export type RecordMessage = MarketCreatedMessage | MarketSettledMessage;

export type MarketCreatedEventArgs = {
  id: bigint;
  creator: string;
  resolver: string;
  feedId: `0x${string}`;
  kind: number;
  lower: bigint;
  upper: bigint;
  expiry: bigint;
  decimals: number;
  yes: string;
  no: string;
  schedule: string;
  reserve: bigint;
};

export type ResolvedEventArgs = {
  id: bigint;
  payout: bigint;
  answer: bigint;
  roundId: bigint;
  updatedAt: bigint;
  bySchedule: boolean;
};

export type VoidedEventArgs = {
  id: bigint;
  by: string;
};

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** ISO 8601 without milliseconds, as in the message examples. */
export function isoSeconds(unixSeconds: bigint | number): string {
  return new Date(Number(unixSeconds) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Tinybars per whole token (0 to 100,000,000) as a fixed 8-decimal string, for example "1.00000000". */
export function fixed8(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 100_000_000n;
  const frac = (abs % 100_000_000n).toString().padStart(8, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${frac}`;
}

export function buildMarketCreatedMessage(
  args: MarketCreatedEventArgs,
  ids: { contract: string | null; feed: string | null; yes: string | null; no: string | null; schedule: string | null; tx: string | null },
): MarketCreatedMessage {
  const usesUpper = args.kind === 2 || args.kind === 3;
  return {
    v: 1,
    type: "market_created",
    market: Number(args.id),
    contract: ids.contract,
    feed: ids.feed,
    kind: KIND_NAMES[args.kind] ?? `Unknown(${args.kind})`,
    lower: formatUnits(args.lower, args.decimals),
    upper: usesUpper ? formatUnits(args.upper, args.decimals) : null,
    expiry: isoSeconds(args.expiry),
    yes: ids.yes,
    no: ids.no,
    schedule: ids.schedule,
    tx: ids.tx,
  };
}

export function buildResolvedMessage(args: ResolvedEventArgs, decimals: number, tx: string | null): MarketSettledMessage {
  return {
    v: 1,
    type: "market_settled",
    market: Number(args.id),
    yesPayout: fixed8(args.payout),
    roundId: args.roundId.toString(),
    answer: formatUnits(args.answer, decimals),
    updatedAt: isoSeconds(args.updatedAt),
    settledBy: args.bySchedule ? "schedule" : "account",
    tx,
  };
}

export function buildVoidedMessage(args: VoidedEventArgs, tx: string | null): MarketSettledMessage {
  return {
    v: 1,
    type: "market_settled",
    market: Number(args.id),
    yesPayout: "0.50000000",
    roundId: null,
    answer: null,
    updatedAt: null,
    settledBy: "void",
    tx,
  };
}

/** Serialize and enforce the 1 KB message budget. */
export function serializeMessage(message: RecordMessage): string {
  const text = JSON.stringify(message);
  if (text.length > MESSAGE_MAX_BYTES) {
    throw new Error(`Record message is ${text.length} bytes, over the ${MESSAGE_MAX_BYTES} byte budget`);
  }
  return text;
}

/** The dedupe key used for idempotency: one message per type per market. */
export function messageKey(type: string, market: number): string {
  return `${type}:${market}`;
}

/** Extract the dedupe key from a raw topic message text, or null when it is not a Verdict message. */
export function parseMessageKey(text: string): string | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { v?: unknown }).v === 1 &&
      typeof (parsed as { type?: unknown }).type === "string" &&
      typeof (parsed as { market?: unknown }).market === "number"
    ) {
      const p = parsed as { type: string; market: number };
      return messageKey(p.type, p.market);
    }
    return null;
  } catch {
    return null;
  }
}
