import { PAYOUT_SCALE, feedAnswerToPrice, formatUtc } from "./format";

/**
 * The payoff rule, mirrored from Verdict.sol so the app can draw diagrams and label markets without a
 * contract call. Adding a kind is one enum value, one branch in `payoutFor` and one test table.
 */

export const Kind = {
  Above: 0,
  Below: 1,
  Between: 2,
  Scalar: 3,
} as const;

export type Kind = (typeof Kind)[keyof typeof Kind];

export const KINDS: readonly Kind[] = [Kind.Above, Kind.Below, Kind.Between, Kind.Scalar];

export const KIND_LABELS: Record<Kind, string> = {
  [Kind.Above]: "Above",
  [Kind.Below]: "Below",
  [Kind.Between]: "Between",
  [Kind.Scalar]: "Scalar",
};

export const KIND_DESCRIPTIONS: Record<Kind, string> = {
  [Kind.Above]: "YES pays 1 HBAR when the price is above the strike, otherwise nothing.",
  [Kind.Below]: "YES pays 1 HBAR when the price is below the strike, otherwise nothing.",
  [Kind.Between]: "YES pays 1 HBAR when the price is at or above the lower bound and below the upper bound.",
  [Kind.Scalar]:
    "YES pays a share of 1 HBAR that rises in a straight line from nothing at the floor to all of it at the cap.",
};

export function isKind(value: number): value is Kind {
  return KINDS.includes(value as Kind);
}

/** Whether the kind uses `upper`. Above and Below have a single strike. */
export function kindUsesUpper(kind: Kind): boolean {
  return kind === Kind.Between || kind === Kind.Scalar;
}

/** Bounds are valid when `lower < upper` for two-bound kinds. Single-strike kinds accept any strike. */
export function boundsValid(kind: Kind, lower: bigint, upper: bigint): boolean {
  return kindUsesUpper(kind) ? lower < upper : true;
}

/**
 * The YES payout in tinybars per whole token (0 to 1e8) that `answer` produces, exactly as the contract computes it.
 * Scalar is `(answer - lower) * 1e8 / (upper - lower)` clamped to the range, rounded down.
 */
export function payoutFor(kind: Kind, lower: bigint, upper: bigint, answer: bigint): bigint {
  switch (kind) {
    case Kind.Above:
      return answer > lower ? PAYOUT_SCALE : 0n;
    case Kind.Below:
      return answer < lower ? PAYOUT_SCALE : 0n;
    case Kind.Between:
      return answer >= lower && answer < upper ? PAYOUT_SCALE : 0n;
    case Kind.Scalar: {
      if (answer <= lower) return 0n;
      if (answer >= upper) return PAYOUT_SCALE;
      return ((answer - lower) * PAYOUT_SCALE) / (upper - lower);
    }
  }
}

/** What one NO token pays: 1 HBAR minus the YES payout. */
export function noPayoutFor(kind: Kind, lower: bigint, upper: bigint, answer: bigint): bigint {
  return PAYOUT_SCALE - payoutFor(kind, lower, upper, answer);
}

export type MarketTerms = {
  feed: string;
  kind: Kind;
  lower: bigint;
  upper: bigint;
  decimals: number;
  expiry: bigint | number;
};

/** The condition in words, without the feed or the time: "be above 0.10". */
export function conditionText(kind: Kind, lower: bigint, upper: bigint, decimals: number): string {
  const lo = feedAnswerToPrice(lower, decimals);
  const hi = feedAnswerToPrice(upper, decimals);
  switch (kind) {
    case Kind.Above:
      return `be above ${lo}`;
    case Kind.Below:
      return `be below ${lo}`;
    case Kind.Between:
      return `be between ${lo} and ${hi}`;
    case Kind.Scalar:
      return `settle between ${lo} and ${hi}`;
  }
}

/**
 * The question a market asks, derived from its terms. No free text is stored on the ledger.
 * "Will HBAR / USD be above 0.10 at 9 Oct 2026, 16:00 UTC?"
 */
export function questionText(terms: MarketTerms): string {
  const when = formatUtc(terms.expiry);
  const lo = feedAnswerToPrice(terms.lower, terms.decimals);
  const hi = feedAnswerToPrice(terms.upper, terms.decimals);
  if (terms.kind === Kind.Scalar) {
    return `Where between ${lo} and ${hi} will ${terms.feed} be at ${when}?`;
  }
  return `Will ${terms.feed} ${conditionText(terms.kind, terms.lower, terms.upper, terms.decimals)} at ${when}?`;
}

/**
 * A price range to draw the payoff over: the bounds padded by half their span (or half the strike for
 * single-strike kinds), widened to include `current` when given. Always a non-empty range.
 */
export function priceDomain(kind: Kind, lower: bigint, upper: bigint, current?: bigint): { min: bigint; max: bigint } {
  const span = kindUsesUpper(kind) && upper > lower ? upper - lower : lower > 0n ? lower : 1n;
  const pad = span / 2n > 0n ? span / 2n : 1n;
  let min = lower - pad;
  let max = (kindUsesUpper(kind) ? upper : lower) + pad;
  if (current !== undefined) {
    if (current < min) min = current - pad / 4n;
    if (current > max) max = current + pad / 4n;
  }
  if (min < 0n) min = 0n;
  if (max <= min) max = min + 1n;
  return { min, max };
}

export type PayoffPoint = { price: bigint; yes: bigint; no: bigint };

/** `steps + 1` samples of the YES and NO payoff across [min, max], with the bounds themselves always included. */
export function payoffPoints(
  kind: Kind,
  lower: bigint,
  upper: bigint,
  min: bigint,
  max: bigint,
  steps = 64,
): PayoffPoint[] {
  const prices = new Set<bigint>();
  for (let i = 0; i <= steps; i++) prices.add(min + ((max - min) * BigInt(i)) / BigInt(steps));
  for (const bound of kindUsesUpper(kind) ? [lower, upper] : [lower]) {
    if (bound >= min && bound <= max) {
      prices.add(bound);
      if (bound - 1n >= min) prices.add(bound - 1n);
      if (bound + 1n <= max) prices.add(bound + 1n);
    }
  }
  return Array.from(prices)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map(price => {
      const yes = payoutFor(kind, lower, upper, price);
      return { price, yes, no: PAYOUT_SCALE - yes };
    });
}
