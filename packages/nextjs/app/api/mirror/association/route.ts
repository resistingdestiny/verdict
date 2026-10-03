import { NextRequest, NextResponse } from "next/server";
import { longZeroToEntityId } from "~~/lib/hts";
import { MirrorError, getAccountTokens } from "~~/lib/mirror";
import verdictConfig from "~~/verdict.config";

export const dynamic = "force-dynamic";

/**
 * Whether an account is associated with an HTS token, answered from the mirror node on the server. The
 * browser cannot ask the mirror node directly without logging a console error for every account the
 * network has never seen (a fresh burner wallet answers 404), so the lookup lives here and always answers
 * 200 with `{ associated, known }`.
 */
export async function GET(req: NextRequest) {
  const account = req.nextUrl.searchParams.get("account") ?? "";
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const tokenId = longZeroToEntityId(token);
  if (!/^0x[0-9a-fA-F]{40}$/.test(account) || !tokenId) {
    return NextResponse.json(
      { error: "account must be an EVM address and token an HTS token address" },
      { status: 400 },
    );
  }
  try {
    const tokens = await getAccountTokens(account, { baseUrl: verdictConfig.mirrorNodeUrl });
    return NextResponse.json({ associated: tokens.some(entry => entry.token_id === tokenId), known: true });
  } catch (e) {
    if (e instanceof MirrorError && e.code === "HTTP" && e.status === 404) {
      return NextResponse.json({ associated: false, known: false });
    }
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
