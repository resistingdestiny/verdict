import { ethers } from "hardhat";
import { TESTNET_ADDRESSES } from "../config/addresses";
import { EVIDENCE_PATH, Ledger, appendTableRow, formatHbar } from "./lib/evidence";
import { hashscanContract } from "./lib/hashscan";
import { Kind, kindName } from "../../nextjs/lib/kinds";
import {
  TestnetContext,
  balanceTinybars,
  createMarket,
  hbar,
  loadContext,
  readSpot,
  requireBalance,
  scaled,
  seedPool,
  split,
} from "./lib/testnetMarket";

/**
 * Creates the judged reference markets on Hedera testnet, by hand and never in CI:
 *
 *   yarn hardhat:reference-deployment
 *
 * Six markets from the design's table, each with a 20 HBAR split and a pool of 20 YES against 10 HBAR.
 * Bounds come from the feed's spot at creation: strikes 5 percent below or above spot, Between ranges
 * plus or minus 10 percent, Scalar floor and cap plus or minus 20 percent. The three 30 minute
 * markets settle during the build; the dated ones settle during judging.
 *
 * Every paid step is checkpointed in packages/hardhat/.testnet-run.json under `ref:` keys, so a crash
 * or a second run continues with the next market and never pays twice. The deployer balance is
 * checked before every market and the script stops, saying so, below 150 HBAR.
 */

const MIN_BALANCE_HBAR = Number(process.env.REF_MIN_BALANCE_HBAR ?? "150");
const SHORT_MARKET_MINUTES = 30;
const EXPIRY_MARGIN_SECONDS = 30;
// REF_SPLIT_HBAR and REF_LIQUIDITY_HBAR shrink the per-market stake when the deployer is short of HBAR.
const SPLIT_TINYBARS = hbar(Number(process.env.REF_SPLIT_HBAR ?? "20"));
const LIQUIDITY_TINYBARS = hbar(Number(process.env.REF_LIQUIDITY_HBAR ?? "10"));
// REF_ONLY=btc-below,eth-between limits the run to those plan keys, so a partial budget goes where it matters.
const ONLY_KEYS = (process.env.REF_ONLY ?? "")
  .split(",")
  .map(k => k.trim())
  .filter(Boolean);
const SECTION = "## Reference markets created";
const HEADER = "| Market | Kind | Expiry | Market id | Pool | Purpose |";

type Plan = {
  key: string;
  feedName: string;
  kind: number;
  /** Percent of spot for lower and upper (0 for an unused upper). */
  lowerPercent: number;
  upperPercent: number;
  /** ISO date for a fixed expiry, or null for 30 minutes after creation. */
  expiryIso: string | null;
  purpose: string;
};

const PLANS: Plan[] = [
  {
    key: "hbar-above-below-spot",
    feedName: "HBAR/USD",
    kind: Kind.Above,
    lowerPercent: 95,
    upperPercent: 0,
    expiryIso: null,
    purpose: "Settles with YES paid in full during the build",
  },
  {
    key: "hbar-above-above-spot",
    feedName: "HBAR/USD",
    kind: Kind.Above,
    lowerPercent: 105,
    upperPercent: 0,
    expiryIso: null,
    purpose: "Settles with NO paid in full during the build",
  },
  {
    key: "hbar-scalar-short",
    feedName: "HBAR/USD",
    kind: Kind.Scalar,
    lowerPercent: 80,
    upperPercent: 120,
    expiryIso: null,
    purpose: "Settles at a fractional payout during the build",
  },
  {
    key: "btc-below",
    feedName: "BTC/USD",
    kind: Kind.Below,
    lowerPercent: 105,
    upperPercent: 0,
    expiryIso: "2026-10-09T16:00:00Z",
    purpose: "Settles itself in the middle of judging",
  },
  {
    key: "eth-between",
    feedName: "ETH/USD",
    kind: Kind.Between,
    lowerPercent: 90,
    upperPercent: 110,
    expiryIso: "2026-10-14T16:00:00Z",
    purpose: "Settles itself late in judging",
  },
  {
    key: "hbar-scalar-long",
    feedName: "HBAR/USD",
    kind: Kind.Scalar,
    lowerPercent: 80,
    upperPercent: 120,
    expiryIso: "2026-10-30T16:00:00Z",
    purpose: "Stays open through the announcement",
  },
];

/**
 * The expiry second for a plan. A fixed date that is already less than an hour away (the run slipped
 * past it) moves to the next 16:00 UTC that is at least an hour ahead, and the script says so.
 */
