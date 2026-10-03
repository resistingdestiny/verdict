import { ethers } from "hardhat";
import { expect } from "chai";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type {
  ChainlinkResolver,
  MockAggregatorV3,
  MockHederaScheduleService,
  MockHederaTokenService,
  MockHtsToken,
  Verdict,
} from "../../typechain-types";
import { installHederaMocks, now, ONE_HBAR } from "./hedera";

export const PHASE = 1n << 64n;
export const HOUR = 3600n;
export const DAY = 24n * HOUR;
export const SIX_HOURS = 6n * HOUR;
export const RESERVE = 5n * ONE_HBAR;
export const INT64_MAX = (1n << 63n) - 1n;

export enum Kind {
  Above = 0,
  Below = 1,
  Between = 2,
  Scalar = 3,
  Outside = 4,
}

export enum Status {
  Open = 0,
  Settled = 1,
  Void = 2,
}

export type VerdictContext = {
  owner: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
  carol: HardhatEthersSigner;
  hts: MockHederaTokenService;
  hss: MockHederaScheduleService;
  feed: MockAggregatorV3;
  feedId: string;
  resolver: ChainlinkResolver;
  verdict: Verdict;
  creationCost: bigint;
};

/**
 * Verdict with the HTS and HSS mocks at their real addresses, one mock HBAR / USD feed behind a
 * ChainlinkResolver with 6 hours of staleness, and four accounts that accept any token automatically,
 * as a wallet configured with unlimited automatic associations would.
 */
export async function deployVerdict(): Promise<VerdictContext> {
  const [owner, alice, bob, carol] = await ethers.getSigners();
  const { hts, hss } = await installHederaMocks();
  const feed = await (await ethers.getContractFactory("MockAggregatorV3")).deploy(8, "HBAR / USD");
  const feedAddress = await feed.getAddress();
  const resolver = await (await ethers.getContractFactory("ChainlinkResolver")).deploy([feedAddress], [SIX_HOURS]);
  const verdict = await (await ethers.getContractFactory("Verdict")).deploy(owner.address, ONE_HBAR);
  await verdict.setResolver(await resolver.getAddress(), true);
  for (const signer of [owner, alice, bob, carol]) {
    await hts.setAutoAssociationSlots(signer.address, ethers.MaxUint256);
  }
  return {
    owner,
    alice,
    bob,
    carol,
    hts,
    hss,
    feed,
    feedId: ethers.zeroPadValue(feedAddress, 32),
    resolver,
    verdict,
    creationCost: await verdict.creationCost(),
  };
}

export type MarketTerms = {
  kind: Kind;
  lower: bigint;
  upper?: bigint;
  /** Seconds from the current block to expiry. Ignored when `expiry` is given. */
  lead?: bigint;
  /** An explicit expiry second. */
  expiry?: bigint;
  /** Tinybars sent with the creation; defaults to the exact creation cost. */
  value?: bigint;
  creator?: HardhatEthersSigner;
};

/** Creates a market and returns its id and expiry. */
export async function createMarket(
  ctx: VerdictContext,
  terms: MarketTerms,
): Promise<{ id: bigint; expiry: bigint; yes: MockHtsToken; no: MockHtsToken }> {
  const expiry = terms.expiry ?? (await now()) + (terms.lead ?? HOUR);
  const creator = terms.creator ?? ctx.alice;
  const id = await ctx.verdict.marketCount();
  await ctx.verdict
    .connect(creator)
    .createMarket(ctx.resolver, ctx.feedId, terms.kind, terms.lower, terms.upper ?? 0n, expiry, {
      value: terms.value ?? ctx.creationCost,
    });
  const market = await ctx.verdict.getMarket(id);
  return { id, expiry, yes: await tokenAt(market.yes), no: await tokenAt(market.no) };
}

export async function tokenAt(address: string): Promise<MockHtsToken> {
  return ethers.getContractAt("MockHtsToken", address);
}

/** Approves Verdict through the token's ERC-20 facade, as a wallet does on Hedera (HIP-218). */
export async function approveBoth(
  ctx: VerdictContext,
  signer: HardhatEthersSigner,
  yes: MockHtsToken,
  no: MockHtsToken,
  amount: bigint,
): Promise<void> {
  await yes.connect(signer).approve(await ctx.verdict.getAddress(), amount);
  await no.connect(signer).approve(await ctx.verdict.getAddress(), amount);
}

/** Pushes a feed round and returns its phase-prefixed round id. */
export async function pushRound(feed: MockAggregatorV3, answer: bigint, updatedAt: bigint): Promise<bigint> {
  await feed.pushRound(answer, updatedAt);
  return PHASE | (await feed.latestAggregatorRound());
}

/**
 * The brief's invariants 1 to 3: the balance covers collateral plus pending reserves; an open market's
 * collateral equals both supplies; a settled market's collateral covers every outstanding redemption.
 */
export async function expectInvariants(ctx: VerdictContext, ids: bigint[]): Promise<void> {
  const balance = await ethers.provider.getBalance(await ctx.verdict.getAddress());
  const locked = (await ctx.verdict.totalCollateral()) + (await ctx.verdict.pendingReserves());
  expect(balance, "balance covers collateral and reserves").to.be.gte(locked);
  let summed = 0n;
  for (const id of ids) {
    const m = await ctx.verdict.getMarket(id);
    const yesSupply = await (await tokenAt(m.yes)).totalSupply();
    const noSupply = await (await tokenAt(m.no)).totalSupply();
    summed += m.collateral;
    if (m.status === BigInt(Status.Open)) {
      expect(m.collateral, `market ${id} collateral equals YES supply`).to.equal(yesSupply);
      expect(m.collateral, `market ${id} collateral equals NO supply`).to.equal(noSupply);
    } else {
      const owed = yesSupply * m.payout + noSupply * (ONE_HBAR - m.payout);
      expect(m.collateral * ONE_HBAR, `market ${id} collateral covers redemptions`).to.be.gte(owed);
    }
  }
  expect(summed, "totalCollateral is the sum over markets").to.equal(await ctx.verdict.totalCollateral());
}
