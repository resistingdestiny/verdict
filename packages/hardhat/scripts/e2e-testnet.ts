import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { ethers } from "hardhat";
import { TESTNET_ADDRESSES } from "../config/addresses";
import { Ledger, formatHbar } from "./lib/evidence";
import { Kind } from "../../nextjs/lib/kinds";
import { hashscanContract, hashscanTopic, hashscanTransaction, scheduleExecution, topicMessages } from "./lib/hashscan";
import {
  GAS,
  TestnetContext,
  approve,
  balanceTinybars,
  createMarket,
  hbar,
  loadContext,
  readMarket,
  readSpot,
  requireBalance,
  scaled,
  seedPool,
  split,
  tokenBalance,
  waitFor,
  weibars,
} from "./lib/testnetMarket";

/**
 * The end to end run on Hedera testnet, by hand and never in CI:
 *
 *   yarn hardhat:e2e-testnet
 *
 * Creates a 10 minute HBAR / USD Above market struck below spot, splits 20 HBAR, seeds the pool with
 * 20 YES against 10 HBAR, records the contract balance, makes all four router trades at 1 HBAR,
 * waits for the scheduled resolution (falling back to `resolve` after 20 minutes and saying so),
 * shows the collateral untouched, redeems the deployer's YES and NO, writes the HCS record and
 * appends every transaction to docs/EVIDENCE.md and docs/COSTS.md.
 *
 * Every paid step is checkpointed in packages/hardhat/.testnet-run.json, so a crash resumes where
 * it stopped and no HBAR is spent twice. Delete that file to start a new run with a new market.
 *
 * Reads `.env` through the Hardhat config: DEPLOYER_PRIVATE_KEY is required. HEDERA_OPERATOR_ID and
 * HEDERA_OPERATOR_KEY, or VERDICT_APP_URL, let the HCS record step run. E2E_MARKET_MINUTES (default
 * 10) and E2E_MIN_BALANCE_HBAR (default 150) tune the run.
 */

const MARKET_MINUTES = Number(process.env.E2E_MARKET_MINUTES ?? "10");
const MIN_BALANCE_HBAR = Number(process.env.E2E_MIN_BALANCE_HBAR ?? "150");
/** Seconds added to the expiry so the creation transaction lands before MIN_LEAD is measured. */
const EXPIRY_MARGIN_SECONDS = 30;
const RESOLUTION_WAIT_MINUTES = 20;
const POLL_SECONDS = 15;
const SPLIT_TINYBARS = hbar(20);
const LIQUIDITY_TINYBARS = hbar(10);
const TRADE_TINYBARS = hbar(1);
const SLIPPAGE_NUM = 98n;
const SLIPPAGE_DEN = 100n;
const K = "e2e";

const HARDHAT_DIR = path.join(__dirname, "..");

function sleep(seconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

function deadlineIn(seconds: number): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + seconds);
}

async function recordBalances(ctx: TestnetContext, ledger: Ledger, key: string, title: string, id: bigint) {
  return ledger.step(key, title, async () => {
    const balance = await balanceTinybars(ctx.verdictAddress);
    const market = await readMarket(ctx, id);
    const totalCollateral = await ctx.verdict.totalCollateral();
    const pendingReserves = await ctx.verdict.pendingReserves();
    console.log(
      `  Verdict balance ${formatHbar(balance)} HBAR, market collateral ${formatHbar(market.collateral)}, ` +
        `total collateral ${formatHbar(totalCollateral)}, pending reserves ${formatHbar(pendingReserves)}, ` +
        `market reserve ${formatHbar(market.reserve)}, status ${market.statusName}`,
    );
    return {
      link: hashscanContract(ctx.verdictAddress),
      noCost: true,
      data: {
        balance: balance.toString(),
        collateral: market.collateral.toString(),
        totalCollateral: totalCollateral.toString(),
        pendingReserves: pendingReserves.toString(),
        reserve: market.reserve.toString(),
        status: market.statusName,
      },
    };
  });
}

