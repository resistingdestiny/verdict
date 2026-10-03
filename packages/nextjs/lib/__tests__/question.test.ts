import { kindName, questionText } from "../question";
import { describe, expect, it } from "vitest";

describe("question text for the API and the record", () => {
  const terms = { feed: "HBAR / USD", lower: 10_000_000n, upper: 12_000_000n, decimals: 8, expiry: 1_791_561_600 };

  it("names every contract kind by its enum index", () => {
    expect([0, 1, 2, 3, 4].map(kindName)).toEqual(["Above", "Below", "Between", "Scalar", "Outside"]);
    expect(kindName(5)).toBe("Unknown(5)");
  });

  it("asks an Outside question with both bounds", () => {
    expect(questionText({ ...terms, kind: 4 })).toBe(
      "Will HBAR / USD be outside 0.1 and 0.12 at 2026-10-09T16:00:00Z?",
    );
    expect(questionText({ ...terms, kind: 2 })).toBe(
      "Will HBAR / USD be between 0.1 and 0.12 at 2026-10-09T16:00:00Z?",
    );
  });
});
