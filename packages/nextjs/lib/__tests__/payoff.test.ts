import {
  KINDS,
  KIND_NAMES,
  Kind,
  PAYOUT_SCALE,
  boundsValid,
  isKind,
  kindFromName,
  kindName,
  kindUsesUpper,
  noPayoutFor,
  payoutFor,
} from "../kinds";
import { conditionText, payoffPoints, priceDomain, questionText } from "../payoff";
import { questionText as serverQuestionText } from "../question";
import { describe, expect, it } from "vitest";

const FULL = PAYOUT_SCALE;
const LOWER = 10_000_000n;
const UPPER = 12_000_000n;

describe("payoutFor", () => {
  it.each([
    ["below strike", LOWER - 1n, 0n],
    ["at strike", LOWER, 0n],
    ["above strike", LOWER + 1n, FULL],
  ])("Above: %s", (_, answer, expected) => {
    expect(payoutFor(Kind.Above, LOWER, 0n, answer)).toBe(expected);
  });

  it.each([
    ["below strike", LOWER - 1n, FULL],
    ["at strike", LOWER, 0n],
    ["above strike", LOWER + 1n, 0n],
  ])("Below: %s", (_, answer, expected) => {
    expect(payoutFor(Kind.Below, LOWER, 0n, answer)).toBe(expected);
  });

  it.each([
    ["below lower", LOWER - 1n, 0n],
    ["at lower", LOWER, FULL],
    ["inside", LOWER + 1n, FULL],
    ["just under upper", UPPER - 1n, FULL],
    ["at upper", UPPER, 0n],
    ["above upper", UPPER + 1n, 0n],
  ])("Between: %s", (_, answer, expected) => {
    expect(payoutFor(Kind.Between, LOWER, UPPER, answer)).toBe(expected);
  });

  it.each([
    ["below floor", LOWER - 1n, 0n],
    ["at floor", LOWER, 0n],
    ["just above floor", LOWER + 1n, 50n],
    ["midpoint", (LOWER + UPPER) / 2n, FULL / 2n],
    ["just under cap", UPPER - 1n, FULL - 50n],
    ["at cap", UPPER, FULL],
    ["above cap", UPPER + 1n, FULL],
  ])("Scalar: %s", (_, answer, expected) => {
    expect(payoutFor(Kind.Scalar, LOWER, UPPER, answer)).toBe(expected);
  });

  it("rounds scalar payouts down", () => {
    expect(payoutFor(Kind.Scalar, 0n, 3n, 1n)).toBe(33_333_333n);
    expect(payoutFor(Kind.Scalar, 0n, 3n, 2n)).toBe(66_666_666n);
  });

  it("NO always pays the complement", () => {
    for (const kind of KINDS) {
      for (const answer of [LOWER - 1n, LOWER, LOWER + 1n, UPPER - 1n, UPPER, UPPER + 1n]) {
        expect(payoutFor(kind, LOWER, UPPER, answer) + noPayoutFor(kind, LOWER, UPPER, answer)).toBe(FULL);
      }
    }
  });
});

describe("bounds", () => {
  it("knows which kinds use an upper bound", () => {
    expect(kindUsesUpper(Kind.Above)).toBe(false);
    expect(kindUsesUpper(Kind.Below)).toBe(false);
    expect(kindUsesUpper(Kind.Between)).toBe(true);
    expect(kindUsesUpper(Kind.Scalar)).toBe(true);
  });

  it("requires lower < upper only for two-bound kinds", () => {
    expect(boundsValid(Kind.Above, 5n, 0n)).toBe(true);
    expect(boundsValid(Kind.Between, 5n, 5n)).toBe(false);
    expect(boundsValid(Kind.Scalar, 5n, 6n)).toBe(true);
  });
});

