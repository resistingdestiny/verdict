import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { HOUR, PHASE, pushRound } from "./helpers/verdict";

const STALENESS = HOUR;
const T = 1_800_000_000n; // a fixed "expiry" second; the resolver only compares timestamps
const unknownFeedId = ethers.zeroPadValue("0x000000000000000000000000000000000000dEaD", 32);

async function deployResolver() {
  const factory = await ethers.getContractFactory("MockAggregatorV3");
  const feed = await factory.deploy(8, "HBAR / USD");
  const other = await factory.deploy(18, "ETH / USD");
  const feedAddress = await feed.getAddress();
  const otherAddress = await other.getAddress();
  const resolver = await (
    await ethers.getContractFactory("ChainlinkResolver")
  ).deploy([feedAddress, otherAddress], [STALENESS, 2n * STALENESS]);
  const feedId = ethers.zeroPadValue(feedAddress, 32);
  const otherId = ethers.zeroPadValue(otherAddress, 32);
  return { feed, other, feedAddress, otherAddress, resolver, feedId, otherId };
}

const notOk = [false, 0n, 0n, 0n, 0n];

describe("ChainlinkResolver", function () {
  describe("construction and feed metadata", function () {
    it("feedIdOf is the aggregator address left-padded to 32 bytes", async function () {
      const { resolver, feedAddress, feedId } = await loadFixture(deployResolver);
      expect(await resolver.feedIdOf(feedAddress)).to.equal(feedId);
    });

    it("lists allowed feeds in constructor order with their staleness and decimals", async function () {
      const { resolver, feedId, otherId, feedAddress, otherAddress } = await loadFixture(deployResolver);
      expect(await resolver.feeds()).to.deep.equal([feedId, otherId]);
      expect(await resolver.feedOf(feedId)).to.deep.equal([feedAddress, STALENESS, 8n]);
      expect(await resolver.feedOf(otherId)).to.deep.equal([otherAddress, 2n * STALENESS, 18n]);
    });

    it("describe and feedDecimals come from the aggregator", async function () {
      const { resolver, feedId, otherId } = await loadFixture(deployResolver);
      expect(await resolver.describe(feedId)).to.equal("HBAR / USD");
      expect(await resolver.describe(otherId)).to.equal("ETH / USD");
      expect(await resolver.feedDecimals(feedId)).to.equal(8n);
      expect(await resolver.feedDecimals(otherId)).to.equal(18n);
    });

    it("describe, feedDecimals and feedOf revert UnknownFeed for a feed that was not allowed", async function () {
      const { resolver } = await loadFixture(deployResolver);
      await expect(resolver.describe(unknownFeedId))
        .to.be.revertedWithCustomError(resolver, "UnknownFeed")
        .withArgs(unknownFeedId);
      await expect(resolver.feedDecimals(unknownFeedId)).to.be.revertedWithCustomError(resolver, "UnknownFeed");
      await expect(resolver.feedOf(unknownFeedId)).to.be.revertedWithCustomError(resolver, "UnknownFeed");
    });

    it("rejects mismatched arrays, a zero address, zero staleness and a duplicate feed", async function () {
      const { feedAddress } = await loadFixture(deployResolver);
      const factory = await ethers.getContractFactory("ChainlinkResolver");
      await expect(factory.deploy([feedAddress], [])).to.be.revertedWithCustomError(factory, "LengthMismatch");
      await expect(factory.deploy([ethers.ZeroAddress], [STALENESS])).to.be.revertedWithCustomError(
        factory,
        "ZeroAddress",
      );
      await expect(factory.deploy([feedAddress], [0])).to.be.revertedWithCustomError(factory, "ZeroStaleness");
      await expect(factory.deploy([feedAddress, feedAddress], [STALENESS, STALENESS])).to.be.revertedWithCustomError(
        factory,
        "DuplicateFeed",
      );
    });
  });

  describe("readingAt", function () {
    it("returns ok false for an unknown feed", async function () {
      const { resolver } = await loadFixture(deployResolver);
      expect(await resolver.readingAt(unknownFeedId, T)).to.deep.equal(notOk);
    });

    it("returns ok false when the aggregator has no rounds at all", async function () {
      const { resolver, feedId } = await loadFixture(deployResolver);
      expect(await resolver.readingAt(feedId, T)).to.deep.equal(notOk);
    });

    it("picks the round current at the requested time when later rounds exist", async function () {
      const { resolver, feed, feedId } = await loadFixture(deployResolver);
      await pushRound(feed, 100n, T - 300n);
      const current = await pushRound(feed, 200n, T - 100n);
      await pushRound(feed, 300n, T + 50n);
      await pushRound(feed, 400n, T + 100n);
      expect(await resolver.readingAt(feedId, T)).to.deep.equal([true, 200n, 8n, current, T - 100n]);
      expect(current).to.equal(PHASE | 2n);
    });

    it("treats a round published exactly at the requested second as current", async function () {
      const { resolver, feed, feedId } = await loadFixture(deployResolver);
      await pushRound(feed, 100n, T - 10n);
      const atT = await pushRound(feed, 200n, T);
      await pushRound(feed, 300n, T + 1n);
      expect(await resolver.readingAt(feedId, T)).to.deep.equal([true, 200n, 8n, atT, T]);
    });

    it("uses the latest round when it is already at or before the requested time", async function () {
      const { resolver, feed, feedId } = await loadFixture(deployResolver);
      const latest = await pushRound(feed, 123n, T - 5n);
      expect(await resolver.readingAt(feedId, T)).to.deep.equal([true, 123n, 8n, latest, T - 5n]);
    });

    it("finds the round current at the requested time behind 100 later rounds", async function () {
      const { resolver, feed, feedId } = await loadFixture(deployResolver);
      await pushRound(feed, 400n, T - 20n);
      const good = await pushRound(feed, 500n, T - 10n);
      for (let i = 1n; i <= 100n; i++) await pushRound(feed, 600n, T + i);
      expect(await resolver.readingAt(feedId, T)).to.deep.equal([true, 500n, 8n, good, T - 10n]);
      expect(good).to.equal(PHASE | 2n);
    });

    it("finds the target when it is the first round of the phase", async function () {
      const { resolver, feed, feedId } = await loadFixture(deployResolver);
      const first = await pushRound(feed, 500n, T - 10n);
      for (let i = 1n; i <= 5n; i++) await pushRound(feed, 600n, T + i);
      expect(await resolver.readingAt(feedId, T)).to.deep.equal([true, 500n, 8n, first, T - 10n]);
      expect(first).to.equal(PHASE | 1n);
    });

    it("finds the target at every position of a short history", async function () {
      const { resolver, feed, feedId } = await loadFixture(deployResolver);
      const ids: bigint[] = [];
      for (let i = 0n; i < 9n; i++) ids.push(await pushRound(feed, 100n + i, T - 100n + 10n * i));
      for (let i = 0n; i < 9n; i++) {
        const at = T - 100n + 10n * i;
        const expected = [true, 100n + i, 8n, ids[Number(i)], at];
        expect(await resolver.readingAt(feedId, at), `exactly at round ${i}`).to.deep.equal(expected);
        expect(await resolver.readingAt(feedId, at + 5n), `between rounds ${i} and ${i + 1n}`).to.deep.equal(expected);
      }
      expect(await resolver.readingAt(feedId, T - 101n)).to.deep.equal(notOk);
    });

    it("returns ok false when every round in the phase is after the requested time", async function () {
      const { resolver, feed, feedId } = await loadFixture(deployResolver);
      await pushRound(feed, 100n, T + 1n);
      expect(await resolver.readingAt(feedId, T)).to.deep.equal(notOk);
      await pushRound(feed, 200n, T + 2n);
      expect(await resolver.readingAt(feedId, T)).to.deep.equal(notOk);
    });

    it("returns ok false when a read inside the search fails, as on an aggregator that dropped early history", async function () {
      const { resolver, feed, feedId } = await loadFixture(deployResolver);
      const good = await pushRound(feed, 500n, T - 10n);
      for (let i = 1n; i <= 3n; i++) await pushRound(feed, 600n, T + i);
      expect(await resolver.readingAt(feedId, T)).to.deep.equal([true, 500n, 8n, good, T - 10n]);
      await feed.setHistoryStart(2n);
      expect(await resolver.readingAt(feedId, T)).to.deep.equal(notOk);
    });

    it("accepts a round exactly at the staleness limit and rejects one second older", async function () {
      const { resolver, feed, feedId } = await loadFixture(deployResolver);
      const fresh = await pushRound(feed, 100n, T - STALENESS);
      expect(await resolver.readingAt(feedId, T)).to.deep.equal([true, 100n, 8n, fresh, T - STALENESS]);
      expect(await resolver.readingAt(feedId, T + 1n)).to.deep.equal(notOk);
    });

    it("applies each feed's own staleness", async function () {
      const { resolver, other, otherId } = await loadFixture(deployResolver);
      const round = await pushRound(other, 100n, T - 2n * STALENESS);
      expect(await resolver.readingAt(otherId, T)).to.deep.equal([true, 100n, 18n, round, T - 2n * STALENESS]);
      expect(await resolver.readingAt(otherId, T + 1n)).to.deep.equal(notOk);
    });

    it("returns ok false for a zero or negative answer", async function () {
      const { resolver, feed, feedId } = await loadFixture(deployResolver);
      await pushRound(feed, 0n, T - 1n);
      expect(await resolver.readingAt(feedId, T)).to.deep.equal(notOk);
      await pushRound(feed, -1n, T);
      expect(await resolver.readingAt(feedId, T)).to.deep.equal(notOk);
    });
  });
});
