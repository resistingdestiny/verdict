import { expect } from "chai";
import { artifacts, ethers, network } from "hardhat";
import type { MockHtsToken, MockSaucerSwapPair } from "../typechain-types";
import { now, ONE_HBAR, setTime } from "./helpers/hedera";
import { createMarket, expectInvariants, Kind, pushRound, RESERVE, Status } from "./helpers/verdict";
import {
  deployTrading,
  expectNoDexAllowance,
  expectRouterEmpty,
  seedPool,
  type TradingContext,
} from "./helpers/trading";

const SEED_YES = 20n * ONE_HBAR; // 20 whole YES
const SEED_HBAR = 10n * ONE_HBAR; // 10 HBAR against them, an even 0.5 price
const LOWER = 1_000_00000000n; // 1000 USD in the feed's 8 decimals
const ANSWER = 1_500_00000000n;

/// Function selectors a DEX integration would need. Verdict's bytecode must contain none of them.
const DEX_SELECTORS: Record<string, string> = {
  "swapExactETHForTokens(uint256,address[],address,uint256)": "7ff36ab5",
  "swapExactTokensForETH(uint256,uint256,address[],address,uint256)": "18cbafe5",
  "swapETHForExactTokens(uint256,address[],address,uint256)": "fb3bdb41",
  "addLiquidityETH(address,uint256,uint256,uint256,address,uint256)": "f305d719",
  "approve(address,uint256)": "095ea7b3",
  "approve(address,address,uint256)": "e1f21c67",
};

/**
 * The four router trades against the real Verdict, end to end: create a market, seed its pool through
 * the mock SaucerSwap router, trade all four ways, settle through the HSS mock and redeem every leg.
 * After every step the router is empty and the six invariants hold.
 */
