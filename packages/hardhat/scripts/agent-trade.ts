import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";

/**
 * Agent trading example for Verdict. Reads the JSON API, picks the open market
 * with the nearest expiry, takes a quote and buys YES through VerdictRouter on
 * Hedera testnet with DEPLOYER_PRIVATE_KEY from .env.
 *
 * Run with: yarn ts-node scripts/agent-trade.ts [amountInHbar]
 * Testnet only. Untested until a funded testnet account is available.
 */

const APP_URL = (process.env.VERDICT_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const RPC_URL = process.env.HEDERA_RPC_URL ?? "https://testnet.hashio.io/api";
const HASHSCAN_TX = "https://hashscan.io/testnet/transaction";
const DEADLINE_SECONDS = 600;
const SLIPPAGE_BPS = 500n; // accept 5% below the quoted YES out

type MarketSummary = { id: number; status: string; expiry: string; question: string };

type QuoteResponse = {
  router: string | null;
  quote: { raw: { yesOut: string } } | null;
  error?: string;
  detail?: string;
};

function loadInterfaceAbi(name: string): ethers.InterfaceAbi {
  const artifactPath = path.join(__dirname, "..", "artifacts", "contracts", "interfaces", `${name}.sol`, `${name}.json`);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as { abi: ethers.InterfaceAbi };
  return artifact.abi;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(`${url} answered ${res.status}: ${data.error ?? res.statusText}`);
  return data;
}

async function main() {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("DEPLOYER_PRIVATE_KEY is not set in .env; the agent needs a funded testnet ECDSA key.");
  }
  const amountHbar = process.argv[2] ?? "1";
  if (!/^\d+(\.\d+)?$/.test(amountHbar) || Number(amountHbar) <= 0) {
    throw new Error(`Amount must be a positive HBAR number, got: ${amountHbar}`);
  }

  const { markets } = await fetchJson<{ markets: MarketSummary[] }>(`${APP_URL}/api/markets`);
  const now = Date.now();
  const open = markets
    .filter(m => m.status === "Open" && new Date(m.expiry).getTime() > now)
    .sort((a, b) => new Date(a.expiry).getTime() - new Date(b.expiry).getTime());
  if (open.length === 0) throw new Error("No open markets with a future expiry.");
  const market = open[0];
  console.log(`Market ${market.id}: ${market.question}`);
  console.log(`Expiry: ${market.expiry}`);

  const quote = await fetchJson<QuoteResponse>(`${APP_URL}/api/quote?id=${market.id}&trade=buyYes&amount=${amountHbar}`);
  if (!quote.quote || !quote.router) {
    throw new Error(`No quote for market ${market.id}: ${quote.error ?? "unknown"}${quote.detail ? ` (${quote.detail})` : ""}`);
  }
  const yesOut = BigInt(quote.quote.raw.yesOut);
  const minYesOut = (yesOut * (10_000n - SLIPPAGE_BPS)) / 10_000n;
  console.log(`Quote: ${amountHbar} HBAR buys about ${ethers.formatUnits(yesOut, 8)} YES (min ${ethers.formatUnits(minYesOut, 8)})`);

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(privateKey, provider);
  const router = new ethers.Contract(quote.router, loadInterfaceAbi("IVerdictRouter"), wallet);

  // On the ledger 1 HBAR is 1e8 tinybars; the JSON-RPC relay speaks weibars (1e18), so scale by 1e10.
  const amountTinybars = BigInt(Math.round(Number(amountHbar) * 1e8));
  const valueWeibars = amountTinybars * 10n ** 10n;

  const deadline = Math.floor(Date.now() / 1000) + DEADLINE_SECONDS;
  const tx = (await router.buyYes(market.id, minYesOut, deadline, { value: valueWeibars })) as ethers.ContractTransactionResponse;
  console.log(`Sent: ${HASHSCAN_TX}/${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`Confirmed in block ${receipt?.blockNumber}: ${HASHSCAN_TX}/${tx.hash}`);
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
