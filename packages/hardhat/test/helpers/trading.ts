import { ethers, network } from "hardhat";
import { expect } from "chai";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { MockHtsToken, MockSaucerSwapFactory, MockSaucerSwapRouter, VerdictRouter } from "../../typechain-types";
import { deployVerdict, type VerdictContext } from "./verdict";
import { now } from "./hedera";

/// The exchange rate system contract, as on the real network.
export const EXCHANGE_RATE_ADDRESS = "0x0000000000000000000000000000000000000168";
/// SaucerSwap's WHBAR wrapper contract and WHBAR HTS token on testnet. Only the token appears in swap paths.
export const WHBAR_CONTRACT = "0x0000000000000000000000000000000000003aD1";
export const WHBAR_TOKEN = "0x0000000000000000000000000000000000003aD2";

export type TradingContext = VerdictContext & {
  factory: MockSaucerSwapFactory;
  saucerRouter: MockSaucerSwapRouter;
  router: VerdictRouter;
  routerAddress: string;
  verdictAddress: string;
  saucerRouterAddress: string;
  /// The pair creation fee in tinybars at the mock exchange rate.
  poolFeeTinybars: bigint;
};

/**
 * The core fixture plus the SaucerSwap mocks and a VerdictRouter in front of the real Verdict: the
 * exchange rate mock at 0x168, a mock factory that charges the testnet pair creation fee, a mock
 * SaucerSwap router with the real one's path and refund rules, and the router under test.
 */
export async function deployTrading(): Promise<TradingContext> {
  const ctx = await deployVerdict();
  const exchangeImpl = await (await ethers.getContractFactory("MockExchangeRate")).deploy();
  await network.provider.send("hardhat_setCode", [
    EXCHANGE_RATE_ADDRESS,
    await ethers.provider.getCode(await exchangeImpl.getAddress()),
  ]);
  const factory = await (await ethers.getContractFactory("MockSaucerSwapFactory")).deploy();
  const saucerRouter = await (
    await ethers.getContractFactory("MockSaucerSwapRouter")
  ).deploy(await factory.getAddress(), WHBAR_CONTRACT, WHBAR_TOKEN);
  const verdictAddress = await ctx.verdict.getAddress();
  const saucerRouterAddress = await saucerRouter.getAddress();
  const router = await (
    await ethers.getContractFactory("VerdictRouter")
  ).deploy(verdictAddress, saucerRouterAddress, await factory.getAddress(), WHBAR_TOKEN);
  return {
    ...ctx,
    factory,
    saucerRouter,
    router,
    routerAddress: await router.getAddress(),
    verdictAddress,
    saucerRouterAddress,
    poolFeeTinybars: await factory.pairCreateFeeTinybars.staticCall(),
  };
}

/**
 * Seeds a market's pool the way the creator does from the Create page: split `yesAmount` tinybars
 * into YES and NO, approve the SaucerSwap router through HTS, then open the pool with the YES leg
 * against `hbarAmount` tinybars plus the creation fee. The seeder keeps the NO leg.
 */
export async function seedPool(
  ctx: TradingContext,
  seeder: HardhatEthersSigner,
  id: bigint,
  yesAmount: bigint,
  hbarAmount: bigint,
): Promise<void> {
  const market = await ctx.verdict.getMarket(id);
  await ctx.verdict.connect(seeder).split(id, seeder.address, seeder.address, { value: yesAmount });
  await ctx.hts.connect(seeder).approve(market.yes, ctx.saucerRouterAddress, yesAmount);
  await ctx.saucerRouter
    .connect(seeder)
    .addLiquidityETHNewPool(market.yes, yesAmount, 0n, 0n, seeder.address, (await now()) + 3600n, {
      value: hbarAmount + ctx.poolFeeTinybars,
    });
}

/** The router holds no HBAR and none of the given tokens. */
export async function expectRouterEmpty(ctx: TradingContext, tokens: MockHtsToken[]): Promise<void> {
  expect(await ethers.provider.getBalance(ctx.routerAddress), "router holds no HBAR").to.equal(0n);
  for (const token of tokens) {
    expect(await token.balanceOf(ctx.routerAddress), "router holds no outcome tokens").to.equal(0n);
  }
}

/** Invariant 6: Verdict grants no allowance on an outcome token to the DEX, its pair or the trade router. */
export async function expectNoDexAllowance(ctx: TradingContext, token: MockHtsToken, pair: string): Promise<void> {
  for (const spender of [ctx.saucerRouterAddress, ctx.routerAddress, pair]) {
    if (spender === ethers.ZeroAddress) continue;
    expect(await token.allowance(ctx.verdictAddress, spender), "Verdict grants no allowance").to.equal(0n);
  }
}