describe("Integration: VerdictRouter against Verdict", function () {
  type Fixture = TradingContext & {
    id: bigint;
    expiry: bigint;
    yes: MockHtsToken;
    no: MockHtsToken;
    pair: MockSaucerSwapPair;
    pairAddress: string;
  };

  async function deployWithSeededMarket(): Promise<Fixture> {
    const ctx = await deployTrading();
    const { id, expiry, yes, no } = await createMarket(ctx, { kind: Kind.Above, lower: LOWER, lead: 3600n });
    await seedPool(ctx, ctx.alice, id, SEED_YES, SEED_HBAR);
    const pairAddress = await ctx.router.pairOf(id);
    const pair = await ethers.getContractAt("MockSaucerSwapPair", pairAddress);
    return { ...ctx, id, expiry, yes, no, pair, pairAddress };
  }

  /** Invariants 1 to 3 through the shared helper, 4 through the recorded payout, 6 through allowances. */
  let fixedPayout: bigint | undefined;
  async function check(f: Fixture): Promise<void> {
    await expectInvariants(f, [f.id]);
    await expectRouterEmpty(f, [f.yes, f.no]);
    await expectNoDexAllowance(f, f.yes, f.pairAddress);
    await expectNoDexAllowance(f, f.no, f.pairAddress);
    const m = await f.verdict.getMarket(f.id);
    if (m.status !== BigInt(Status.Open)) {
      fixedPayout ??= m.payout;
      expect(m.payout, "payout never changes once written").to.equal(fixedPayout);
    }
  }

  // One deployment for the file, a snapshot per test, and the chain restored afterwards so the fixtures
  // of later files do not inherit this one's HTS mock state.
  let f: Fixture;
  let clean: string;
  let base: string;

  before(async function () {
    clean = await network.provider.send("evm_snapshot", []);
    f = await deployWithSeededMarket();
    base = await network.provider.send("evm_snapshot", []);
  });

  beforeEach(async function () {
    await network.provider.send("evm_revert", [base]);
    base = await network.provider.send("evm_snapshot", []);
    fixedPayout = undefined;
  });

  after(async function () {
    await network.provider.send("evm_revert", [clean]);
  });

  it("Verdict's bytecode holds no DEX or allowance selector (invariant 6)", async function () {
    const { deployedBytecode } = await artifacts.readArtifact("Verdict");
    for (const [signature, selector] of Object.entries(DEX_SELECTORS)) {
      expect(deployedBytecode.includes(selector), `no ${signature}`).to.equal(false);
    }
  });

  it("seeds the pool at an even price and leaves the creator holding the NO leg", async function () {
    expect(await f.router.impliedProbability(f.id)).to.equal(ONE_HBAR / 2n);
    expect(await f.router.reserves(f.id)).to.deep.equal([SEED_YES, SEED_HBAR]);
    expect(await f.yes.balanceOf(f.alice.address)).to.equal(0n);
    expect(await f.no.balanceOf(f.alice.address)).to.equal(SEED_YES);
    expect((await f.verdict.getMarket(f.id)).collateral).to.equal(SEED_YES);
    await check(f);
  });

  it("runs all four trades, settles through the schedule and redeems every leg", async function () {
    const { verdict, router, hss, feed, alice, bob, owner, id, expiry, yes, no } = f;
    const deadline = (await now()) + 3600n;

    // buyYes: HBAR in, the quoted YES out.
    const yesQuote = await router.quoteBuyYes(id, ONE_HBAR);
    expect(yesQuote).to.be.gt(0n);
    const buyYes = router.connect(bob).buyYes(id, yesQuote, deadline, { value: ONE_HBAR });
    await expect(buyYes).to.changeEtherBalance(bob, -ONE_HBAR);
    await expect(buyYes).to.emit(router, "Traded").withArgs(id, bob.address, 0n, ONE_HBAR, yesQuote, 0n);
    expect(await yes.balanceOf(bob.address)).to.equal(yesQuote);
    await check(f);

    // sellYes: half the YES back for the quoted HBAR.
    const yesIn = yesQuote / 2n;
    const hbarQuote = await router.quoteSellYes(id, yesIn);
    expect(hbarQuote).to.be.gt(0n);
    await yes.connect(bob).approve(f.routerAddress, yesIn);
    const sellYes = router.connect(bob).sellYes(id, yesIn, hbarQuote, deadline);
    await expect(sellYes).to.changeEtherBalance(bob, hbarQuote);
    await expect(sellYes).to.emit(router, "Traded").withArgs(id, bob.address, 1n, yesIn, hbarQuote, 0n);
    expect(await yes.balanceOf(bob.address)).to.equal(yesQuote - yesIn);
    await check(f);

    // buyNo: split through Verdict, sell the YES leg, keep the NO and the proceeds.
    const [noQuote, backQuote] = await router.quoteBuyNo(id, ONE_HBAR);
    expect(noQuote).to.equal(ONE_HBAR);
    expect(backQuote).to.be.gt(0n);
    const collateralBefore = (await verdict.getMarket(id)).collateral;
    const buyNo = router.connect(bob).buyNo(id, backQuote, deadline, { value: ONE_HBAR });
    await expect(buyNo).to.changeEtherBalance(bob, backQuote - ONE_HBAR);
    await expect(buyNo).to.emit(router, "Traded").withArgs(id, bob.address, 2n, ONE_HBAR, ONE_HBAR, backQuote);
    expect(await no.balanceOf(bob.address)).to.equal(ONE_HBAR);
    expect((await verdict.getMarket(id)).collateral).to.equal(collateralBefore + ONE_HBAR);
    await check(f);

    // sellNo: buy the matching YES, merge through Verdict, forward the refund.
    const noIn = ONE_HBAR / 2n;
    const [needed, outQuote] = await router.quoteSellNo(id, noIn);
    expect(outQuote).to.equal(noIn);
    const extra = ONE_HBAR / 10n;
    await no.connect(bob).approve(f.routerAddress, noIn);
    const sellNo = router.connect(bob).sellNo(id, noIn, noIn, deadline, { value: needed + extra });
    await expect(sellNo).to.changeEtherBalance(bob, noIn - needed);
    await expect(sellNo).to.emit(router, "Traded").withArgs(id, bob.address, 3n, noIn, noIn, extra);
    expect(await no.balanceOf(bob.address)).to.equal(ONE_HBAR - noIn);
    expect((await verdict.getMarket(id)).collateral).to.equal(collateralBefore + ONE_HBAR - noIn);
    await check(f);

    // Slippage and deadline bounds bite against the real Verdict too.
    await expect(
      router.connect(bob).buyYes(id, (await router.quoteBuyYes(id, ONE_HBAR)) + 1n, deadline, { value: ONE_HBAR }),
    ).to.be.revertedWithCustomError(router, "Slippage");
    await expect(
      router.connect(bob).buyNo(id, 0n, (await now()) - 1n, { value: ONE_HBAR }),
    ).to.be.revertedWithCustomError(router, "Expired");
    await check(f);

    // Settlement through the HSS mock at expiry, on the round current at expiry.
    const roundId = await pushRound(feed, ANSWER, expiry - 10n);
    await setTime(expiry);
    const schedule = (await verdict.getMarket(id)).schedule;
    await expect(hss.executeSchedule(schedule))
      .to.emit(verdict, "Resolved")
      .withArgs(id, ONE_HBAR, ANSWER, roundId, expiry - 10n, true);
    const settled = await verdict.getMarket(id);
    expect(settled.status).to.equal(Status.Settled);
    expect(settled.payout).to.equal(ONE_HBAR);
    expect(settled.settledBySchedule).to.equal(true);
    expect(await verdict.pendingReserves()).to.equal(0n);
    await check(f);

    // After expiry the pool still trades YES, but buyNo cannot split any more.
    await expect(
      router.connect(bob).buyNo(id, 0n, (await now()) + 60n, { value: ONE_HBAR }),
    ).to.be.revertedWithCustomError(verdict, "MarketNotOpen");
    await check(f);

    // The seeder pulls the pool and everyone redeems. YES pays in full, NO pays nothing.
    const liquidity = await f.pair.lpBalanceOf(alice.address);
    await f.pair.connect(alice).lpApprove(f.saucerRouterAddress, liquidity);
    await f.saucerRouter
      .connect(alice)
      .removeLiquidityETH(await yes.getAddress(), liquidity, 0n, 0n, alice.address, (await now()) + 60n);
    await check(f);

    for (const holder of [alice, bob]) {
      const yesHeld = await yes.balanceOf(holder.address);
      const noHeld = await no.balanceOf(holder.address);
      await yes.connect(holder).approve(f.verdictAddress, yesHeld);
      await no.connect(holder).approve(f.verdictAddress, noHeld);
      const redeem = verdict.connect(holder).redeem(id, yesHeld, noHeld, holder.address);
      await expect(redeem).to.changeEtherBalance(holder, yesHeld);
      await expect(redeem)
        .to.emit(verdict, "Redeemed")
        .withArgs(id, holder.address, yesHeld, noHeld, yesHeld, holder.address);
      await check(f);
    }

    // Only the pool's locked minimum liquidity is left unredeemed, and the reserve is now surplus.
    const dust = await yes.totalSupply();
    expect(dust).to.equal(await yes.balanceOf(f.pairAddress));
    expect(dust).to.be.lt(ONE_HBAR / 1000n);
    expect((await verdict.getMarket(id)).collateral).to.be.gte(dust);
    const surplus = (await ethers.provider.getBalance(f.verdictAddress)) - (await verdict.totalCollateral());
    expect(surplus).to.be.gte(RESERVE);
    await expect(verdict.connect(owner).sweepSurplus(owner.address))
      .to.emit(verdict, "SurplusSwept")
      .withArgs(owner.address, surplus);
    await check(f);
  });

  it("voids a market with no fresh reading and the router's sellNo still merges at 0.5 HBAR", async function () {
    const { verdict, router, bob, id, expiry, no } = f;
    const deadline = (await now()) + 3600n;
    await router.connect(bob).buyNo(id, 0n, deadline, { value: ONE_HBAR });
    await check(f);

    await setTime(expiry + 24n * 3600n);
    await expect(verdict.resolve(id)).to.be.revertedWithCustomError(verdict, "NoFreshReading");
    await expect(verdict.voidMarket(id)).to.emit(verdict, "Voided");
    expect((await verdict.getMarket(id)).payout).to.equal(ONE_HBAR / 2n);
    await check(f);

    const [needed] = await router.quoteSellNo(id, ONE_HBAR);
    await no.connect(bob).approve(f.routerAddress, ONE_HBAR);
    const sellNo = router.connect(bob).sellNo(id, ONE_HBAR, ONE_HBAR, (await now()) + 60n, { value: needed });
    await expect(sellNo).to.changeEtherBalance(bob, ONE_HBAR - needed);
    await check(f);
  });
});