describe("question text", () => {
  const expiry = 1_791_561_600;

  it("derives the question from the terms", () => {
    expect(questionText({ feed: "HBAR / USD", kind: Kind.Above, lower: LOWER, upper: 0n, decimals: 8, expiry })).toBe(
      "Will HBAR / USD be above 0.1 at 9 Oct 2026, 16:00 UTC?",
    );
    expect(
      questionText({ feed: "BTC / USD", kind: Kind.Below, lower: 6_500_000_000_000n, upper: 0n, decimals: 8, expiry }),
    ).toBe("Will BTC / USD be below 65000 at 9 Oct 2026, 16:00 UTC?");
    expect(
      questionText({ feed: "ETH / USD", kind: Kind.Between, lower: LOWER, upper: UPPER, decimals: 8, expiry }),
    ).toBe("Will ETH / USD be between 0.1 and 0.12 at 9 Oct 2026, 16:00 UTC?");
    expect(
      questionText({ feed: "HBAR / USD", kind: Kind.Scalar, lower: LOWER, upper: UPPER, decimals: 8, expiry }),
    ).toBe("Where between 0.1 and 0.12 will HBAR / USD be at 9 Oct 2026, 16:00 UTC?");
  });

  it("describes the condition alone", () => {
    expect(conditionText(Kind.Above, LOWER, 0n, 8)).toBe("be above 0.1");
    expect(conditionText(Kind.Scalar, LOWER, UPPER, 8)).toBe("settle between 0.1 and 0.12");
  });

  it("uses the same wording on the server, with ISO 8601 times and a fallback feed name", () => {
    expect(
      serverQuestionText({ feed: "HBAR / USD", kind: Kind.Above, lower: LOWER, upper: 0n, decimals: 8, expiry }),
    ).toBe("Will HBAR / USD be above 0.1 at 2026-10-09T16:00:00Z?");
    expect(serverQuestionText({ feed: null, kind: Kind.Scalar, lower: LOWER, upper: UPPER, decimals: 8, expiry })).toBe(
      "Where between 0.1 and 0.12 will the feed be at 2026-10-09T16:00:00Z?",
    );
  });
});

describe("kind names", () => {
  it("lists every kind once, in enum order, with a name", () => {
    expect(KINDS).toEqual([0, 1, 2, 3]);
    expect(KINDS.map(kind => KIND_NAMES[kind])).toEqual(["Above", "Below", "Between", "Scalar"]);
  });

  it("maps names to kinds and back, and labels unknown values", () => {
    for (const kind of KINDS) expect(kindFromName(kindName(kind))).toBe(kind);
    expect(kindFromName("Outside")).toBeUndefined();
    expect(kindName(KINDS.length)).toBe(`Unknown(${KINDS.length})`);
    expect(isKind(Kind.Scalar)).toBe(true);
    expect(isKind(KINDS.length)).toBe(false);
  });
});

describe("diagram helpers", () => {
  it("pads the price domain around the bounds and includes the current price", () => {
    const single = priceDomain(Kind.Above, LOWER, 0n);
    expect(single.min).toBe(5_000_000n);
    expect(single.max).toBe(15_000_000n);
    const two = priceDomain(Kind.Between, LOWER, UPPER);
    expect(two.min).toBe(9_000_000n);
    expect(two.max).toBe(13_000_000n);
    const withCurrent = priceDomain(Kind.Between, LOWER, UPPER, 20_000_000n);
    expect(withCurrent.max).toBeGreaterThan(20_000_000n);
    expect(priceDomain(Kind.Above, 0n, 0n).max).toBeGreaterThan(0n);
  });

  it("samples the payoff and always includes the bounds", () => {
    const points = payoffPoints(Kind.Scalar, LOWER, UPPER, 9_000_000n, 13_000_000n, 8);
    const prices = points.map(point => point.price);
    expect(prices).toContain(LOWER);
    expect(prices).toContain(UPPER);
    for (let i = 1; i < prices.length; i++) expect(prices[i] > prices[i - 1]).toBe(true);
    for (const point of points) expect(point.yes + point.no).toBe(FULL);
  });
});