async function trades(ctx: TestnetContext, ledger: Ledger, id: bigint, yes: string, no: string) {
  const { router, routerAddress } = ctx;

  await ledger.step(`${K}:buyYes`, `buyYes 1 HBAR on market ${id}`, async () => {
    const quote = await router.quoteBuyYes(id, TRADE_TINYBARS);
    const minYesOut = (quote * SLIPPAGE_NUM) / SLIPPAGE_DEN;
    console.log(`  quote ${quote} YES units, min ${minYesOut}`);
    const tx = await router.buyYes(id, minYesOut, deadlineIn(600), {
      value: weibars(TRADE_TINYBARS),
      gasLimit: GAS.swap,
    });
    await waitFor(tx.hash);
    return { txHash: tx.hash, data: { quote: quote.toString() } };
  });

  const yesIn = TRADE_TINYBARS;
  await approve(
    ctx,
    ledger,
    `${K}:approve-sellYes`,
    `Approve VerdictRouter on YES for sellYes`,
    yes,
    routerAddress,
    yesIn,
  );
  await ledger.step(`${K}:sellYes`, `sellYes 1 YES on market ${id}`, async () => {
    const quote = await router.quoteSellYes(id, yesIn);
    const minHbarOut = (quote * SLIPPAGE_NUM) / SLIPPAGE_DEN;
    console.log(`  quote ${quote} tinybars, min ${minHbarOut}`);
    const tx = await router.sellYes(id, yesIn, minHbarOut, deadlineIn(600), { gasLimit: GAS.swap });
    await waitFor(tx.hash);
    return { txHash: tx.hash, data: { quote: quote.toString() } };
  });

  await ledger.step(`${K}:buyNo`, `buyNo 1 HBAR on market ${id}`, async () => {
    const [, hbarBack] = await router.quoteBuyNo(id, TRADE_TINYBARS);
    const minHbarBack = (hbarBack * SLIPPAGE_NUM) / SLIPPAGE_DEN;
    console.log(`  quote ${hbarBack} tinybars back, min ${minHbarBack}`);
    const tx = await router.buyNo(id, minHbarBack, deadlineIn(600), {
      value: weibars(TRADE_TINYBARS),
      gasLimit: GAS.swap,
    });
    await waitFor(tx.hash);
    return { txHash: tx.hash, data: { hbarBack: hbarBack.toString() } };
  });

  const noIn = TRADE_TINYBARS;
  await approve(ctx, ledger, `${K}:approve-sellNo`, `Approve VerdictRouter on NO for sellNo`, no, routerAddress, noIn);
  await ledger.step(`${K}:sellNo`, `sellNo 1 NO on market ${id}`, async () => {
    const [needed, net] = await router.quoteSellNo(id, noIn);
    const value = (needed * SLIPPAGE_DEN) / SLIPPAGE_NUM;
    const minHbarOut = (net * SLIPPAGE_NUM) / SLIPPAGE_DEN; // the net of the YES purchase, less the slippage
    console.log(`  YES quote ${needed} tinybars, sending ${value} tinybars, net ${net}, min net ${minHbarOut}`);
    const tx = await router.sellNo(id, noIn, minHbarOut, deadlineIn(600), {
      value: weibars(value),
      gasLimit: GAS.swap,
    });
    await waitFor(tx.hash);
    return { txHash: tx.hash, data: { needed: needed.toString(), net: net.toString() } };
  });
}

/** Polls until the market leaves Open or the wait runs out, then falls back to `resolve`. */
async function awaitResolution(ctx: TestnetContext, ledger: Ledger, id: bigint, expiry: number) {
  return ledger.step(`${K}:resolution`, `Resolution of market ${id}`, async () => {
    const giveUpAt = (expiry + RESOLUTION_WAIT_MINUTES * 60) * 1000;
    let market = await readMarket(ctx, id);
    while (market.statusName === "Open" && Date.now() < giveUpAt) {
      const left = Math.max(0, Math.round((expiry * 1000 - Date.now()) / 1000));
      console.log(
        `  ${new Date().toISOString()} status Open, ${left > 0 ? `${left}s to expiry` : "past expiry, waiting for the schedule"}`,
      );
      await sleep(POLL_SECONDS);
      market = await readMarket(ctx, id);
    }
    if (market.statusName !== "Open") {
      console.log(
        `  Market ${id} is ${market.statusName}: payout ${formatHbar(market.payout)} HBAR per YES, answer ${market.answer}, ` +
          `round ${market.roundId}, settledBySchedule=${market.settledBySchedule}`,
      );
      const scheduleId = ledger.get(`${K}:market:schedule`)?.data?.scheduleId;
      if (market.settledBySchedule && scheduleId) {
        const execution = await scheduleExecution(scheduleId, ctx.verdictAddress);
        if (execution.executed && execution.transactionId) {
          console.log(`  Scheduled execution ${execution.transactionId} at ${execution.executedTimestamp}`);
          return {
            link: hashscanTransaction(execution.transactionId),
            transactionId: execution.transactionId,
            gasUsed: execution.gasUsed ?? undefined,
            chargedTinybars: execution.chargedTinybars?.toString(),
            data: { how: "schedule", payout: market.payout.toString(), scheduleId },
          };
        }
      }
      return {
        link: hashscanContract(ctx.verdictAddress),
        noCost: true,
        data: { how: market.settledBySchedule ? "schedule (execution not found on the mirror node yet)" : "account" },
      };
    }
    console.log(
      `  The schedule did not fire within ${RESOLUTION_WAIT_MINUTES} minutes of expiry. Falling back to resolve(${id}).`,
    );
    const tx = await ctx.verdict.resolve(id, { gasLimit: GAS.call });
    await waitFor(tx.hash);
    market = await readMarket(ctx, id);
    return { txHash: tx.hash, data: { how: "manual resolve fallback", payout: market.payout.toString() } };
  });
}

