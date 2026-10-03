import { expect } from "chai";
import { ethers, network } from "hardhat";
import type { Signer } from "ethers";
import type {
  MockHederaTokenService,
  MockSaucerSwapFactory,
  MockSaucerSwapRouter,
  MockVerdict,
  VerdictRouter,
  MockHtsToken,
} from "../typechain-types";
import { installHederaMocks, now, ONE_HBAR } from "./helpers/hedera";

const EXCHANGE_RATE_ADDRESS = "0x0000000000000000000000000000000000000168";
const WHBAR_CONTRACT = "0x0000000000000000000000000000000000003aD1";
const WHBAR_TOKEN = "0x0000000000000000000000000000000000003aD2";

const POOL_FEE_TINYCENTS = 20_000_000_000n; // 2 USD, the testnet pairCreateFee
const TINYCENT_RATE_NUM = 10_052_844n; // tinybars per cent, scaled by 1e8, measured 2026-10-02
const TINYCENT_RATE_DEN = 100_000_000n;
const POOL_FEE_TINYBARS = (POOL_FEE_TINYCENTS * TINYCENT_RATE_NUM) / TINYCENT_RATE_DEN;

const SEED_YES = 20n * ONE_HBAR; // 20 whole YES
const SEED_HBAR = 10n * ONE_HBAR; // 10 HBAR, an even 0.5 price

const TRADE = { BuyYes: 0n, SellYes: 1n, BuyNo: 2n, SellNo: 3n };
const SPENDER_DOES_NOT_HAVE_ALLOWANCE = 292n;

