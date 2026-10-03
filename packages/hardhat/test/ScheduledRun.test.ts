import { expect } from "chai";
import { ethers, network } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { Kind, Status, deployVerdict, createMarket, pushRound } from "./helpers/verdict";
import { ONE_HBAR, now, setBalance, setNextTime, setTime } from "./helpers/hedera";

/**
 * On Hedera the network executes a schedule at or after its expiry second by consensus time, but
 * block.timestamp inside that call can trail consensus time by a second or two (seen on testnet on
 * 2026-10-03: a run at consensus 16:15:36 for an expiry of 16:15:35 reported "not expired" and the schedule
 * was consumed). A call Verdict makes to itself can only be the network running the schedule, so that run
 * trusts the schedule's timing. Every other caller still waits for block.timestamp to pass the expiry.
 */
describe("Scheduled run timing", function () {
  // loadFixture snapshots per file leak the mocks' state into later files, so this file restores the chain it found.
  let snapshot: string;
  before(async () => {
    snapshot = (await network.provider.send("evm_snapshot", [])) as string;
  });
  after(async () => {
    await network.provider.send("evm_revert", [snapshot]);
  });

  async function fixture() {
    const ctx = await deployVerdict();
    const expiry = (await now()) + 3600n;
    const market = await createMarket(ctx, { kind: Kind.Above, lower: 100n, expiry });
    await ctx.verdict.connect(ctx.alice).split(market.id, ctx.alice.address, ctx.alice.address, { value: ONE_HBAR });
    const roundId = await pushRound(ctx.feed, 150n, expiry - 10n);
    return { ctx, market, expiry, roundId };
  }

  async function asVerdict(ctx: Awaited<ReturnType<typeof deployVerdict>>) {
    const address = await ctx.verdict.getAddress();
    await network.provider.send("hardhat_impersonateAccount", [address]);
    // Gas is priced in wei on the Hardhat network, so the impersonated contract needs a large balance to pay for it.
    await setBalance(address, 10n ** 20n);
    return ethers.getSigner(address);
  }

  it("settles when the schedule runs during the expiry second with a lagging block timestamp", async function () {
    const { ctx, market, expiry, roundId } = await loadFixture(fixture);
    const self = await asVerdict(ctx);
    await setNextTime(expiry);
    await expect(ctx.verdict.connect(self).resolveScheduled(market.id))
      .to.emit(ctx.verdict, "Resolved")
      .withArgs(market.id, ONE_HBAR, 150n, roundId, expiry - 10n, true);
    const settled = await ctx.verdict.getMarket(market.id);
    expect(settled.status).to.equal(Status.Settled);
    expect(settled.settledBySchedule).to.equal(true);
  });

  it("a run by the contract itself is not held to block.timestamp, because HSS holds it to the expiry second", async function () {
    const { ctx, market, expiry } = await loadFixture(fixture);
    const self = await asVerdict(ctx);
    await setNextTime(expiry - 5n);
    await expect(ctx.verdict.connect(self).resolveScheduled(market.id))
      .to.emit(ctx.verdict, "Resolved")
      .withArgs(market.id, ONE_HBAR, 150n, (await ctx.feed.latestRoundData())[0], expiry - 10n, true);
  });

  it("an account calling resolveScheduled during the expiry second is deferred as not expired", async function () {
    const { ctx, market, expiry } = await loadFixture(fixture);
    await setNextTime(expiry);
    await expect(ctx.verdict.connect(ctx.bob).resolveScheduled(market.id))
      .to.emit(ctx.verdict, "ResolveDeferred")
      .withArgs(market.id, "not expired");
    expect((await ctx.verdict.getMarket(market.id)).status).to.equal(Status.Open);
  });

  it("resolve from an account during the expiry second reverts MarketNotExpired", async function () {
    const { ctx, market, expiry } = await loadFixture(fixture);
    await setNextTime(expiry);
    await expect(ctx.verdict.connect(ctx.bob).resolve(market.id))
      .to.be.revertedWithCustomError(ctx.verdict, "MarketNotExpired")
      .withArgs(market.id);
    await setTime(expiry + 1n);
    await ctx.verdict.connect(ctx.bob).resolve(market.id);
    expect((await ctx.verdict.getMarket(market.id)).settledBySchedule).to.equal(false);
  });
});