async function redeem(ctx: TestnetContext, ledger: Ledger, id: bigint, yes: string, no: string) {
  const yesHeld = await tokenBalance(yes, ctx.deployer);
  const noHeld = await tokenBalance(no, ctx.deployer);
  console.log(`Deployer holds ${yesHeld} YES units and ${noHeld} NO units`);
  if (yesHeld > 0n) {
    await approve(
      ctx,
      ledger,
      `${K}:approve-redeem-yes`,
      `Approve Verdict on YES for redeem`,
      yes,
      ctx.verdictAddress,
      yesHeld,
    );
  }
  if (noHeld > 0n) {
    await approve(
      ctx,
      ledger,
      `${K}:approve-redeem-no`,
      `Approve Verdict on NO for redeem`,
      no,
      ctx.verdictAddress,
      noHeld,
    );
  }
  await ledger.step(`${K}:redeem`, `Redeem ${yesHeld} YES and ${noHeld} NO on market ${id}`, async () => {
    if (yesHeld === 0n && noHeld === 0n) {
      console.log("  Nothing to redeem");
      return { link: hashscanContract(ctx.verdictAddress), noCost: true, data: { paid: "0" } };
    }
    const before = await balanceTinybars(ctx.deployer);
    const tx = await ctx.verdict.redeem(id, yesHeld, noHeld, ctx.deployer, { gasLimit: GAS.call });
    await waitFor(tx.hash);
    const after = await balanceTinybars(ctx.deployer);
    console.log(`  Deployer balance moved by ${formatHbar(after - before)} HBAR (payout less the fee)`);
    return { txHash: tx.hash, data: { yes: yesHeld.toString(), no: noHeld.toString() } };
  });
}

function readTopicId(): string | null {
  if (process.env.HCS_TOPIC_ID) return process.env.HCS_TOPIC_ID;
  const configPath = path.join(HARDHAT_DIR, "..", "nextjs", "verdict.config.ts");
  if (!fs.existsSync(configPath)) return null;
  const match = fs.readFileSync(configPath, "utf8").match(/hcsTopicId:\s*"(0\.0\.\d+)"/);
  return match ? match[1] : null;
}

/** Runs scripts/record-sync.ts, which submits directly with operator credentials or posts to VERDICT_APP_URL. */
async function hcsRecord(ledger: Ledger, id: bigint) {
  const topicId = readTopicId();
  const hasOperator = Boolean(process.env.HEDERA_OPERATOR_ID && process.env.HEDERA_OPERATOR_KEY);
  const hasApp = Boolean(process.env.VERDICT_APP_URL);
  if (!topicId || (!hasOperator && !hasApp)) {
    console.log(
      "HCS record skipped: needs a topic (HCS_TOPIC_ID or verdict.config.ts) and either HEDERA_OPERATOR_ID and " +
        "HEDERA_OPERATOR_KEY or VERDICT_APP_URL. Run yarn ts-node scripts/record-sync.ts later; it is idempotent.",
    );
    return;
  }
  await ledger.step(`${K}:topic`, `HCS topic ${topicId}`, async () => ({ link: hashscanTopic(topicId), noCost: true }));
  await ledger.step(`${K}:record-sync`, `HCS record sync for market ${id}`, async () => {
    const result = spawnSync("yarn", ["ts-node", "scripts/record-sync.ts"], {
      cwd: HARDHAT_DIR,
      stdio: "inherit",
      env: process.env,
    });
    if (result.status !== 0) throw new Error("record-sync.ts failed; rerun this script once the cause is fixed");
    return { link: hashscanTopic(topicId), noCost: true, data: { mode: hasOperator ? "direct" : "api" } };
  });
  for (const type of ["market_created", "market_settled"]) {
    try {
      await ledger.step(`${K}:message:${type}`, `HCS message ${type} for market ${id}`, async () => {
        const messages = await topicMessages(topicId);
        const hit = messages.find(m => {
          try {
            const parsed = JSON.parse(m.text) as { type?: string; market?: number };
            return parsed.type === type && parsed.market === Number(id);
          } catch {
            return false;
          }
        });
        if (!hit) throw new Error(`No ${type} message for market ${id} on topic ${topicId} yet`);
        console.log(`  sequence ${hit.sequenceNumber}: ${hit.text}`);
        return {
          link: hashscanTransaction(hit.transactionId),
          transactionId: hit.transactionId,
          noCost: true,
          data: { sequence: String(hit.sequenceNumber) },
        };
      });
    } catch (e) {
      console.log(`  ${e instanceof Error ? e.message : String(e)}. Not checkpointed; rerun to retry the lookup.`);
    }
  }
}

