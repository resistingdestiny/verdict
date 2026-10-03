import { PAYOUT_SCALE } from "./format";
import { type Address, type Hex, decodeEventLog, parseAbiItem, toEventSelector } from "viem";

/**
 * Implied odds. The SaucerSwap V1 pool prices YES in HBAR; that price is the market's expected YES payout,
 * and for the three binary kinds it is the implied probability. Reserves are (YES units, tinybars) and
 * both are 8-decimal, so the price of one whole YES in tinybars is simply hbarReserve * 1e8 / yesReserve.
 */

export const SYNC_EVENT = parseAbiItem("event Sync(uint112 reserve0, uint112 reserve1)");
export const SYNC_TOPIC: Hex = toEventSelector(SYNC_EVENT);

/** Tinybars per whole YES token implied by the pool, scaled like the contract's `impliedProbability`. Zero without a pool. */
export function impliedProbability(yesReserve: bigint, hbarReserve: bigint): bigint {
  if (yesReserve <= 0n || hbarReserve <= 0n) return 0n;
  const price = (hbarReserve * PAYOUT_SCALE) / yesReserve;
  return price > PAYOUT_SCALE ? PAYOUT_SCALE : price;
}

/** The NO side of an implied probability. */
export function complement(probability: bigint): bigint {
  return PAYOUT_SCALE - probability;
}

/** Uniswap V2 pairs order their tokens by address. True when YES is token0, so reserve0 is the YES reserve. */
export function yesIsToken0(yes: Address, other: Address): boolean {
  return BigInt(yes) < BigInt(other);
}

/** Split a pair's (reserve0, reserve1) into (YES units, tinybars). */
export function splitReserves(
  reserve0: bigint,
  reserve1: bigint,
  yesFirst: boolean,
): { yesReserve: bigint; hbarReserve: bigint } {
  return yesFirst ? { yesReserve: reserve0, hbarReserve: reserve1 } : { yesReserve: reserve1, hbarReserve: reserve0 };
}

export function oddsFromSync(reserve0: bigint, reserve1: bigint, yesFirst: boolean): bigint {
  const { yesReserve, hbarReserve } = splitReserves(reserve0, reserve1, yesFirst);
  return impliedProbability(yesReserve, hbarReserve);
}

export type SyncLog = { reserve0: bigint; reserve1: bigint; timestamp: number };

export type OddsPoint = { time: number; probability: bigint; yesReserve: bigint; hbarReserve: bigint };

/** Turn decoded `Sync` logs into a time series of implied probability, oldest first. */
export function pointsFromSyncLogs(logs: readonly SyncLog[], yesFirst: boolean): OddsPoint[] {
  return [...logs]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(log => {
      const { yesReserve, hbarReserve } = splitReserves(log.reserve0, log.reserve1, yesFirst);
      return { time: log.timestamp, probability: impliedProbability(yesReserve, hbarReserve), yesReserve, hbarReserve };
    });
}

type MirrorLog = { data: Hex; topics: Hex[]; timestamp: string };

/** Decode one mirror node log entry into a `SyncLog`, or null when it is not a Sync event. */
export function decodeSyncLog(log: MirrorLog): SyncLog | null {
  if (log.topics[0]?.toLowerCase() !== SYNC_TOPIC.toLowerCase()) return null;
  const decoded = decodeEventLog({ abi: [SYNC_EVENT], data: log.data, topics: [SYNC_TOPIC] });
  if (!decoded.args) return null;
  return {
    reserve0: decoded.args.reserve0,
    reserve1: decoded.args.reserve1,
    timestamp: Math.floor(Number.parseFloat(log.timestamp)),
  };
}

/**
 * Read a pair's `Sync` history through the app's `/api/mirror/sync` route. The JSON-RPC relay caps
 * `eth_getLogs` to a short block range, and the mirror node only accepts topic filters with a bounded
 * timestamp window, so the server reads the pair's logs and matches the topic; the browser gets one 200.
 */
export async function fetchSyncHistory(pair: Address, yesFirst: boolean): Promise<OddsPoint[]> {
  const response = await fetch(`/api/mirror/sync?pair=${pair}`);
  if (!response.ok) throw new Error(`sync history ${response.status} for ${pair}`);
  const body = (await response.json()) as { logs?: Pick<MirrorLog, "data" | "topics" | "timestamp">[] };
  const logs: SyncLog[] = [];
  for (const log of body.logs ?? []) {
    const sync = decodeSyncLog(log as MirrorLog);
    if (sync) logs.push(sync);
  }
  return pointsFromSyncLogs(logs, yesFirst);
}
