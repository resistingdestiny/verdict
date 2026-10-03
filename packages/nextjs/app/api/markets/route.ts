import { NextResponse } from "next/server";
import { marketToJson, readMarketCount, readMarketRaw } from "~~/app/api/_lib/markets";
import { VERDICT_CHAIN_ID, getDeployedContract } from "~~/app/api/_lib/verdict";

export const dynamic = "force-dynamic";

/**
 * Every market as JSON, built from contract views on Hedera testnet.
 * Answers 200 with an empty array and an error field when the contract is absent.
 */
export async function GET() {
  const contract = getDeployedContract("Verdict");
  if (!contract) {
    return NextResponse.json({
      chainId: VERDICT_CHAIN_ID,
      contract: null,
      markets: [],
      error: "Verdict contract not deployed on chain 296 yet",
    });
  }

  try {
    const count = await readMarketCount();
    const ids = Array.from({ length: Number(count ?? 0n) }, (_, i) => BigInt(i));
    const raws = await Promise.all(ids.map(id => readMarketRaw(id)));
    const markets = await Promise.all(raws.flatMap((raw, i) => (raw ? [marketToJson(ids[i], raw)] : [])));
    return NextResponse.json({ chainId: VERDICT_CHAIN_ID, contract: contract.address, markets });
  } catch (e) {
    return NextResponse.json(
      {
        chainId: VERDICT_CHAIN_ID,
        contract: contract.address,
        markets: [],
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }
}