async function main() {
  const ctx = await loadContext();
  const ledger = new Ledger("hederaTestnet", ctx.deployer);
  const startBalance = await requireBalance(ctx, MIN_BALANCE_HBAR);
  await ledger.step(`${K}:start`, "Run start", async () => ({
    noEvidence: true,
    data: { balance: startBalance.toString() },
  }));
  const runStart = BigInt(ledger.value(`${K}:start`, "balance"));

  const feed = TESTNET_ADDRESSES.chainlink["HBAR/USD"];
  const spot = await readSpot(feed.feed);
  console.log(`HBAR / USD spot ${ethers.formatUnits(spot.answer, spot.decimals)} (round ${spot.roundId})`);

  const market = await createMarket(ctx, ledger, `${K}:market`, {
    feedName: "HBAR/USD",
    kind: Kind.Above,
    lower: scaled(spot.answer, 95),
    upper: 0n,
    expiry: Math.floor(Date.now() / 1000) + MARKET_MINUTES * 60 + EXPIRY_MARGIN_SECONDS,
    label: `HBAR / USD Above, ${MARKET_MINUTES} minutes, strike 5 percent below spot`,
  });
  const expiry = Number(ledger.value(`${K}:market:create`, "expiry"));
  console.log(`Market ${market.id}, expiry ${new Date(expiry * 1000).toISOString()}`);

  await split(ctx, ledger, `${K}:market`, market.id, SPLIT_TINYBARS);
  const pair = await seedPool(ctx, ledger, `${K}:market`, market.id, market.yes, SPLIT_TINYBARS, LIQUIDITY_TINYBARS);
  console.log(`Pool ${pair}`);
  await recordBalances(ctx, ledger, `${K}:balance-before`, `Verdict balance before the scheduled run`, market.id);
  await trades(ctx, ledger, market.id, market.yes, market.no);

  await ledger.flush();
  await awaitResolution(ctx, ledger, market.id, expiry);
  await recordBalances(ctx, ledger, `${K}:balance-after`, `Verdict balance after the scheduled run`, market.id);
  const before = (name: string) => BigInt(ledger.value(`${K}:balance-before`, name));
  const after = (name: string) => BigInt(ledger.value(`${K}:balance-after`, name));
  const same = before("collateral") === after("collateral");
  console.log(
    `Collateral ${same ? "untouched" : "CHANGED"}: ${formatHbar(before("collateral"))} HBAR before, ` +
      `${formatHbar(after("collateral"))} HBAR after. Contract balance ${formatHbar(before("balance"))} ` +
      `before, ${formatHbar(after("balance"))} after; the difference is the resolution reserve spent on the scheduled call.`,
  );

  await redeem(ctx, ledger, market.id, market.yes, market.no);
  await hcsRecord(ledger, market.id);

  await ledger.flush(true);
  const endBalance = await balanceTinybars(ctx.deployer);
  const spent = runStart - endBalance;
  await ledger.step(`${K}:ledger-row`, "HBAR ledger row", async () => {
    const total = ledger.recordSpend(`e2e-testnet run, market ${market.id}`, spent);
    return { noEvidence: true, data: { spent: spent.toString(), total: total.toString() } };
  });

  ledger.printSummary();
  console.log(
    `Deployer: ${formatHbar(runStart)} HBAR at start, ${formatHbar(endBalance)} HBAR now, ${formatHbar(spent)} HBAR spent.`,
  );
  console.log(`Resolution: ${ledger.get(`${K}:resolution`)?.data?.how ?? "unknown"}`);
  console.log("Rows appended to docs/EVIDENCE.md, docs/COSTS.md and the HBAR ledger in docs/DECISIONS.md.");
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  console.error("The run stopped. Completed steps are in packages/hardhat/.testnet-run.json; rerun to resume.");
  process.exitCode = 1;
});
