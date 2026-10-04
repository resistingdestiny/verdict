import { expect } from "chai";
import { deployments, ethers, network } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import type { AddressLike, BytesLike } from "ethers";
import type { GuardedResolver } from "../typechain-types";
import { DAY, HOUR, Kind, SIX_HOURS, Status, createMarket, deployVerdict, pushRound } from "./helpers/verdict";
import { ONE_HBAR, now, setNextTime, setTime } from "./helpers/hedera";

const TOLERANCE_BPS = 150n;
const MAX_DELAY = 10n * 60n;
const SUPRA_STALENESS = 3n * HOUR;
const HBAR_USDT = 75n;
const MINUTE = 60n;
/** From the Chainlink feeds' 8 decimals to Supra's 18. */
const TO_18 = 10n ** 10n;

/** Chainlink HBAR / USD and Supra HBAR_USDT as read on Hedera testnet at 14:44 UTC on 2026-10-04. */
const CL_PRICE = 10_200_000n; // 0.10200 at 8 decimals
const SUPRA_PRICE = 101_550_000_000_000_000n; // 0.10155 at 18 decimals
const SUPRA_APART = 95_000_000_000_000_000n; // 0.09500, 6.9 percent below Chainlink

const NONE = [false, 0n, 0n, 0n, 0n];

/**
 * GuardedResolver passes on ChainlinkResolver's reading only when the Supra push oracle agrees with it, and
 * plugs into Verdict as any resolver does: allowed by the owner, with no change to Verdict.
 */
