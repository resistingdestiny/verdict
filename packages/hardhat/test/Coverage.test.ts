import { expect } from "chai";
import { ethers, network } from "hardhat";
import type { MockCaller, MockHtsToken } from "../typechain-types";
import { now, ONE_HBAR, setTime } from "./helpers/hedera";
import { createMarket, INT64_MAX, Kind, pushRound } from "./helpers/verdict";
import { deployTrading, seedPool, type TradingContext } from "./helpers/trading";

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
      await setTime(expiry);
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
