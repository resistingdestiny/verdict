import {
  applySlippage,
  deadlineFromNow,
  feedAnswerToPrice,
  formatFixed,
  formatPercent,
  formatTimeToExpiry,
  formatUtc,
  hbarToTinybars,
  isValidFixed,
  parseFixed,
  payoutToHbar,
  priceToFeedAnswer,
  shortHex,
  tinybarsToHbar,
  tinybarsToWeibars,
  tokenUnitsToWhole,
  weibarsToTinybars,
  wholeToTokenUnits,
} from "../format";
import { describe, expect, it } from "vitest";

describe("formatFixed and parseFixed", () => {
  it("renders whole and fractional values and trims zeros", () => {
    expect(formatFixed(100_000_000n, 8)).toBe("1");
    expect(formatFixed(150_000_000n, 8)).toBe("1.5");
    expect(formatFixed(1n, 8)).toBe("0.00000001");
    expect(formatFixed(0n, 8)).toBe("0");
    expect(formatFixed(123_456_789n, 8, 2)).toBe("1.23");
    expect(formatFixed(100_000_000n, 8, 8, 2)).toBe("1.00");
    expect(formatFixed(-150_000_000n, 8)).toBe("-1.5");
  });

  it("truncates rather than rounds", () => {
    expect(formatFixed(199_999_999n, 8, 2)).toBe("1.99");
  });

  it("parses decimals with up to the allowed places", () => {
    expect(parseFixed("1", 8)).toBe(100_000_000n);
    expect(parseFixed("1.5", 8)).toBe(150_000_000n);
    expect(parseFixed(".5", 8)).toBe(50_000_000n);
    expect(parseFixed("1.", 8)).toBe(100_000_000n);
    expect(parseFixed("0.00000001", 8)).toBe(1n);
    expect(parseFixed("-2.25", 2)).toBe(-225n);
  });

  it("rejects malformed input and too many places", () => {
    expect(() => parseFixed("", 8)).toThrow();
    expect(() => parseFixed(".", 8)).toThrow();
    expect(() => parseFixed("1e5", 8)).toThrow();
    expect(() => parseFixed("1,5", 8)).toThrow();
    expect(() => parseFixed("0.123456789", 8)).toThrow();
    expect(isValidFixed("1.5", 8)).toBe(true);
    expect(isValidFixed("abc", 8)).toBe(false);
  });

  it("round-trips", () => {
    for (const text of ["0", "1", "0.1", "123.45678901", "99999999.99999999"]) {
      expect(formatFixed(parseFixed(text, 8), 8)).toBe(text);
    }
  });
});

describe("HBAR, tinybars and weibars", () => {
  it("converts tinybars to HBAR strings and back", () => {
    expect(tinybarsToHbar(100_000_000n)).toBe("1");
    expect(tinybarsToHbar(2_000_000_000n, 2)).toBe("20");
    expect(tinybarsToHbar(123_456_789n, 2)).toBe("1.23");
    expect(hbarToTinybars("20")).toBe(2_000_000_000n);
    expect(hbarToTinybars("0.5")).toBe(50_000_000n);
  });

  it("converts between weibars and tinybars at 1e10", () => {
    expect(tinybarsToWeibars(1n)).toBe(10_000_000_000n);
    expect(tinybarsToWeibars(100_000_000n)).toBe(10n ** 18n);
    expect(weibarsToTinybars(10n ** 18n)).toBe(100_000_000n);
    expect(weibarsToTinybars(10_000_000_000n - 1n)).toBe(0n);
  });
});

describe("token units and feed prices", () => {
  it("converts token units to whole tokens and back", () => {
    expect(tokenUnitsToWhole(2_000_000_000n)).toBe("20");
    expect(wholeToTokenUnits("20")).toBe(2_000_000_000n);
    expect(tokenUnitsToWhole(12_345_678n, 4)).toBe("0.1234");
  });

  it("converts feed answers with the feed's decimals", () => {
    expect(feedAnswerToPrice(10_000_000n, 8)).toBe("0.1");
    expect(feedAnswerToPrice(6_512_345_000_000n, 8, 2)).toBe("65123.45");
    expect(priceToFeedAnswer("0.10", 8)).toBe(10_000_000n);
    expect(priceToFeedAnswer("65123.45", 8)).toBe(6_512_345_000_000n);
  });

  it("renders payouts and percentages", () => {
    expect(payoutToHbar(100_000_000n)).toBe("1.00");
    expect(payoutToHbar(50_000_000n)).toBe("0.50");
    expect(payoutToHbar(0n)).toBe("0.00");
    expect(payoutToHbar(33_333_333n)).toBe("0.33333333");
    expect(formatPercent(50_000_000n)).toBe("50.0%");
    expect(formatPercent(63_250_000n)).toBe("63.2%");
    expect(formatPercent(100_000_000n, 0)).toBe("100%");
    expect(formatPercent(0n)).toBe("0.0%");
  });
});

describe("slippage", () => {
  it("shrinks a minimum and grows a maximum against the user", () => {
    expect(applySlippage(1_000n, 100, "down")).toBe(990n);
    expect(applySlippage(1_000n, 100, "up")).toBe(1_010n);
    expect(applySlippage(999n, 100, "down")).toBe(989n);
    expect(applySlippage(999n, 100, "up")).toBe(1_009n);
    expect(applySlippage(1_000n, 0, "down")).toBe(1_000n);
  });

  it("rejects impossible slippage", () => {
    expect(() => applySlippage(1n, -1, "down")).toThrow();
    expect(() => applySlippage(1n, 10_001, "down")).toThrow();
    expect(() => applySlippage(1n, 1.5, "down")).toThrow();
  });
});

describe("times", () => {
  it("formats a unix second in UTC", () => {
    expect(formatUtc(1_791_561_600)).toBe("9 Oct 2026, 16:00 UTC");
    expect(formatUtc(1_791_561_600n)).toBe("9 Oct 2026, 16:00 UTC");
    expect(formatUtc(0)).toBe("1 Jan 1970, 00:00 UTC");
  });

  it("describes time to expiry", () => {
    const now = 1_000_000;
    expect(formatTimeToExpiry(now + 3 * 86_400 + 4 * 3_600, now)).toBe("in 3d 4h");
    expect(formatTimeToExpiry(now + 2 * 3_600 + 5 * 60, now)).toBe("in 2h 5m");
    expect(formatTimeToExpiry(now + 12 * 60, now)).toBe("in 12m");
    expect(formatTimeToExpiry(now + 40, now)).toBe("in 40s");
    expect(formatTimeToExpiry(now - 2 * 3_600, now)).toBe("2h 0m ago");
  });

  it("builds a deadline from now", () => {
    expect(deadlineFromNow(10, 1_000_000_000)).toBe(1_000_600n);
  });
});

describe("shortHex", () => {
  it("shortens long hex strings only", () => {
    expect(shortHex("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234...5678");
    expect(shortHex("0x1234")).toBe("0x1234");
  });
});
