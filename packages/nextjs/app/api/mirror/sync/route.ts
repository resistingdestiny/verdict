import { NextRequest, NextResponse } from "next/server";
import { getAllContractLogs } from "~~/lib/mirror";
import { SYNC_TOPIC } from "~~/lib/odds";
import verdictConfig from "~~/verdict.config";

export const dynamic = "force-dynamic";

/**
 * A pool's `Sync` event logs from the mirror node, oldest first. The mirror node only accepts topic filters
 * together with a bounded timestamp window, so the server reads the pair's logs and matches the topic in
 * memory; the browser gets one clean 200.
 */
export async function GET(req: NextRequest) {
  const pair = req.nextUrl.searchParams.get("pair") ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(pair)) {
    return NextResponse.json({ error: "pair must be an EVM address" }, { status: 400 });
  }
  try {
    const logs = await getAllContractLogs(
      pair,
      { topics: [SYNC_TOPIC], order: "asc", limit: 100 },
      { baseUrl: verdictConfig.mirrorNodeUrl },
    );
    return NextResponse.json({
      logs: logs.map(log => ({ data: log.data, topics: log.topics, timestamp: log.timestamp })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
