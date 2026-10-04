import { expect } from "chai";
import { ethers, network } from "hardhat";
import type { MockCaller, MockHtsToken } from "../typechain-types";
import { now, ONE_HBAR, setTime } from "./helpers/hedera";
import { createMarket, INT64_MAX, Kind, pushRound } from "./helpers/verdict";
import { deployTrading, seedPool, WHBAR_TOKEN, type TradingContext } from "./helpers/trading";

const CODE_SUCCESS = 22n;
const CODE_INVALID_SIGNATURE = 7n;
const REENTRANCY_GUARD_REENTRANT_CALL = ethers.id("ReentrancyGuardReentrantCall()").slice(0, 10);

/**
 * Edge paths the lifecycle, router and property tests do not reach: HTS codes the mocks only produce
 * on request, value parked in the router by strangers, degenerate quotes, and the reentrancy guards on the two
 * functions whose payments go to the caller rather than to a chosen recipient.
 */
describe("Coverage: edge paths of Verdict and VerdictRouter", function () {
  let ctx: TradingContext;
  let id: bigint;
  let expiry: bigint;
  let yes: MockHtsToken;
  let no: MockHtsToken;
  let clean: string;
  let base: string;
  let deadline: bigint;

  before(async function () {
    clean = await network.provider.send("evm_snapshot", []);
    ctx = await deployTrading();
    ({ id, expiry, yes, no } = await createMarket(ctx, { kind: Kind.Above, lower: 1000n, lead: 3600n }));
    await seedPool(ctx, ctx.alice, id, 20n * ONE_HBAR, 10n * ONE_HBAR);
    base = await network.provider.send("evm_snapshot", []);
  });

  beforeEach(async function () {
    await network.provider.send("evm_revert", [base]);
    base = await network.provider.send("evm_snapshot", []);
    deadline = (await now()) + 3600n;
  });

  after(async function () {
    await network.provider.send("evm_revert", [clean]);
  });

  async function deployCaller(): Promise<MockCaller> {
    const caller = await (await ethers.getContractFactory("MockCaller")).deploy();
    await ctx.hts.setAutoAssociationSlots(await caller.getAddress(), ethers.MaxUint256);
    return caller;
  }

  describe("VerdictRouter", function () {
    it("quotes zero for zero input", async function () {
      expect(await ctx.router.quoteBuyYes(id, 0n)).to.equal(0n);
      expect(await ctx.router.quoteSellYes(id, 0n)).to.equal(0n);
      expect(await ctx.router.quoteBuyNo(id, 0n)).to.deep.equal([0n, 0n]);
      expect(await ctx.router.quoteSellNo(id, 0n)).to.deep.equal([0n, 0n]);
    });

    it("clamps the implied probability at 1 HBAR when the pool holds more HBAR than YES", async function () {
      const other = await createMarket(ctx, { kind: Kind.Below, lower: 1000n, lead: 3600n, creator: ctx.bob });
      await seedPool(ctx, ctx.bob, other.id, 5n * ONE_HBAR, 10n * ONE_HBAR);
      expect(await ctx.router.reserves(other.id)).to.deep.equal([5n * ONE_HBAR, 10n * ONE_HBAR]);
      expect(await ctx.router.impliedProbability(other.id)).to.equal(ONE_HBAR);
    });

    it("still trades when a stranger parked HBAR in the router, and leaves the dust where it was", async function () {
      const { bob, router } = ctx;
      await bob.sendTransaction({ to: ctx.routerAddress, value: 1n });
      await expect(router.connect(bob).buyYes(id, 0n, deadline, { value: ONE_HBAR })).to.emit(router, "Traded");
      expect(await ethers.provider.getBalance(ctx.routerAddress)).to.equal(1n);
      await yes.connect(bob).approve(ctx.routerAddress, ONE_HBAR);
      await expect(router.connect(bob).sellYes(id, ONE_HBAR, 0n, deadline)).to.emit(router, "Traded");
      expect(await ethers.provider.getBalance(ctx.routerAddress)).to.equal(1n);
    });

    it("still trades when NO or YES was parked in the router", async function () {
      const { bob, router } = ctx;
      await router.connect(bob).buyNo(id, 0n, deadline, { value: ONE_HBAR });
      await router.connect(bob).buyYes(id, 0n, deadline, { value: ONE_HBAR });
      await no.connect(bob).transfer(ctx.routerAddress, 1n);
      await yes.connect(bob).transfer(ctx.routerAddress, 1n);
      await expect(router.connect(bob).buyYes(id, 0n, deadline, { value: ONE_HBAR })).to.emit(router, "Traded");
      await expect(router.connect(bob).buyNo(id, 0n, deadline, { value: ONE_HBAR })).to.emit(router, "Traded");
      const noIn = ONE_HBAR / 2n;
      const [needed] = await router.quoteSellNo(id, noIn);
      await no.connect(bob).approve(ctx.routerAddress, noIn);
      await expect(router.connect(bob).sellNo(id, noIn, 0n, deadline, { value: needed })).to.emit(router, "Traded");
      expect(await yes.balanceOf(ctx.routerAddress)).to.equal(1n);
      expect(await no.balanceOf(ctx.routerAddress)).to.equal(1n);
    });

    it("reverts RouterNotEmpty when a trade leaves the router holding more than it began with", async function () {
      // A trader contract that pushes 1 NO into the router from the sellNo payout: the trade itself
      // would end with more NO than it began with, which is the one thing the final check forbids.
      const { bob, router, hts, verdict } = ctx;
      const caller = await deployCaller();
      const callerAddress = await caller.getAddress();
      const noIn = ONE_HBAR;
      await verdict.connect(bob).split(id, bob.address, callerAddress, { value: 2n * noIn });
      await caller.call(
        await hts.getAddress(),
        hts.interface.encodeFunctionData("approve", [await no.getAddress(), ctx.routerAddress, noIn]),
      );
      const [needed] = await router.quoteSellNo(id, noIn);
      const trade = router.interface.encodeFunctionData("sellNo", [id, noIn, 0n, deadline]);
      await caller.arm(await no.getAddress(), no.interface.encodeFunctionData("transfer", [ctx.routerAddress, 1n]));
      await expect(caller.call(ctx.routerAddress, trade, { value: needed })).to.be.revertedWithCustomError(
        router,
        "RouterNotEmpty",
      );
    });

    it("reverts RouterNotEmpty when a trader pushes HBAR or YES into the router from its payout", async function () {
      // The same final check as above, reached through its HBAR and YES terms: a trader contract sells YES
      // and, from the HBAR payout, sends 1 tinybar back to the router, or moves 1 YES into it.
      const { bob, router, hts, verdict } = ctx;
      const yesIn = ONE_HBAR;
      const sellYes = router.interface.encodeFunctionData("sellYes", [id, yesIn, 0n, deadline]);
      for (const push of ["hbar", "yes"] as const) {
        const caller = await deployCaller();
        const callerAddress = await caller.getAddress();
        await verdict.connect(bob).split(id, callerAddress, bob.address, { value: 2n * yesIn });
        await caller.call(
          await hts.getAddress(),
          hts.interface.encodeFunctionData("approve", [await yes.getAddress(), ctx.routerAddress, yesIn]),
        );
        if (push === "hbar") {
          await caller.arm(ctx.routerAddress, "0x");
          await caller.setReenterValue(1n);
        } else {
          await caller.arm(
            await yes.getAddress(),
            yes.interface.encodeFunctionData("transfer", [ctx.routerAddress, 1n]),
          );
        }
        await expect(caller.call(ctx.routerAddress, sellYes)).to.be.revertedWithCustomError(router, "RouterNotEmpty");
      }
    });

    it("quotes and settles sellNo at a net of zero when the YES leg costs more than the NO is worth", async function () {
      // The pool holds 20 YES against 10 HBAR, so buying back 10 YES costs about 10.03 HBAR: more than the
      // 10 HBAR the merge returns. The quote's net is zero, a positive bound fails, and a zero bound trades.
      const { bob, router, verdict } = ctx;
      const noIn = 10n * ONE_HBAR;
      const [needed, net] = await router.quoteSellNo(id, noIn);
      expect(needed).to.be.greaterThan(noIn);
      expect(net).to.equal(0n);
      await verdict.connect(bob).split(id, bob.address, bob.address, { value: noIn });
      await no.connect(bob).approve(ctx.routerAddress, noIn);
      await expect(router.connect(bob).sellNo(id, noIn, 1n, deadline, { value: needed }))
        .to.be.revertedWithCustomError(router, "Slippage")
        .withArgs(1n, 0n);
      const extra = ONE_HBAR;
      const trade = router.connect(bob).sellNo(id, noIn, 0n, deadline, { value: needed + extra });
      await expect(trade).to.emit(router, "Traded").withArgs(id, bob.address, 3n, noIn, noIn, extra);
      await expect(trade).to.changeEtherBalance(bob, noIn - needed);
    });

    it("reports reserves as YES then HBAR whichever side of the pair the YES token is on", async function () {
      const pool = await (await ethers.getContractFactory("MockPoolView")).deploy();
      const viewRouter = await (
        await ethers.getContractFactory("VerdictRouter")
      ).deploy(ctx.verdictAddress, ctx.saucerRouterAddress, await pool.getAddress(), WHBAR_TOKEN);
      const yesReserve = 7n * ONE_HBAR;
      const hbarReserve = 3n * ONE_HBAR;
      await pool.set(await yes.getAddress(), yesReserve, hbarReserve);
      expect(await viewRouter.reserves(id)).to.deep.equal([yesReserve, hbarReserve]);
      await pool.set(WHBAR_TOKEN, hbarReserve, yesReserve);
      expect(await viewRouter.reserves(id)).to.deep.equal([yesReserve, hbarReserve]);
      expect(await viewRouter.impliedProbability(id)).to.equal((hbarReserve * ONE_HBAR) / yesReserve);
    });

    it("surfaces an HTS association failure as HtsError", async function () {
      const { bob, router, hts } = ctx;
      await router.connect(bob).buyYes(id, 0n, deadline, { value: ONE_HBAR });
      await yes.connect(bob).approve(ctx.routerAddress, ONE_HBAR);
      await hts.setForcedCode(hts.interface.getFunction("associateToken").selector, CODE_INVALID_SIGNATURE);
      await expect(router.connect(bob).sellYes(id, ONE_HBAR, 0n, deadline))
        .to.be.revertedWithCustomError(router, "HtsError")
        .withArgs(CODE_INVALID_SIGNATURE);
    });

    it("surfaces an HTS approval failure as HtsError", async function () {
      const { bob, router, hts } = ctx;
      await router.connect(bob).buyYes(id, 0n, deadline, { value: ONE_HBAR });
      await yes.connect(bob).approve(ctx.routerAddress, ONE_HBAR);
      await hts.setForcedCode(hts.interface.getFunction("approve").selector, CODE_INVALID_SIGNATURE);
      await expect(router.connect(bob).sellYes(id, ONE_HBAR, 0n, deadline))
        .to.be.revertedWithCustomError(router, "HtsError")
        .withArgs(CODE_INVALID_SIGNATURE);
    });

    it("reverts TransferFailed when the seller refuses the HBAR from sellNo", async function () {
      const { bob, router, hts, verdict } = ctx;
      const caller = await deployCaller();
      const callerAddress = await caller.getAddress();
      const noIn = ONE_HBAR;
      await verdict.connect(bob).split(id, bob.address, callerAddress, { value: noIn });
      await caller.call(
        await hts.getAddress(),
        hts.interface.encodeFunctionData("approve", [await no.getAddress(), ctx.routerAddress, noIn]),
      );
      const [needed] = await router.quoteSellNo(id, noIn);
      const trade = router.interface.encodeFunctionData("sellNo", [id, noIn, 0n, deadline]);
      await caller.setRejectHbar(true);
      await expect(caller.call(ctx.routerAddress, trade, { value: needed }))
        .to.be.revertedWithCustomError(router, "TransferFailed")
        .withArgs(callerAddress, noIn);
      await caller.setRejectHbar(false);
      await expect(caller.call(ctx.routerAddress, trade, { value: needed })).to.changeEtherBalance(caller, noIn);
    });
  });

  describe("Verdict", function () {
    it("rejects a NO redemption beyond int64 even when the YES amount is fine", async function () {
      const { verdict, feed, bob } = ctx;
      await pushRound(feed, 1500n, expiry - 1n);
      await setTime(expiry + 1n);
      await verdict.resolve(id);
      await expect(verdict.connect(bob).redeem(id, 0n, INT64_MAX + 1n, bob.address)).to.be.revertedWithCustomError(
        verdict,
        "AmountTooLarge",
      );
    });

    it("treats a schedule reported as success without an address as failed", async function () {
      const { verdict, hss, alice, resolver, feedId, creationCost } = ctx;
      await hss.setForcedCode(CODE_SUCCESS);
      const next = await verdict.marketCount();
      await expect(
        verdict.connect(alice).createMarket(resolver, feedId, Kind.Above, 1n, 0n, (await now()) + 3600n, {
          value: creationCost,
        }),
      )
        .to.emit(verdict, "ScheduleFailed")
        .withArgs(next, CODE_SUCCESS);
      expect((await verdict.getMarket(next)).schedule).to.equal(ethers.ZeroAddress);
    });

    it("surfaces exhausted automatic association slots (code 262) as NotAssociated", async function () {
      const { verdict, hts, carol } = ctx;
      await hts.setAutoAssociationSlots(carol.address, 1n);
      // YES takes the one slot; NO then fails with 262 rather than 184.
      await expect(verdict.connect(carol).split(id, carol.address, carol.address, { value: ONE_HBAR }))
        .to.be.revertedWithCustomError(verdict, "NotAssociated")
        .withArgs(await no.getAddress());
    });

    it("blocks a creator that re-enters createMarket from its refund", async function () {
      const { verdict, resolver, feedId, creationCost } = ctx;
      const caller = await deployCaller();
      const create = verdict.interface.encodeFunctionData("createMarket", [
        await resolver.getAddress(),
        feedId,
        Kind.Above,
        1n,
        0n,
        (await now()) + 3600n,
      ]);
      await caller.arm(ctx.verdictAddress, create);
      const before = await verdict.marketCount();
      await caller.call(ctx.verdictAddress, create, { value: creationCost + 1n });
      expect(await verdict.marketCount()).to.equal(before + 1n);
      expect(await caller.reentered()).to.equal(false);
      expect(await caller.reentryResult()).to.equal(REENTRANCY_GUARD_REENTRANT_CALL);
    });

    it("blocks an owner that re-enters sweepSurplus from the payment", async function () {
      const { bob } = ctx;
      const caller = await deployCaller();
      const callerAddress = await caller.getAddress();
      const owned = await (await ethers.getContractFactory("Verdict")).deploy(callerAddress, ONE_HBAR);
      const ownedAddress = await owned.getAddress();
      await bob.sendTransaction({ to: ownedAddress, value: ONE_HBAR });
      const sweep = owned.interface.encodeFunctionData("sweepSurplus", [callerAddress]);
      await caller.arm(ownedAddress, sweep);
      await expect(caller.call(ownedAddress, sweep)).to.changeEtherBalances([owned, caller], [-ONE_HBAR, ONE_HBAR]);
      expect(await caller.reentered()).to.equal(false);
      expect(await caller.reentryResult()).to.equal(REENTRANCY_GUARD_REENTRANT_CALL);
    });
  });
});
