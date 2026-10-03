import { formatUnits } from "viem";

/**
 * Question text for a market, derived from the feed description, the kind, the
 * bounds and the expiry. No free text is stored on the ledger, so every surface
 * (app, API, llms.txt) derives the same sentence from the same terms.
 */

export type QuestionTerms = {
  /** Human-readable feed name from the resolver, for example "HBAR / USD". */
  feed: string | null;
  /** Market kind as the contract enum index (0 Above, 1 Below, 2 Between, 3 Scalar, 4 Outside) or its name. */
  kind: number | string;
  lower: bigint;
  upper: bigint;
  /** Feed decimals the bounds are expressed in. */
  decimals: number;
  /** Unix second the market asks about. */
  expiry: bigint | number;
};

const KIND_NAMES = ["Above", "Below", "Between", "Scalar", "Outside"] as const;

export function kindName(kind: number | string): string {
  if (typeof kind === "string") return kind;
  return KIND_NAMES[kind] ?? `Unknown(${kind})`;
}

export function isoDate(unixSeconds: bigint | number): string {
  return new Date(Number(unixSeconds) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function questionText(terms: QuestionTerms): string {
  const feed = terms.feed ?? "the feed";
  const lower = formatUnits(terms.lower, terms.decimals);
  const upper = formatUnits(terms.upper, terms.decimals);
  const when = isoDate(terms.expiry);
  switch (kindName(terms.kind)) {
    case "Above":
      return `Will ${feed} be above ${lower} at ${when}?`;
    case "Below":
      return `Will ${feed} be below ${lower} at ${when}?`;
    case "Between":
      return `Will ${feed} be between ${lower} and ${upper} at ${when}?`;
    case "Outside":
      return `Will ${feed} be outside ${lower} and ${upper} at ${when}?`;
    default:
      return `Where will ${feed} land between ${lower} and ${upper} at ${when}?`;
  }
}