describe("GuardedResolver", function () {
  // loadFixture snapshots per file leak the mocks' state into later files, so this file restores the chain it found.
  let snapshot: string;
  before(async () => {
    snapshot = (await network.provider.send("evm_snapshot", [])) as string;
  });
  after(async () => {
    await network.provider.send("evm_revert", [snapshot]);
  });

  async function deployGuarded(
    chainlink: AddressLike,
    supra: AddressLike,
    feedIds: BytesLike[],
    pairs: bigint[],
  ): Promise<GuardedResolver> {
    const factory = await ethers.getContractFactory("GuardedResolver");
    return factory.deploy(chainlink, supra, TOLERANCE_BPS, MAX_DELAY, SUPRA_STALENESS, feedIds, pairs);
  }

  /**
   * A ChainlinkResolver over HBAR / USD and BTC / USD, with only HBAR / USD guarded by Supra pair 75. The two
   * oracles carry the testnet readings of 2026-10-04: Chainlink 14 minutes old, Supra 42 minutes old.
   */
  async function fixture() {
    const aggregator = await ethers.getContractFactory("MockAggregatorV3");
    const feed = await aggregator.deploy(8, "HBAR / USD");
    const btc = await aggregator.deploy(8, "BTC / USD");
    const feedId = ethers.zeroPadValue(await feed.getAddress(), 32);
    const btcId = ethers.zeroPadValue(await btc.getAddress(), 32);
    const chainlink = await (
      await ethers.getContractFactory("ChainlinkResolver")
    ).deploy([await feed.getAddress(), await btc.getAddress()], [SIX_HOURS, DAY]);
    const supra = await (await ethers.getContractFactory("MockSupraSValueFeed")).deploy();
    const guarded = await deployGuarded(chainlink, supra, [feedId], [HBAR_USDT]);
    const time = await now();
    const roundId = await pushRound(feed, CL_PRICE, time - 14n * MINUTE);
    await pushRound(btc, 110_000n * ONE_HBAR, time - MINUTE);
    await supra.setSvalue(HBAR_USDT, SUPRA_PRICE, 18, (time - 42n * MINUTE) * 1000n);
    return { feed, feedId, btcId, chainlink, supra, guarded, time, roundId };
  }

  async function readingOf(guarded: GuardedResolver, feedId: BytesLike, time: bigint) {
    return [...(await guarded.readingAt(feedId, time))];
  }

  describe("readingAt", function () {
    it("returns the Chainlink reading unchanged when Supra agrees within the tolerance", async function () {
      const { feedId, chainlink, guarded, time, roundId } = await loadFixture(fixture);
      const reading = await guarded.readingAt(feedId, time);
      expect(reading.ok).to.equal(true);
      expect(reading.answer).to.equal(CL_PRICE);
      expect(reading.decimals).to.equal(8n);
      expect(reading.roundId).to.equal(roundId);
      expect(reading.updatedAt).to.equal(time - 14n * MINUTE);
      expect([...reading]).to.deep.equal([...(await chainlink.readingAt(feedId, time))]);
    });

    it("refuses a reading when the prices are further apart than the tolerance, on either side", async function () {
      const { feedId, supra, guarded, time } = await loadFixture(fixture);
      const published = (time - MINUTE) * 1000n;
      await supra.setSvalue(HBAR_USDT, SUPRA_APART, 18, published);
      expect(await readingOf(guarded, feedId, time)).to.deep.equal(NONE);
      await supra.setSvalue(HBAR_USDT, 110_000_000_000_000_000n, 18, published);
      expect(await readingOf(guarded, feedId, time)).to.deep.equal(NONE);
    });

    it("accepts a gap of exactly the tolerance and refuses one unit more", async function () {
      const { feedId, supra, guarded, time } = await loadFixture(fixture);
      const published = (time - MINUTE) * 1000n;
      const gap = (CL_PRICE * TOLERANCE_BPS) / 10_000n; // 153_000, exact
      for (const [price, ok] of [
        [(CL_PRICE + gap) * TO_18, true],
        [(CL_PRICE + gap) * TO_18 + 1n, false],
        [(CL_PRICE - gap) * TO_18, true],
        [(CL_PRICE - gap) * TO_18 - 1n, false],
      ] as const) {
        await supra.setSvalue(HBAR_USDT, price, 18, published);
        expect((await guarded.readingAt(feedId, time)).ok, `Supra at ${price}`).to.equal(ok);
      }
    });

    it("refuses a Supra value published more than supraMaxStaleness before the requested time", async function () {
      const { feedId, supra, guarded, time } = await loadFixture(fixture);
      const oldest = (time - SUPRA_STALENESS) * 1000n;
      await supra.setSvalue(HBAR_USDT, SUPRA_PRICE, 18, oldest);
      expect((await guarded.readingAt(feedId, time)).ok).to.equal(true);
      await supra.setSvalue(HBAR_USDT, SUPRA_PRICE, 18, oldest - 1n);
      expect(await readingOf(guarded, feedId, time)).to.deep.equal(NONE);
    });

    it("refuses every reading once the call runs more than maxDelay after the requested time", async function () {
      const { feedId, chainlink, guarded, time } = await loadFixture(fixture);
      await setTime(time + MAX_DELAY - MINUTE);
      expect((await guarded.readingAt(feedId, time)).ok).to.equal(true);
      await setTime(time + MAX_DELAY + MINUTE);
      expect(await readingOf(guarded, feedId, time)).to.deep.equal(NONE);
      expect((await chainlink.readingAt(feedId, time)).ok, "Chainlink alone still answers").to.equal(true);
    });

    it("refuses when the Chainlink resolver has no fresh reading", async function () {
      const { feed, feedId, chainlink, guarded, time } = await loadFixture(fixture);
      await pushRound(feed, 0n, time - MINUTE);
      expect((await chainlink.readingAt(feedId, time)).ok).to.equal(false);
      expect(await readingOf(guarded, feedId, time)).to.deep.equal(NONE);
    });

    it("refuses when the wrapped resolver reverts or reports a non-positive answer", async function () {
      const { feedId, supra, time } = await loadFixture(fixture);
      const failing = await (await ethers.getContractFactory("MockFailingResolver")).deploy();
      const guarded = await deployGuarded(failing, supra, [feedId], [HBAR_USDT]);
      // MockFailingResolver answers 1 at 8 decimals; Supra agrees at 18.
      await supra.setSvalue(HBAR_USDT, TO_18, 18, time * 1000n);
      expect(await readingOf(guarded, feedId, time)).to.deep.equal([true, 1n, 8n, 1n, time]);
      await failing.setReverting(true);
      expect(await readingOf(guarded, feedId, time)).to.deep.equal(NONE);
      await failing.setReverting(false);
      await failing.setAnswer(0n);
      expect(await readingOf(guarded, feedId, time)).to.deep.equal(NONE);
      await failing.setAnswer(-1n);
      expect(await readingOf(guarded, feedId, time)).to.deep.equal(NONE);
    });

    it("refuses a feed with no Supra pair, though Chainlink knows it", async function () {
      const { btcId, chainlink, guarded, time } = await loadFixture(fixture);
      expect((await chainlink.readingAt(btcId, time)).ok).to.equal(true);
      expect(await readingOf(guarded, btcId, time)).to.deep.equal(NONE);
    });

    it("refuses when Supra reverts", async function () {
      const { feedId, supra, guarded, time } = await loadFixture(fixture);
      await supra.setReverting(true);
      expect(await readingOf(guarded, feedId, time)).to.deep.equal(NONE);
    });

    it("refuses a zero Supra price", async function () {
      const { feedId, supra, guarded, time } = await loadFixture(fixture);
      await supra.setSvalue(HBAR_USDT, 0n, 18, time * 1000n);
      expect(await readingOf(guarded, feedId, time)).to.deep.equal(NONE);
    });

    it("compares the prices at common decimals, whichever side has fewer", async function () {
      const { feedId, supra, guarded, time } = await loadFixture(fixture);
      const published = time * 1000n;
      await supra.setSvalue(HBAR_USDT, 101_550n, 6, published);
      expect((await guarded.readingAt(feedId, time)).answer, "Supra at 6 decimals").to.equal(CL_PRICE);
      await supra.setSvalue(HBAR_USDT, 95_000n, 6, published);
      expect(await readingOf(guarded, feedId, time)).to.deep.equal(NONE);
      await supra.setSvalue(HBAR_USDT, CL_PRICE, 8, published);
      expect((await guarded.readingAt(feedId, time)).answer, "Supra at 8 decimals").to.equal(CL_PRICE);
      await supra.setSvalue(HBAR_USDT, SUPRA_PRICE * 10n ** 59n, 77, published);
      expect((await guarded.readingAt(feedId, time)).answer, "Supra at 77 decimals").to.equal(CL_PRICE);
    });

    it("refuses prices that cannot be brought to common decimals", async function () {
      const { feedId, supra, guarded, time } = await loadFixture(fixture);
      const published = time * 1000n;
      await supra.setSvalue(HBAR_USDT, SUPRA_PRICE, 78, published);
      expect(await readingOf(guarded, feedId, time)).to.deep.equal(NONE);
      await supra.setSvalue(HBAR_USDT, ethers.MaxUint256, 0, published);
      expect(await readingOf(guarded, feedId, time)).to.deep.equal(NONE);

      const wide = await (await ethers.getContractFactory("MockAggregatorV3")).deploy(78, "WIDE / USD");
      const wideId = ethers.zeroPadValue(await wide.getAddress(), 32);
      const wideChainlink = await (
        await ethers.getContractFactory("ChainlinkResolver")
      ).deploy([await wide.getAddress()], [SIX_HOURS]);
      const overWide = await deployGuarded(wideChainlink, supra, [wideId], [HBAR_USDT]);
      await pushRound(wide, 1n, time - MINUTE);
      await supra.setSvalue(HBAR_USDT, SUPRA_PRICE, 18, published);
      expect((await wideChainlink.readingAt(wideId, time)).ok, "Chainlink at 78 decimals").to.equal(true);
      expect(await readingOf(overWide, wideId, time)).to.deep.equal(NONE);
    });
  });

  describe("delegation and configuration", function () {
    it("describe and feedDecimals answer as the wrapped resolver does", async function () {
      const { feedId, chainlink, supra, guarded } = await loadFixture(fixture);
      expect(await guarded.describe(feedId)).to.equal(await chainlink.describe(feedId));
      expect(await guarded.describe(feedId)).to.equal("HBAR / USD");
      expect(await guarded.feedDecimals(feedId)).to.equal(8n);
      const failing = await (await ethers.getContractFactory("MockFailingResolver")).deploy();
      const overFailing = await deployGuarded(failing, supra, [feedId], [HBAR_USDT]);
      expect(await overFailing.describe(feedId)).to.equal("Failing / Mock");
    });

    it("describe, feedDecimals and supraPairOf revert UnknownFeed for a feed with no Supra pair", async function () {
      const { btcId, guarded } = await loadFixture(fixture);
      await expect(guarded.describe(btcId)).to.be.revertedWithCustomError(guarded, "UnknownFeed").withArgs(btcId);
      await expect(guarded.feedDecimals(btcId)).to.be.revertedWithCustomError(guarded, "UnknownFeed").withArgs(btcId);
      await expect(guarded.supraPairOf(btcId)).to.be.revertedWithCustomError(guarded, "UnknownFeed").withArgs(btcId);
    });

    it("reports its configuration", async function () {
      const { feedId, chainlink, supra, guarded } = await loadFixture(fixture);
      expect(await guarded.chainlink()).to.equal(await chainlink.getAddress());
      expect(await guarded.supra()).to.equal(await supra.getAddress());
      expect(await guarded.toleranceBps()).to.equal(TOLERANCE_BPS);
      expect(await guarded.maxDelay()).to.equal(MAX_DELAY);
      expect(await guarded.supraMaxStaleness()).to.equal(SUPRA_STALENESS);
      expect(await guarded.feeds()).to.deep.equal([feedId]);
      expect(await guarded.supraPairOf(feedId)).to.equal(HBAR_USDT);
    });

    it("rejects a bad configuration at construction", async function () {
      const { feedId, btcId, chainlink, supra } = await loadFixture(fixture);
      const [, alice] = await ethers.getSigners();
      const factory = await ethers.getContractFactory("GuardedResolver");
      const build = (overrides: {
        chainlink?: AddressLike;
        supra?: AddressLike;
        tolerance?: bigint;
        delay?: bigint;
        staleness?: bigint;
        feedIds?: BytesLike[];
        pairs?: bigint[];
      }) =>
        factory.deploy(
          overrides.chainlink ?? chainlink,
          overrides.supra ?? supra,
          overrides.tolerance ?? TOLERANCE_BPS,
          overrides.delay ?? MAX_DELAY,
          overrides.staleness ?? SUPRA_STALENESS,
          overrides.feedIds ?? [feedId],
          overrides.pairs ?? [HBAR_USDT],
        );
      await expect(build({ chainlink: ethers.ZeroAddress }))
        .to.be.revertedWithCustomError(factory, "NotAContract")
        .withArgs(ethers.ZeroAddress);
      await expect(build({ supra: alice.address }))
        .to.be.revertedWithCustomError(factory, "NotAContract")
        .withArgs(alice.address);
      await expect(build({ tolerance: 0n }))
        .to.be.revertedWithCustomError(factory, "InvalidTolerance")
        .withArgs(0n);
      await expect(build({ tolerance: 10_001n }))
        .to.be.revertedWithCustomError(factory, "InvalidTolerance")
        .withArgs(10_001n);
      await expect(build({ delay: 0n })).to.be.revertedWithCustomError(factory, "ZeroDelay");
      await expect(build({ staleness: 0n })).to.be.revertedWithCustomError(factory, "ZeroStaleness");
      await expect(build({ pairs: [] })).to.be.revertedWithCustomError(factory, "LengthMismatch");
      await expect(build({ feedIds: [feedId, btcId, feedId], pairs: [75n, 0n, 1n] }))
        .to.be.revertedWithCustomError(factory, "DuplicateFeed")
        .withArgs(feedId);
      const widest = await build({ tolerance: 10_000n, feedIds: [feedId, btcId], pairs: [75n, 0n] });
      expect(await widest.supraPairOf(btcId)).to.equal(0n);
    });
  });

  describe("through Verdict", function () {
    /** Verdict with its ChainlinkResolver, and a GuardedResolver over it for the HBAR / USD feed, both allowed. */
    async function verdictFixture() {
      const ctx = await deployVerdict();
      const supra = await (await ethers.getContractFactory("MockSupraSValueFeed")).deploy();
      const guarded = await deployGuarded(ctx.resolver, supra, [ctx.feedId], [HBAR_USDT]);
      await ctx.verdict.setResolver(guarded, true);
      return { ctx, supra, guarded };
    }

    it("settles a guarded market on its schedule with the Chainlink answer", async function () {
      const { ctx, supra, guarded } = await loadFixture(verdictFixture);
      const market = await createMarket(ctx, { kind: Kind.Above, lower: 10_000_000n, resolver: guarded });
      await ctx.verdict.connect(ctx.alice).split(market.id, ctx.alice.address, ctx.alice.address, { value: ONE_HBAR });
      const updatedAt = market.expiry - 14n * MINUTE;
      const roundId = await pushRound(ctx.feed, CL_PRICE, updatedAt);
      await supra.setSvalue(HBAR_USDT, SUPRA_PRICE, 18, (market.expiry - 42n * MINUTE) * 1000n);

      const created = await ctx.verdict.getMarket(market.id);
      expect(created.resolver).to.equal(await guarded.getAddress());
      expect(created.decimals).to.equal(8n);
      const { expirySecond } = await ctx.hss.scheduleAt(created.schedule);
      await setNextTime(expirySecond);
      await expect(ctx.hss.executeSchedule(created.schedule))
        .to.emit(ctx.verdict, "Resolved")
        .withArgs(market.id, ONE_HBAR, CL_PRICE, roundId, updatedAt, true);

      const settled = await ctx.verdict.getMarket(market.id);
      expect(settled.status).to.equal(Status.Settled);
      expect(settled.answer).to.equal(CL_PRICE);
      expect(settled.settledBySchedule).to.equal(true);
    });

    it("defers a guarded market whose oracles disagree, and voids it 24 hours after expiry", async function () {
      const { ctx, supra, guarded } = await loadFixture(verdictFixture);
      const market = await createMarket(ctx, { kind: Kind.Above, lower: 10_000_000n, resolver: guarded });
      await pushRound(ctx.feed, CL_PRICE, market.expiry - 14n * MINUTE);
      await supra.setSvalue(HBAR_USDT, SUPRA_APART, 18, (market.expiry - 42n * MINUTE) * 1000n);

      const { schedule } = await ctx.verdict.getMarket(market.id);
      const { expirySecond } = await ctx.hss.scheduleAt(schedule);
      await setNextTime(expirySecond);
      await expect(ctx.hss.executeSchedule(schedule))
        .to.emit(ctx.verdict, "ResolveDeferred")
        .withArgs(market.id, "no fresh reading");
      expect((await ctx.verdict.getMarket(market.id)).status).to.equal(Status.Open);
      expect((await ctx.resolver.readingAt(ctx.feedId, market.expiry)).ok, "Chainlink alone would settle").to.equal(
        true,
      );

      // Supra comes back into line after maxDelay: too late to check the guard, so the market stays unsettled.
      await setTime(market.expiry + MAX_DELAY + 1n);
      await supra.setSvalue(HBAR_USDT, SUPRA_PRICE, 18, (market.expiry + MAX_DELAY) * 1000n);
      await expect(ctx.verdict.resolve(market.id))
        .to.be.revertedWithCustomError(ctx.verdict, "NoFreshReading")
        .withArgs(market.id);
      await expect(ctx.verdict.voidMarket(market.id)).to.be.revertedWithCustomError(ctx.verdict, "VoidTooEarly");

      await setNextTime(market.expiry + DAY);
      await expect(ctx.verdict.connect(ctx.bob).voidMarket(market.id))
        .to.emit(ctx.verdict, "Voided")
        .withArgs(market.id, ctx.bob.address);
      const voided = await ctx.verdict.getMarket(market.id);
      expect(voided.status).to.equal(Status.Void);
      expect(voided.payout).to.equal(ONE_HBAR / 2n);
    });

    it("settles by hand up to maxDelay after expiry and refuses one second later", async function () {
      const { ctx, supra, guarded } = await loadFixture(verdictFixture);
      const first = await createMarket(ctx, { kind: Kind.Above, lower: 10_000_000n, resolver: guarded });
      const second = await createMarket(ctx, { kind: Kind.Below, lower: 10_000_000n, resolver: guarded });
      const updatedAt = first.expiry - MINUTE;
      const roundId = await pushRound(ctx.feed, CL_PRICE, updatedAt);
      await supra.setSvalue(HBAR_USDT, SUPRA_PRICE, 18, (first.expiry - 10n * MINUTE) * 1000n);

      await setNextTime(first.expiry + MAX_DELAY);
      await expect(ctx.verdict.resolve(first.id))
        .to.emit(ctx.verdict, "Resolved")
        .withArgs(first.id, ONE_HBAR, CL_PRICE, roundId, updatedAt, false);
      await setNextTime(second.expiry + MAX_DELAY + 1n);
      await expect(ctx.verdict.resolve(second.id))
        .to.be.revertedWithCustomError(ctx.verdict, "NoFreshReading")
        .withArgs(second.id);
    });

    it("cannot create a market on a feed the guard does not cover", async function () {
      const { ctx, guarded } = await loadFixture(verdictFixture);
      const uncovered = ethers.zeroPadValue(ctx.carol.address, 32);
      await expect(
        ctx.verdict
          .connect(ctx.alice)
          .createMarket(guarded, uncovered, Kind.Above, 1n, 0n, (await now()) + HOUR, { value: ctx.creationCost }),
      )
        .to.be.revertedWithCustomError(guarded, "UnknownFeed")
        .withArgs(uncovered);
    });
  });

  describe("deploy script", function () {
    it("deploys the guard over the local ChainlinkResolver and allows it on Verdict", async function () {
      await deployments.fixture(["GuardedResolver"]);
      const verdict = await ethers.getContractAt("Verdict", (await deployments.get("Verdict")).address);
      const guarded = await ethers.getContractAt("GuardedResolver", (await deployments.get("GuardedResolver")).address);
      expect(await verdict.resolverAllowed(guarded)).to.equal(true);
      expect(await guarded.chainlink()).to.equal((await deployments.get("ChainlinkResolver")).address);
      expect(await guarded.toleranceBps()).to.equal(TOLERANCE_BPS);
      expect(await guarded.maxDelay()).to.equal(MAX_DELAY);
      expect(await guarded.supraMaxStaleness()).to.equal(SUPRA_STALENESS);

      const feeds = await guarded.feeds();
      expect(await Promise.all(feeds.map(id => guarded.supraPairOf(id)))).to.deep.equal([75n, 0n, 1n]);
      expect(await Promise.all(feeds.map(id => guarded.describe(id)))).to.deep.equal([
        "HBAR / USD",
        "BTC / USD",
        "ETH / USD",
      ]);
      const reading = await guarded.readingAt(feeds[0], await now());
      expect(reading.ok, "the mock Supra feed starts in line with the mock aggregators").to.equal(true);
      expect(reading.answer).to.equal(8_000_000n);
    });
  });
});
