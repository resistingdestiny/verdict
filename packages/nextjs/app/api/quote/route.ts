import { NextResponse } from "next/server";
import { formatUnits } from "viem";

import { trimDecimal } from "~~/app/api/_lib/markets";
import { VERDICT_CHAIN_ID, getDeployedContract, verdictPublicClient } from "~~/app/api/_lib/verdict";

export const dynamic = "force-dynamic";

const TRADES = ["buyYes", "sellYes", "buyNo", "sellNo"] as const;
type Trade = (typeof TRADES)[number];

const QUOTE_FUNCTIONS: Record<Trade, string> = {
  buyYes: "quoteBuyYes",
  sellYes: "quoteSellYes",
  buyNo: "quoteBuyNo",
  sellNo: "quoteSellNo",
};

/** Trades that take HBAR in; the others take outcome token units in. */
const HBAR_IN: Record<Trade, boolean> = { buyYes: true, sellYes: false, buyNo: true, sellNo: false };

function wholeUnits(tinybarsOrUnits: bigint): string {
  return trimDecimal(formatUnits(tinybarsOrUnits, 8));
}

function jsonError(status: number, error: string, detail?: string) {
  return NextResponse.json({ error, ...(detail ? { detail } : {}) }, { status });
}

/**
 * A quote for one of the four trades, in HBAR and whole-token units.
 * Example: /api/quote?id=3&trade=buyYes&amount=1 quotes 1 HBAR of YES.
 * Answers 200 with an error field when the router is absent or the market has no pool.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const idParam = searchParams.get("id");
  const trade = searchParams.get("trade") as Trade | null;
  const amountParam = searchParams.get("amount");

  if (!idParam || !/^\d+$/.test(idParam)) return jsonError(400, "Query param id must be a non-negative integer");
  if (!trade || !TRADES.includes(trade)) return jsonError(400, `Query param trade must be one of ${TRADES.join(", ")}`);
  const amount = Number(amountParam);
  if (!amountParam || !Number.isFinite(amount) || amount <= 0) return jsonError(400, "Query param amount must be a positive number");

  const router = getDeployedContract("VerdictRouter");
  if (!router) {
    return NextResponse.json({
      chainId: VERDICT_CHAIN_ID,
      router: null,
      quote: null,
      error: "VerdictRouter contract not deployed on chain 296 yet",
    });
  }

  // amount is HBAR for buy trades and whole outcome tokens for sell trades; both carry 8 decimals.
  const amountIn = BigInt(Math.round(amount * 1e8));
  if (amountIn <= 0n) return jsonError(400, "amount is too small; the smallest unit is 1e-8");
  const id = BigInt(idParam);

  try {
    const raw = await verdictPublicClient.readContract({
      address: router.address,
      abi: router.abi,
      functionName: QUOTE_FUNCTIONS[trade],
      args: [id, amountIn],
    });

    let output: { hbar?: string; yes?: string; no?: string };
    let raw_out: Record<string, string>;
    if (trade === "buyYes") {
      const yesOut = raw as unknown as bigint;
      output = { yes: wholeUnits(yesOut) };
      raw_out = { yesOut: yesOut.toString() };
    } else if (trade === "sellYes") {
      const hbarOut = raw as unknown as bigint;
      output = { hbar: wholeUnits(hbarOut) };
      raw_out = { hbarOut: hbarOut.toString() };
    } else if (trade === "buyNo") {
      const [noOut, hbarBack] = raw as unknown as readonly [bigint, bigint];
      output = { no: wholeUnits(noOut), hbar: wholeUnits(hbarBack) };
      raw_out = { noOut: noOut.toString(), hbarBack: hbarBack.toString() };
    } else {
      const [hbarNeeded, hbarOut] = raw as unknown as readonly [bigint, bigint];
      output = { hbar: wholeUnits(hbarOut) };
      raw_out = { hbarNeeded: hbarNeeded.toString(), hbarOut: hbarOut.toString() };
    }

    return NextResponse.json({
      chainId: VERDICT_CHAIN_ID,
      router: router.address,
      quote: {
        id: Number(id),
        trade,
        input: { amount: trimDecimal(amount.toFixed(8)), unit: HBAR_IN[trade] ? "HBAR" : trade === "sellYes" ? "YES" : "NO" },
        output,
        units: "Outputs are in HBAR and whole tokens (8 decimals). Raw values are tinybars or token units.",
        raw: { amountIn: amountIn.toString(), ...raw_out },
      },
    });
  } catch (e) {
    return NextResponse.json({
      chainId: VERDICT_CHAIN_ID,
      router: router.address,
      quote: null,
      error: "Quote unavailable",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}
