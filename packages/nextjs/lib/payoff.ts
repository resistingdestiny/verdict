import { feedAnswerToPrice, formatUtc } from "./format";
import {
  type Kind,
  type MarketTerms,
  PAYOUT_SCALE,
  type QuestionFormat,
  conditionText as conditionTextIn,
  kindUsesUpper,
  payoutFor,
  questionText as questionTextIn,
} from "./kinds";

/**
 * The app's view of the payoff rule in `./kinds`: question and condition text in display formatting, and
 * the samples the payoff diagram draws. The rule itself, the kind list and the wording live in `./kinds`.
 */

/** Display formatting for the app: trimmed decimals and "9 Oct 2026, 16:00 UTC". */
const APP_FORMAT: QuestionFormat = { price: feedAnswerToPrice, when: formatUtc };

/** The condition in words, without the feed or the time: "be above 0.1". */
export function conditionText(kind: Kind, lower: bigint, upper: bigint, decimals: number): string {
  return conditionTextIn(kind, lower, upper, decimals, feedAnswerToPrice);
}

/** The question a market asks, in display formatting: "Will HBAR / USD be above 0.1 at 9 Oct 2026, 16:00 UTC?" */
export function questionText(terms: MarketTerms): string {
  return questionTextIn(terms, APP_FORMAT);
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
