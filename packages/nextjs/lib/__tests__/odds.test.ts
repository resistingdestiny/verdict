import { PAYOUT_SCALE } from "../format";
import {
  SYNC_TOPIC,
  complement,
  decodeSyncLog,
  impliedProbability,
  oddsFromSync,
  pointsFromSyncLogs,
  splitReserves,
  yesIsToken0,
} from "../odds";
import { encodeAbiParameters } from "viem";
import { describe, expect, it } from "vitest";

const YES = "0x00000000000000000000000000000000005b8d80";
const WHBAR = "0x0000000000000000000000000000000000003aD2";

describe("impliedProbability", () => {
  it("is the pool price of YES in tinybars per whole token", () => {
    expect(impliedProbability(2_000_000_000n, 1_000_000_000n)).toBe(50_000_000n);
    expect(impliedProbability(1_000_000_000n, 300_000_000n)).toBe(30_000_000n);
  });

  it("is zero without a pool and capped at 1 HBAR", () => {
    expect(impliedProbability(0n, 0n)).toBe(0n);
    expect(impliedProbability(0n, 5n)).toBe(0n);
    expect(impliedProbability(5n, 0n)).toBe(0n);
    expect(impliedProbability(1_000n, 2_000n)).toBe(PAYOUT_SCALE);
  });

  it("complements to 1 HBAR", () => {
    expect(complement(30_000_000n)).toBe(70_000_000n);
  });
});

describe("pair token order", () => {
  it("orders by address like Uniswap V2", () => {
    expect(yesIsToken0(YES, WHBAR)).toBe(false);
    expect(yesIsToken0(WHBAR, YES)).toBe(true);
  });

  it("splits reserves into YES and HBAR accordingly", () => {
    expect(splitReserves(1n, 2n, true)).toEqual({ yesReserve: 1n, hbarReserve: 2n });
    expect(splitReserves(1n, 2n, false)).toEqual({ yesReserve: 2n, hbarReserve: 1n });
    expect(oddsFromSync(1_000_000_000n, 2_000_000_000n, false)).toBe(50_000_000n);
  });
});

describe("Sync history", () => {
  const encode = (reserve0: bigint, reserve1: bigint) =>
    encodeAbiParameters(
      [
        { name: "reserve0", type: "uint112" },
        { name: "reserve1", type: "uint112" },
      ],
      [reserve0, reserve1],
    );

  it("decodes a mirror node Sync log", () => {
    const log = decodeSyncLog({
      data: encode(1_000n, 2_000n),
      topics: [SYNC_TOPIC],
      timestamp: "1700000000.123456789",
    });
    expect(log).toEqual({ reserve0: 1_000n, reserve1: 2_000n, timestamp: 1_700_000_000 });
  });

  it("ignores other events", () => {
    expect(decodeSyncLog({ data: "0x", topics: [`0x${"ab".repeat(32)}`], timestamp: "1" })).toBeNull();
  });

  it("orders points by time and prices each one", () => {
    const points = pointsFromSyncLogs(
      [
        { reserve0: 1_000_000_000n, reserve1: 2_000_000_000n, timestamp: 20 },
        { reserve0: 1_000_000_000n, reserve1: 4_000_000_000n, timestamp: 10 },
      ],
      false,
    );
    expect(points.map(point => point.time)).toEqual([10, 20]);
    expect(points[0].probability).toBe(25_000_000n);
    expect(points[1].probability).toBe(50_000_000n);
    expect(points[1].yesReserve).toBe(2_000_000_000n);
  });
});
