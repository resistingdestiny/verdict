import { type Kind } from "./kinds";
import type { Address, Hex } from "viem";

/** The `Market` struct as `getMarket` returns it through viem. */
export type Market = {
  creator: Address;
  resolver: Address;
  feedId: Hex;
  kind: number;
  status: number;
  decimals: number;
  expiry: bigint;
  createdAt: bigint;
  lower: bigint;
  upper: bigint;
  yes: Address;
  no: Address;
  schedule: Address;
  collateral: bigint;
  reserve: bigint;
  payout: bigint;
  answer: bigint;
  roundId: bigint;
  updatedAt: bigint;
  settledBySchedule: boolean;
};

export const Status = {
  Open: 0,
  Settled: 1,
  Void: 2,
} as const;

/** A market with its id and the pool's current implied probability (zero when there is no pool). */
export type MarketView = Market & {
  id: bigint;
  kind: Kind;
  probability: bigint;
};

/** Lifecycle phase as the app shows it. "awaiting" is an open market past its expiry that nothing has resolved yet. */
export type Phase = "open" | "awaiting" | "settled" | "void";

export function marketPhase(market: Pick<Market, "status" | "expiry">, nowSeconds: number): Phase {
  if (market.status === Status.Settled) return "settled";
  if (market.status === Status.Void) return "void";
  return Number(market.expiry) <= nowSeconds ? "awaiting" : "open";
}

export const PHASE_LABELS: Record<Phase, string> = {
  open: "Open",
  awaiting: "Awaiting resolution",
  settled: "Settled",
  void: "Void",
};

export type Filter = "all" | "open" | "settled" | "void";

export function matchesFilter(phase: Phase, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "open") return phase === "open" || phase === "awaiting";
  return phase === filter;
}

/** Current unix second. */
export const nowSeconds = (): number => Math.floor(Date.now() / 1000);