describe("VerdictRouter", function () {
  let deployer: Signer;
  let seeder: Signer;
  let user: Signer;
  let userAddress: string;
  let hts: MockHederaTokenService;
  let factory: MockSaucerSwapFactory;
  let saucerRouter: MockSaucerSwapRouter;
  let verdict: MockVerdict;
  let router: VerdictRouter;
  let routerAddress: string;
  let marketId: bigint;
  let yes: MockHtsToken;
  let no: MockHtsToken;
  let deadline: bigint;

  async function associate(signer: Signer, token: string) {
    const address = await signer.getAddress();
    await hts.connect(signer).associateToken(address, token);
  }

  async function approveHts(signer: Signer, token: string, spender: string, amount: bigint) {
    await hts.connect(signer).approve(token, spender, amount);
  }

  async function createMarket(): Promise<bigint> {
    const expiry = (await now()) + 30n * 24n * 3600n;
    const cost = await verdict.creationCost();
    const tx = await verdict.createMarket(
      await deployer.getAddress(),
      ethers.ZeroHash,
      0, // Kind.Above
      1_000_000_000n,
      0n,
      expiry,
      { value: cost },
    );
    const receipt = await tx.wait();
    if (!receipt) throw new Error("createMarket not mined");
    return (await verdict.marketCount()) - 1n;
  }

  async function seedPool(id: bigint) {
    const market = await verdict.getMarket(id);
    await associate(seeder, market.yes);
    await associate(seeder, market.no);
    await verdict.connect(seeder).split(id, await seeder.getAddress(), await seeder.getAddress(), { value: SEED_YES });
    await approveHts(seeder, market.yes, await saucerRouter.getAddress(), SEED_YES);
    await saucerRouter
      .connect(seeder)
      .addLiquidityETHNewPool(market.yes, SEED_YES, 0n, 0n, await seeder.getAddress(), (await now()) + 3600n, {
        value: SEED_HBAR + POOL_FEE_TINYBARS,
      });
  }

  async function expectRouterEmpty() {
    expect(await ethers.provider.getBalance(routerAddress)).to.equal(0n);
    expect(await yes.balanceOf(routerAddress)).to.equal(0n);
    expect(await no.balanceOf(routerAddress)).to.equal(0n);
  }

  // Deploy the whole fixture once, then snapshot and revert around each test. Deploying per test
  // is too slow for the shared build box.
  let snapshot: string;

  before(async function () {
    [deployer, seeder, user] = await ethers.getSigners();
    userAddress = await user.getAddress();
    ({ hts } = await installHederaMocks());

    const exchangeImpl = await (await ethers.getContractFactory("MockExchangeRate")).deploy();
    await network.provider.send("hardhat_setCode", [
      EXCHANGE_RATE_ADDRESS,
      await ethers.provider.getCode(await exchangeImpl.getAddress()),
    ]);

    factory = await (await ethers.getContractFactory("MockSaucerSwapFactory")).deploy();
    saucerRouter = await (
      await ethers.getContractFactory("MockSaucerSwapRouter")
    ).deploy(await factory.getAddress(), WHBAR_CONTRACT, WHBAR_TOKEN);
    verdict = await (await ethers.getContractFactory("MockVerdict")).deploy();
    router = await (
      await ethers.getContractFactory("VerdictRouter")
    ).deploy(await verdict.getAddress(), await saucerRouter.getAddress(), await factory.getAddress(), WHBAR_TOKEN);
    routerAddress = await router.getAddress();

    marketId = await createMarket();
    const market = await verdict.getMarket(marketId);
    yes = await ethers.getContractAt("MockHtsToken", market.yes);
    no = await ethers.getContractAt("MockHtsToken", market.no);
    await seedPool(marketId);
    snapshot = await network.provider.send("evm_snapshot", []);
  });

  beforeEach(async function () {
    await network.provider.send("evm_revert", [snapshot]);
    snapshot = await network.provider.send("evm_snapshot", []);
    deadline = (await now()) + 3600n;
  });

  describe("buyYes", function () {
    it("delivers the quoted YES and leaves the router empty", async function () {
      const quote = await router.quoteBuyYes(marketId, ONE_HBAR);
      expect(quote).to.be.gt(0n);
      await associate(user, await yes.getAddress());
      await expect(router.connect(user).buyYes(marketId, quote, deadline, { value: ONE_HBAR }))
        .to.emit(router, "Traded")
        .withArgs(marketId, userAddress, TRADE.BuyYes, ONE_HBAR, quote, 0n);
      expect(await yes.balanceOf(userAddress)).to.equal(quote);
      await expectRouterEmpty();
    });

    it("reverts Slippage when minYesOut exceeds the quote", async function () {
      const quote = await router.quoteBuyYes(marketId, ONE_HBAR);
      await associate(user, await yes.getAddress());
      await expect(
        router.connect(user).buyYes(marketId, quote + 1n, deadline, { value: ONE_HBAR }),
      ).to.be.revertedWithCustomError(router, "Slippage");
    });

    it("reverts Expired after the deadline", async function () {
      const past = (await now()) - 1n;
      await expect(router.connect(user).buyYes(marketId, 0n, past, { value: ONE_HBAR }))
        .to.be.revertedWithCustomError(router, "Expired")
        .withArgs(past);
    });

    it("reverts ZeroAmount with no HBAR sent", async function () {
      await expect(router.connect(user).buyYes(marketId, 0n, deadline)).to.be.revertedWithCustomError(
        router,
        "ZeroAmount",
      );
    });
  });

  describe("sellYes", function () {
    const yesIn = ONE_HBAR; // one whole YES

    beforeEach(async function () {
      await associate(user, await yes.getAddress());
      await associate(user, await no.getAddress());
      await verdict.connect(user).split(marketId, userAddress, userAddress, { value: 5n * ONE_HBAR });
    });

    it("delivers the quoted HBAR and leaves the router empty", async function () {
      const quote = await router.quoteSellYes(marketId, yesIn);
      expect(quote).to.be.gt(0n);
      await approveHts(user, await yes.getAddress(), routerAddress, yesIn);
      const tx = router.connect(user).sellYes(marketId, yesIn, quote, deadline);
      await expect(tx).to.changeEtherBalance(user, quote);
      await expect(tx).to.emit(router, "Traded").withArgs(marketId, userAddress, TRADE.SellYes, yesIn, quote, 0n);
      expect(await yes.balanceOf(userAddress)).to.equal(5n * ONE_HBAR - yesIn);
      await expectRouterEmpty();
    });

    it("associates the router with YES on first use", async function () {
      expect(await yes.associated(routerAddress)).to.equal(false);
      await approveHts(user, await yes.getAddress(), routerAddress, yesIn);
      await router.connect(user).sellYes(marketId, yesIn, 0n, deadline);
      expect(await yes.associated(routerAddress)).to.equal(true);
      await expectRouterEmpty();
    });

    it("reverts Slippage when minHbarOut exceeds the quote", async function () {
      const quote = await router.quoteSellYes(marketId, yesIn);
      await approveHts(user, await yes.getAddress(), routerAddress, yesIn);
      await expect(router.connect(user).sellYes(marketId, yesIn, quote + 1n, deadline)).to.be.revertedWithCustomError(
        router,
        "Slippage",
      );
    });

    it("reverts Expired after the deadline", async function () {
      const past = (await now()) - 1n;
      await expect(router.connect(user).sellYes(marketId, yesIn, 0n, past)).to.be.revertedWithCustomError(
        router,
        "Expired",
      );
    });

    it("surfaces a missing allowance as HtsError", async function () {
      await expect(router.connect(user).sellYes(marketId, yesIn, 0n, deadline))
        .to.be.revertedWithCustomError(router, "HtsError")
        .withArgs(SPENDER_DOES_NOT_HAVE_ALLOWANCE);
    });
  });

  describe("buyNo", function () {
    it("delivers NO equal to the HBAR sent plus the quoted YES-leg proceeds", async function () {
      const [noOut, hbarBack] = await router.quoteBuyNo(marketId, ONE_HBAR);
      expect(noOut).to.equal(ONE_HBAR);
      expect(hbarBack).to.be.gt(0n);
      expect(await yes.associated(routerAddress)).to.equal(false);
      expect(await no.associated(routerAddress)).to.equal(false);
      await associate(user, await no.getAddress());
      const tx = router.connect(user).buyNo(marketId, hbarBack, deadline, { value: ONE_HBAR });
      // The user sends ONE_HBAR and gets hbarBack, so the balance moves by the difference.
      await expect(tx).to.changeEtherBalance(user, hbarBack - ONE_HBAR);
      await expect(tx)
        .to.emit(router, "Traded")
        .withArgs(marketId, userAddress, TRADE.BuyNo, ONE_HBAR, ONE_HBAR, hbarBack);
      expect(await no.balanceOf(userAddress)).to.equal(ONE_HBAR);
      expect(await yes.associated(routerAddress)).to.equal(true);
      expect(await no.associated(routerAddress)).to.equal(true);
      await expectRouterEmpty();
    });

    it("reverts Slippage when minHbarBack exceeds the quote", async function () {
      const [, hbarBack] = await router.quoteBuyNo(marketId, ONE_HBAR);
      await associate(user, await no.getAddress());
      await expect(
        router.connect(user).buyNo(marketId, hbarBack + 1n, deadline, { value: ONE_HBAR }),
      ).to.be.revertedWithCustomError(router, "Slippage");
    });

    it("reverts Expired after the deadline", async function () {
      const past = (await now()) - 1n;
      await expect(router.connect(user).buyNo(marketId, 0n, past, { value: ONE_HBAR })).to.be.revertedWithCustomError(
        router,
        "Expired",
      );
    });
  });

  describe("sellNo", function () {
    const noIn = ONE_HBAR; // one whole NO

    beforeEach(async function () {
      await associate(user, await yes.getAddress());
      await associate(user, await no.getAddress());
      await verdict.connect(user).split(marketId, userAddress, userAddress, { value: 5n * ONE_HBAR });
    });

    it("pays out noIn HBAR and refunds the unspent HBAR, leaving the router empty", async function () {
      const [needed] = await router.quoteSellNo(marketId, noIn);
      const extra = 30_000_000n; // 0.3 HBAR above the quote
      await approveHts(user, await no.getAddress(), routerAddress, noIn);
      const tx = router.connect(user).sellNo(marketId, noIn, noIn, deadline, { value: needed + extra });
      // The user sends needed + extra and gets noIn + extra back, so the balance moves by noIn - needed.
      await expect(tx).to.changeEtherBalance(user, noIn - needed);
      await expect(tx).to.emit(router, "Traded").withArgs(marketId, userAddress, TRADE.SellNo, noIn, noIn, extra);
      expect(await no.balanceOf(userAddress)).to.equal(5n * ONE_HBAR - noIn);
      await expectRouterEmpty();
    });

    it("reverts InsufficientValue when the HBAR sent does not cover the YES", async function () {
      const [needed] = await router.quoteSellNo(marketId, noIn);
      await approveHts(user, await no.getAddress(), routerAddress, noIn);
      await expect(router.connect(user).sellNo(marketId, noIn, 0n, deadline, { value: needed - 1n }))
        .to.be.revertedWithCustomError(router, "InsufficientValue")
        .withArgs(needed, needed - 1n);
    });

    it("reverts Slippage when minHbarOut exceeds the payout", async function () {
      const [needed] = await router.quoteSellNo(marketId, noIn);
      await approveHts(user, await no.getAddress(), routerAddress, noIn);
      await expect(
        router.connect(user).sellNo(marketId, noIn, noIn + 1n, deadline, { value: needed }),
      ).to.be.revertedWithCustomError(router, "Slippage");
    });

    it("reverts Expired after the deadline", async function () {
      const past = (await now()) - 1n;
      await expect(
        router.connect(user).sellNo(marketId, noIn, 0n, past, { value: 2n * ONE_HBAR }),
      ).to.be.revertedWithCustomError(router, "Expired");
    });
  });

  describe("pool and market guards", function () {
    it("reverts NoPool for every trade when the market has no pool", async function () {
      const bareId = await createMarket();
      const bare = await verdict.getMarket(bareId);
      await associate(user, bare.yes);
      await associate(user, bare.no);
      await expect(
        router.connect(user).buyYes(bareId, 0n, deadline, { value: ONE_HBAR }),
      ).to.be.revertedWithCustomError(router, "NoPool");
      await expect(router.connect(user).sellYes(bareId, ONE_HBAR, 0n, deadline)).to.be.revertedWithCustomError(
        router,
        "NoPool",
      );
      await expect(router.connect(user).buyNo(bareId, 0n, deadline, { value: ONE_HBAR })).to.be.revertedWithCustomError(
        router,
        "NoPool",
      );
      await expect(
        router.connect(user).sellNo(bareId, ONE_HBAR, 0n, deadline, { value: ONE_HBAR }),
      ).to.be.revertedWithCustomError(router, "NoPool");
      expect(await router.pairOf(bareId)).to.equal(ethers.ZeroAddress);
      expect(await router.reserves(bareId)).to.deep.equal([0n, 0n]);
      expect(await router.impliedProbability(bareId)).to.equal(0n);
      expect(await router.quoteBuyYes(bareId, ONE_HBAR)).to.equal(0n);
      expect(await router.quoteSellYes(bareId, ONE_HBAR)).to.equal(0n);
      expect(await router.quoteBuyNo(bareId, ONE_HBAR)).to.deep.equal([0n, 0n]);
      expect(await router.quoteSellNo(bareId, ONE_HBAR)).to.deep.equal([0n, 0n]);
    });

    it("reverts NoSuchMarket for an unknown id", async function () {
      await expect(router.connect(user).buyYes(99n, 0n, deadline, { value: ONE_HBAR })).to.be.revertedWithCustomError(
        router,
        "NoSuchMarket",
      );
    });

    it("reverts ZeroAmount on zero inputs", async function () {
      await expect(router.connect(user).sellYes(marketId, 0n, 0n, deadline)).to.be.revertedWithCustomError(
        router,
        "ZeroAmount",
      );
      await expect(router.connect(user).buyNo(marketId, 0n, deadline)).to.be.revertedWithCustomError(
        router,
        "ZeroAmount",
      );
      await expect(router.connect(user).sellNo(marketId, 0n, 0n, deadline)).to.be.revertedWithCustomError(
        router,
        "ZeroAmount",
      );
    });
  });

  describe("views", function () {
    it("reports the pair, reserves and implied probability of the seeded pool", async function () {
      const pair = await router.pairOf(marketId);
      expect(pair).to.not.equal(ethers.ZeroAddress);
      const [yesReserve, hbarReserve] = await router.reserves(marketId);
      expect(yesReserve).to.equal(SEED_YES);
      expect(hbarReserve).to.equal(SEED_HBAR);
      expect(await router.impliedProbability(marketId)).to.equal(50_000_000n); // 0.5 HBAR per YES
    });

    it("quotes all four trades net of the pool fee", async function () {
      // 20 YES against 10 HBAR, 0.3 percent fee.
      const buyYesQuote = await router.quoteBuyYes(marketId, ONE_HBAR);
      expect(buyYesQuote).to.equal((ONE_HBAR * 997n * SEED_YES) / (SEED_HBAR * 1000n + ONE_HBAR * 997n));
      const [noOut, hbarBack] = await router.quoteBuyNo(marketId, ONE_HBAR);
      expect(noOut).to.equal(ONE_HBAR);
      expect(hbarBack).to.equal((ONE_HBAR * 997n * SEED_HBAR) / (SEED_YES * 1000n + ONE_HBAR * 997n));
      const [needed, sellNoOut] = await router.quoteSellNo(marketId, ONE_HBAR);
      expect(needed).to.equal((SEED_HBAR * ONE_HBAR * 1000n) / ((SEED_YES - ONE_HBAR) * 997n) + 1n);
      expect(sellNoOut).to.equal(ONE_HBAR);
    });
  });
});
