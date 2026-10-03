import { NextResponse } from "next/server";

import { marketToJson, readMarketRaw } from "~~/app/api/_lib/markets";
import { VERDICT_CHAIN_ID, getDeployedContract } from "~~/app/api/_lib/verdict";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * One market as JSON. Answers 200 with an error field when the contract is
 * absent, 404 when the market id does not exist.
 */
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: "Market id must be a non-negative integer" }, { status: 400 });
  }

  const contract = getDeployedContract("Verdict");
  if (!contract) {
    return NextResponse.json({
      chainId: VERDICT_CHAIN_ID,
      contract: null,
      market: null,
      error: "Verdict contract not deployed on chain 296 yet",
    });
  }

  try {
    const raw = await readMarketRaw(BigInt(id));
    if (!raw) {
      return NextResponse.json({ error: `No such market: ${id}` }, { status: 404 });
    }
    const market = await marketToJson(BigInt(id), raw);
    return NextResponse.json({ chainId: VERDICT_CHAIN_ID, contract: contract.address, market });
  } catch (e) {
    return NextResponse.json(
      { chainId: VERDICT_CHAIN_ID, contract: contract.address, market: null, error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
