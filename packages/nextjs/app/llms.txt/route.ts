import { VERDICT_CHAIN_ID, getDeployedContract } from "~~/app/api/_lib/verdict";
import verdictConfig from "~~/verdict.config";

export const dynamic = "force-dynamic";

/**
 * llms.txt: a plain-text description of Verdict for agents, generated from the
 * same deployedContracts and verdict.config the app uses, so addresses are never stale.
 */
export async function GET() {
  const verdict = getDeployedContract("Verdict");
  const router = getDeployedContract("VerdictRouter");
  const topic = verdictConfig.hcsTopicId;
  const hashScan = verdictConfig.hashScanUrl;

  const lines = [
    "# Verdict",
    "",
    "Verdict is a Scaffold-HBAR template for outcome markets on Hedera testnet. A question about a",
    "price becomes two HTS tokens, YES and NO, whose payouts always add up to 1 HBAR. A SaucerSwap",
    "pool prices the tokens, a Chainlink feed settles the market, and the Hedera Schedule Service",
    "resolves it with no keeper. Market terms and settlements are recorded on an HCS topic.",
    "",
    "## Market kinds",
    "",
    "- Above: YES pays 1 HBAR when the price is above the strike at expiry.",
    "- Below: YES pays 1 HBAR when the price is below the strike at expiry.",
    "- Between: YES pays 1 HBAR when the price is at or above the lower bound and below the upper bound.",
    "- Scalar: YES pays a share of 1 HBAR rising linearly from the floor to the cap.",
    "In every kind NO pays 1 HBAR minus what YES pays.",
    "",
    "## Contracts on Hedera testnet (chain 296)",
    "",
    `- Verdict: ${verdict ? verdict.address : "not deployed yet"}. Holds the markets, the outcome tokens and all collateral.`,
    `- VerdictRouter: ${router ? router.address : "not deployed yet"}. One transaction per trade through the SaucerSwap pool. Stateless.`,
    `- HCS record topic: ${topic ?? "not created yet"}. One market_created and one market_settled message per market.`,
    "",
    "## The four trades",
    "",
    "- buyYes: send HBAR, receive YES from the pool.",
    "- sellYes: send YES (approve the router first), receive HBAR.",
    "- buyNo: send HBAR, receive NO equal to the HBAR sent plus HBAR back from selling the YES leg.",
    "- sellNo: send NO and enough HBAR to buy the matching YES, receive NO-worth of HBAR plus change.",
    "",
    "## JSON API",
    "",
    "- GET /api/markets: every market with question text, kind, odds, reserves, status, token ids and HashScan links.",
    "- GET /api/markets/{id}: one market.",
    "- GET /api/quote?id={id}&trade={buyYes|sellYes|buyNo|sellNo}&amount={n}: quote in HBAR and whole-token units.",
    "  amount is HBAR for buy trades and whole tokens for sell trades. Both carry 8 decimals on the ledger.",
    "- POST /api/record with {\"txHash\": \"0x...\"} or {\"marketId\": 3}: writes the market's HCS record messages.",
    "  Idempotent. Needs no credentials from the caller; the server holds the topic submit key.",
    "",
    "## How an agent trades",
    "",
    "1. GET /api/markets and pick a market with status Open.",
    "2. GET /api/quote?id={id}&trade=buyYes&amount={hbar} for the expected YES out.",
    "3. Call buyYes(id, minYesOut, deadline) on VerdictRouter with the HBAR as value.",
    "   The JSON-RPC relay speaks weibars (18 decimals): multiply tinybars by 1e10 for msg.value.",
    "   Outcome tokens have 8 decimals; one whole token pays at most 1 HBAR.",
    "4. After expiry the market settles itself through its scheduled call; redeem with",
    "   redeem(id, yesAmount, noAmount, to) on Verdict.",
    "The script packages/hardhat/scripts/agent-trade.ts does steps 1 to 3 end to end.",
    "",
    "## Units",
    "",
    "Inside the EVM, values and balances are tinybars (8 decimals): 1 HBAR = 100,000,000 tinybars.",
    "Outcome tokens have 8 decimals: 1 whole token = 100,000,000 units, and 1 unit of YES plus",
    "1 unit of NO is backed by exactly 1 tinybar of collateral.",
    "",
    "## Links",
    "",
    `- Record feed: /record (topic ${topic ?? "pending"}, readable at ${verdictConfig.mirrorNodeUrl})`,
    `- HashScan: ${hashScan}`,
    `- Contract on HashScan: ${verdict ? `${hashScan}/contract/${verdict.address}` : "pending"}`,
    "",
  ];

  return new Response(lines.join("\n"), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
