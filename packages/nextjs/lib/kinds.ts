/**
 * The one TypeScript source of truth for market kinds: the enum values that mirror `IVerdict.Kind`, their
 * names and descriptions, which kinds use an upper bound, the payoff rule and the question wording.
 *
 * This file has no imports so the hardhat package can load it by relative path
 * (`../../nextjs/lib/kinds`) as its scripts and test helpers do. Adding a kind is one value here, one
 * branch in each switch below, the contract and its tests; see "How to add a market kind" in AGENTS.md.
 */

/** Mirrors the `Kind` enum in `IVerdict.sol`. Append only: stored markets record their kind as a number. */
export const Kind = {
  Above: 0,
  Below: 1,
  Between: 2,
  Scalar: 3,
} as const;

export type Kind = (typeof Kind)[keyof typeof Kind];

/** Every kind in enum order. The Create page offers exactly this list. */
export const KINDS: readonly Kind[] = [Kind.Above, Kind.Below, Kind.Between, Kind.Scalar];

/** The kind names in enum order, as the contract, the JSON API and the HCS record spell them. */
export const KIND_NAMES = ["Above", "Below", "Between", "Scalar"] as const;

export const KIND_DESCRIPTIONS: Record<Kind, string> = {
  [Kind.Above]: "YES pays 1 HBAR when the price is above the strike, otherwise nothing.",
  [Kind.Below]: "YES pays 1 HBAR when the price is below the strike, otherwise nothing.",
  [Kind.Between]: "YES pays 1 HBAR when the price is at or above the lower bound and below the upper bound.",
  [Kind.Scalar]:
    "YES pays a share of 1 HBAR that rises in a straight line from nothing at the floor to all of it at the cap.",
};

/** Tinybars per whole outcome token: the most one YES or one NO pays. */
export const PAYOUT_SCALE = 100_000_000n;

export function isKind(value: number): value is Kind {
  return KINDS.includes(value as Kind);
}

/** The name of a kind number, or `Unknown(n)` for a value the enum does not have. */
export function kindName(kind: number): string {
  return KIND_NAMES[kind] ?? `Unknown(${kind})`;
}

/** The kind a name stands for, for example "Above" to 0, or undefined for a name the enum does not have. */
export function kindFromName(name: string): Kind | undefined {
  return KINDS.find(kind => KIND_NAMES[kind] === name);
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
  /** Human-readable feed name from the resolver, for example "HBAR / USD". */
  feed: string;
  kind: Kind;
  lower: bigint;
  upper: bigint;
  /** Feed decimals the bounds are expressed in. */
  decimals: number;
  /** Unix second the market asks about. */
  expiry: bigint | number;
};

/** Renders a feed answer at the feed's decimals as a human price, for example 10_000_000n at 8 to "0.1". */
export type PriceFormatter = (answer: bigint, decimals: number) => string;

/**
 * How a surface prints prices and times. The app uses display formatting ("9 Oct 2026, 16:00 UTC"); the
 * JSON API and the HCS record use ISO 8601. The words are the same everywhere.
 */
export type QuestionFormat = {
  price: PriceFormatter;
  when: (unixSeconds: bigint | number) => string;
};

/** The condition in words, without the feed or the time: "be above 0.1". */
export function conditionText(
  kind: Kind,
  lower: bigint,
  upper: bigint,
  decimals: number,
  price: PriceFormatter,
): string {
  const lo = price(lower, decimals);
  const hi = price(upper, decimals);
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
 * The question a market asks, derived from its terms. No free text is stored on the ledger, so every
 * surface derives the same sentence from the same terms: "Will HBAR / USD be above 0.1 at 9 Oct 2026, 16:00 UTC?"
 */
export function questionText(terms: MarketTerms, format: QuestionFormat): string {
  const when = format.when(terms.expiry);
  if (terms.kind === Kind.Scalar) {
    const lo = format.price(terms.lower, terms.decimals);
    const hi = format.price(terms.upper, terms.decimals);
    return `Where between ${lo} and ${hi} will ${terms.feed} be at ${when}?`;
  }
  return `Will ${terms.feed} ${conditionText(terms.kind, terms.lower, terms.upper, terms.decimals, format.price)} at ${when}?`;
}