function expiryFor(plan: Plan, now: number): number {
  if (!plan.expiryIso) return now + SHORT_MARKET_MINUTES * 60 + EXPIRY_MARGIN_SECONDS;
  let expiry = Math.floor(Date.parse(plan.expiryIso) / 1000);
  if (expiry >= now + 3600) return expiry;
  const original = expiry;
  while (expiry < now + 3600) expiry += 24 * 60 * 60;
  console.log(
    `  ${plan.key}: the planned expiry ${new Date(original * 1000).toISOString()} is too close or past; ` +
      `using ${new Date(expiry * 1000).toISOString()} instead`,
  );
  return expiry;
}

function describe(plan: Plan): string {
  const bounds =
    plan.upperPercent === 0
      ? `strike ${plan.lowerPercent < 100 ? `${100 - plan.lowerPercent} percent below` : `${plan.lowerPercent - 100} percent above`} spot`
      : `range ${100 - plan.lowerPercent} percent around spot`;
  return `${plan.feedName.replace("/", " / ")} ${kindName(plan.kind)}, ${bounds}, ${plan.expiryIso ?? "30 minutes"}`;
}

async function deployOne(ctx: TestnetContext, ledger: Ledger, plan: Plan): Promise<void> {
  const key = `ref:${plan.key}`;
  const feed = TESTNET_ADDRESSES.chainlink[plan.feedName];
  const spot = await readSpot(feed.feed);
  console.log(`${plan.feedName} spot ${ethers.formatUnits(spot.answer, spot.decimals)} (round ${spot.roundId})`);
  const market = await createMarket(ctx, ledger, key, {
    feedName: plan.feedName,
    kind: plan.kind,
    lower: scaled(spot.answer, plan.lowerPercent),
    upper: plan.upperPercent === 0 ? 0n : scaled(spot.answer, plan.upperPercent),
    expiry: expiryFor(plan, Math.floor(Date.now() / 1000)),
    label: describe(plan),
  });
  await split(ctx, ledger, key, market.id, SPLIT_TINYBARS);
  const pair = await seedPool(ctx, ledger, key, market.id, market.yes, SPLIT_TINYBARS, LIQUIDITY_TINYBARS);
  await ledger.step(`${key}:row`, `Reference market ${market.id} listed`, async () => {
    const expiry = Number(ledger.value(`${key}:create`, "expiry"));
    appendTableRow(
      EVIDENCE_PATH,
      SECTION,
      HEADER,
      `| ${describe(plan)} | ${kindName(plan.kind)} | ${new Date(expiry * 1000).toISOString()} | ${market.id} | [pool](${hashscanContract(pair)}) | ${plan.purpose} |`,
    );
    return { noEvidence: true, data: { id: market.id.toString(), pair } };
  });
  console.log(`Market ${market.id}: YES ${market.yes}, NO ${market.no}, pool ${pair}`);
}

async function main() {
  const ctx = await loadContext();
  const ledger = new Ledger("hederaTestnet", ctx.deployer);
  const startBalance = await balanceTinybars(ctx.deployer);
  const stopped: string[] = [];

  for (const plan of PLANS) {
    if (ONLY_KEYS.length > 0 && !ONLY_KEYS.includes(plan.key)) continue;
    const key = `ref:${plan.key}`;
    if (ledger.has(`${key}:row`)) {
      console.log(`[skip] ${describe(plan)} (market ${ledger.value(`${key}:row`, "id")})`);
      continue;
    }
    try {
      await requireBalance(ctx, MIN_BALANCE_HBAR);
    } catch (e) {
      console.log(e instanceof Error ? e.message : String(e));
      stopped.push(describe(plan));
      continue;
    }
    await deployOne(ctx, ledger, plan);
    await ledger.flush();
  }

  await ledger.flush(true);
  const endBalance = await balanceTinybars(ctx.deployer);
  const spent = startBalance - endBalance;
  if (spent > 0n) ledger.recordSpend("reference deployment run", spent);

  if (stopped.length > 0) {
    console.log("");
    console.log(`STOP: the deployer balance fell below ${MIN_BALANCE_HBAR} HBAR. Markets not created:`);
    for (const s of stopped) console.log(`  ${s}`);
    console.log("Fund the deployer and rerun; completed markets are skipped.");
  }
  ledger.printSummary();
  console.log(
    `Deployer: ${formatHbar(startBalance)} HBAR at start, ${formatHbar(endBalance)} HBAR now, ${formatHbar(spent)} HBAR spent this run.`,
  );
  if (stopped.length > 0) process.exitCode = 2;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  console.error("The run stopped. Completed steps are in packages/hardhat/.testnet-run.json; rerun to resume.");
  process.exitCode = 1;
});
