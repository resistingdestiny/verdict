import { type Kind, type QuestionFormat, questionText as questionTextIn } from "./kinds";
import { formatUnits } from "viem";

/**
 * Question text for the server surfaces (the JSON API and the HCS record), in ISO 8601 and untrimmed
 * viem decimals. The wording per kind lives in `./kinds`, shared with the app.
 */

export type QuestionTerms = {
  /** Human-readable feed name from the resolver, for example "HBAR / USD", or null when unknown. */
  feed: string | null;
  kind: Kind;
  lower: bigint;
  upper: bigint;
  /** Feed decimals the bounds are expressed in. */
  decimals: number;
  /** Unix second the market asks about. */
  expiry: bigint | number;
};

export function isoDate(unixSeconds: bigint | number): string {
  return new Date(Number(unixSeconds) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

const SERVER_FORMAT: QuestionFormat = { price: formatUnits, when: isoDate };

export function questionText(terms: QuestionTerms): string {
  return questionTextIn({ ...terms, feed: terms.feed ?? "the feed" }, SERVER_FORMAT);
}
