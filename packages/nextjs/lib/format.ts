/**
 * Unit conversions and display formatting. Every conversion between tinybars, weibars, token units and
 * feed answers lives here so the rest of the app only ever shows HBAR, whole tokens and human prices.
 *
 * Inside the EVM, msg.value and balances are tinybars (8 decimals). Wallets and the JSON-RPC relay speak
 * weibars (18 decimals): 1 tinybar = 1e10 weibars. Outcome tokens have 8 decimals, so one unit of YES plus
 * one unit of NO is backed by exactly one tinybar.
 */
import { PAYOUT_SCALE } from "./kinds";

/** Re-exported from `./kinds` so unit helpers and the payoff rule share one scale. */
export { PAYOUT_SCALE };

export const HBAR_DECIMALS = 8;
export const TOKEN_DECIMALS = 8;
export const TINYBARS_PER_HBAR = 100_000_000n;
export const WEIBARS_PER_TINYBAR = 10_000_000_000n;

const pow10 = (n: number): bigint => 10n ** BigInt(n);

/**
 * Render a fixed-point integer as a decimal string.
 * Trailing zeros are trimmed down to `minFractionDigits`; the fraction is truncated, never rounded,
 * to `maxFractionDigits`, so a displayed amount is never more than the real one.
 */
export function formatFixed(
  value: bigint,
  decimals: number,
  maxFractionDigits = decimals,
  minFractionDigits = 0,
): string {
  if (decimals < 0 || maxFractionDigits < 0 || minFractionDigits < 0) throw new Error("negative digit count");
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const scale = pow10(decimals);
  const whole = abs / scale;
  let fraction = (abs % scale).toString().padStart(decimals, "0").slice(0, Math.min(maxFractionDigits, decimals));
  fraction = fraction.replace(/0+$/, "");
  if (fraction.length < minFractionDigits) fraction = fraction.padEnd(minFractionDigits, "0");
  const text = fraction.length > 0 ? `${whole}.${fraction}` : whole.toString();
  return negative && (whole > 0n || fraction.replace(/0/g, "").length > 0) ? `-${text}` : text;
}

/**
 * Parse a decimal string into a fixed-point integer with `decimals` places.
 * Throws on anything that is not a plain decimal number or that has more fraction digits than `decimals`.
 */
export function parseFixed(text: string, decimals: number): bigint {
  const trimmed = text.trim();
  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(trimmed);
  if (!match || (match[2] === "" && (match[3] === undefined || match[3] === ""))) {
    throw new Error(`not a number: "${text}"`);
  }
  const [, sign, wholeText, fractionText = ""] = match;
  if (fractionText.length > decimals) {
    throw new Error(`more than ${decimals} decimal places: "${text}"`);
  }
  const whole = BigInt(wholeText === "" ? "0" : wholeText);
  const fraction = BigInt(fractionText === "" ? "0" : fractionText.padEnd(decimals, "0"));
  const value = whole * pow10(decimals) + fraction;
  return sign ? -value : value;
}

/** Returns true when `text` parses as a fixed-point number with at most `decimals` places. */
export function isValidFixed(text: string, decimals: number): boolean {
  try {
    parseFixed(text, decimals);
    return true;
  } catch {
    return false;
  }
}

export const tinybarsToHbar = (tinybars: bigint, maxFractionDigits = HBAR_DECIMALS): string =>
  formatFixed(tinybars, HBAR_DECIMALS, maxFractionDigits);

export const hbarToTinybars = (hbar: string): bigint => parseFixed(hbar, HBAR_DECIMALS);

export const weibarsToTinybars = (weibars: bigint): bigint => weibars / WEIBARS_PER_TINYBAR;

export const tinybarsToWeibars = (tinybars: bigint): bigint => tinybars * WEIBARS_PER_TINYBAR;

export const tokenUnitsToWhole = (units: bigint, maxFractionDigits = TOKEN_DECIMALS): string =>
  formatFixed(units, TOKEN_DECIMALS, maxFractionDigits);

export const wholeToTokenUnits = (whole: string): bigint => parseFixed(whole, TOKEN_DECIMALS);

export const feedAnswerToPrice = (answer: bigint, decimals: number, maxFractionDigits = decimals): string =>
  formatFixed(answer, decimals, maxFractionDigits);

export const priceToFeedAnswer = (price: string, decimals: number): bigint => parseFixed(price, decimals);

/** A YES payout (tinybars per whole token) as HBAR with two to eight decimals. */
export const payoutToHbar = (payout: bigint | number): string => formatFixed(BigInt(payout), HBAR_DECIMALS, 8, 2);

/** A value scaled by 1e8 (an implied probability or a payout) as a percentage string. */
export function formatPercent(scaled: bigint, fractionDigits = 1): string {
  const percent = (scaled * 100n * pow10(fractionDigits)) / PAYOUT_SCALE;
  return `${formatFixed(percent, fractionDigits, fractionDigits, fractionDigits)}%`;
}

/** Shrink (`down`) or grow (`up`) an amount by `bps` basis points, rounding against the user. */
export function applySlippage(amount: bigint, bps: number, direction: "down" | "up"): bigint {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new Error("slippage must be 0 to 10000 bps");
  const b = BigInt(bps);
  if (direction === "down") return (amount * (10_000n - b)) / 10_000n;
  return (amount * (10_000n + b) + 9_999n) / 10_000n;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "9 Oct 2026, 16:00 UTC" for a unix second. */
export function formatUtc(unixSeconds: bigint | number): string {
  const date = new Date(Number(unixSeconds) * 1000);
  const hh = date.getUTCHours().toString().padStart(2, "0");
  const mm = date.getUTCMinutes().toString().padStart(2, "0");
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

/** "in 3d 4h", "in 12m", "in 40s" or "2h ago" for an expiry relative to `nowSeconds`. */
export function formatTimeToExpiry(expiry: bigint | number, nowSeconds: number): string {
  const delta = Number(expiry) - nowSeconds;
  const abs = Math.abs(delta);
  const days = Math.floor(abs / 86_400);
  const hours = Math.floor((abs % 86_400) / 3_600);
  const minutes = Math.floor((abs % 3_600) / 60);
  let span: string;
  if (days > 0) span = `${days}d ${hours}h`;
  else if (hours > 0) span = `${hours}h ${minutes}m`;
  else if (minutes > 0) span = `${minutes}m`;
  else span = `${abs}s`;
  return delta >= 0 ? `in ${span}` : `${span} ago`;
}

/** A unix-second deadline `minutes` from `nowMs`. */
export function deadlineFromNow(minutes = 10, nowMs = Date.now()): bigint {
  return BigInt(Math.floor(nowMs / 1000) + minutes * 60);
}

/** Convert a `datetime-local` input value (interpreted in the browser's zone) to a unix second. */
export function localInputToUnix(value: string): number {
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) throw new Error(`not a date: "${value}"`);
  return Math.floor(ms / 1000);
}

/** Render a unix second as a `datetime-local` input value in the browser's zone. */
export function unixToLocalInput(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Shorten an address or hash for display: 0x1234...abcd. */
export function shortHex(hex: string, chars = 4): string {
  if (hex.length <= 2 + chars * 2) return hex;
  return `${hex.slice(0, 2 + chars)}...${hex.slice(-chars)}`;
}
