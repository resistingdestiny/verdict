import { ethers, deployments, network } from "hardhat";
import type { ContractTransactionReceipt, Signer } from "ethers";
import type {
  IVerdict,
  VerdictRouter,
  IHederaTokenService,
  ISaucerSwapFactory,
  ISaucerSwapRouter,
} from "../../typechain-types";
import { TESTNET_ADDRESSES, feedIdFor } from "../../config/addresses";
import { WEIBARS_PER_TINYBAR } from "./routerCli";
import { Ledger, StepRecord, TINYBARS_PER_HBAR } from "./evidence";
import { hashscanContract, hashscanSchedule, hashscanToken, longZeroToEntityId } from "./hashscan";
import { kindName } from "../../../nextjs/lib/kinds";

/**
 * The market operations the hand-run testnet scripts share: loading the deployed contracts, reading
 * a feed's spot price, creating a market, splitting HBAR and seeding the SaucerSwap pool. Every paid
 * call goes through the ledger so a rerun skips what is already done.
 *
 * Units follow seed-pool.ts and trade.ts: contract arguments are tinybars, `value` is weibars
 * (tinybars times 1e10) because the JSON-RPC relay speaks 18 decimals.
 */

/** Gas limits from the testnet brief. Token creation inside createMarket is the heavy one. */
export const GAS = {
  createMarket: 6_000_000n,
  createPool: 9_000_000n,
  swap: 6_000_000n,
  call: 3_000_000n,
} as const;

export const STATUS_NAMES = ["Open", "Settled", "Void"] as const;

/** Hardhat's well-known first account, which the config falls back to when no deployer key is set. */
const HARDHAT_DEFAULT_ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const ERC20_BALANCE_ABI = ["function balanceOf(address owner) view returns (uint256)"];
const AGGREGATOR_ABI = [
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
];

export type TestnetContext = {
  signer: Signer;
  deployer: string;
  verdict: IVerdict;
  verdictAddress: string;
  router: VerdictRouter;
  routerAddress: string;
  resolverAddress: string;
  hts: IHederaTokenService;
  factory: ISaucerSwapFactory;
  saucerRouter: ISaucerSwapRouter;
};

/** Weibars to send for a tinybar amount. */
export function weibars(tinybars: bigint): bigint {
  return tinybars * WEIBARS_PER_TINYBAR;
}

export function hbar(whole: number): bigint {
  return BigInt(whole) * TINYBARS_PER_HBAR;
}

/**
 * Loads the deployed contracts on Hedera testnet and refuses to run anywhere else or with the
 * Hardhat default key, which would mean `.env` has no `DEPLOYER_PRIVATE_KEY`.
 */
export async function loadContext(): Promise<TestnetContext> {
  if (network.name !== "hederaTestnet") {
    throw new Error(`This script runs on Hedera testnet only. Add --network hederaTestnet (current: ${network.name}).`);
  }
  const [signer] = await ethers.getSigners();
  const deployer = await signer.getAddress();
  if (deployer.toLowerCase() === HARDHAT_DEFAULT_ACCOUNT.toLowerCase()) {
    throw new Error("The deployer is Hardhat's default account. Set DEPLOYER_PRIVATE_KEY in packages/hardhat/.env.");
  }
  const need = async (name: string) => {
    const d = await deployments.getOrNull(name);
    if (!d)
      throw new Error(
        `${name} is not deployed on hederaTestnet. Run yarn hardhat:deploy --network hederaTestnet first.`,
      );
    return d.address;
  };
  const verdictAddress = await need("Verdict");
  const routerAddress = await need("VerdictRouter");
  const resolverAddress = await need("ChainlinkResolver");
  const { saucerswap, hts } = TESTNET_ADDRESSES;
  return {
    signer,
    deployer,
    verdict: await ethers.getContractAt("IVerdict", verdictAddress),
    verdictAddress,
    router: await ethers.getContractAt("VerdictRouter", routerAddress),
    routerAddress,
    resolverAddress,
    hts: await ethers.getContractAt("IHederaTokenService", hts),
    factory: await ethers.getContractAt("ISaucerSwapFactory", saucerswap.factory),
    saucerRouter: await ethers.getContractAt("ISaucerSwapRouter", saucerswap.router),
  };
}

/** An account's HBAR balance in tinybars (the relay reports weibars). */
export async function balanceTinybars(address: string): Promise<bigint> {
  return (await ethers.provider.getBalance(address)) / WEIBARS_PER_TINYBAR;
}

/** Refuses to continue when the deployer holds less than `minHbar`. Returns the balance in tinybars. */
export async function requireBalance(ctx: TestnetContext, minHbar: number): Promise<bigint> {
  const balance = await balanceTinybars(ctx.deployer);
  const whole = Number(balance / TINYBARS_PER_HBAR);
  console.log(`Deployer ${ctx.deployer} holds ${whole} HBAR`);
  if (balance < hbar(minHbar)) {
    throw new Error(`Deployer balance is ${whole} HBAR, below the ${minHbar} HBAR floor. Fund the account and rerun.`);
  }
  return balance;
}

/** Balance of an HTS token through its ERC-20 facade, in token units. */
export async function tokenBalance(token: string, owner: string): Promise<bigint> {
  const facade = new ethers.Contract(token, ERC20_BALANCE_ABI, ethers.provider);
  return (await facade.balanceOf(owner)) as bigint;
}

export type Spot = { answer: bigint; decimals: number; roundId: bigint; updatedAt: bigint };

/** The latest round of a Chainlink feed. */
export async function readSpot(feedAddress: string): Promise<Spot> {
  const feed = new ethers.Contract(feedAddress, AGGREGATOR_ABI, ethers.provider);
  const [roundId, answer, , updatedAt] = (await feed.latestRoundData()) as [bigint, bigint, bigint, bigint, bigint];
  const decimals = Number((await feed.decimals()) as bigint);
  if (answer <= 0n) throw new Error(`Feed ${feedAddress} reports a non-positive answer ${answer}`);
  return { answer, decimals, roundId, updatedAt };
}

/** `spot` scaled by `percent` (95 for 5 percent below, 105 for 5 percent above). */
export function scaled(spot: bigint, percent: number): bigint {
  return (spot * BigInt(percent)) / 100n;
}

export type MarketParams = {
  feedName: string;
  kind: number;
  lower: bigint;
  upper: bigint;
  expiry: number;
  /** Shown in logs and evidence rows, for example "HBAR / USD Above, strike 5 percent below spot". */
  label: string;
};

export type CreatedMarket = { id: bigint; yes: string; no: string; schedule: string; txHash: string };

/** Creates a market as one ledger step, plus free rows for the two tokens and the schedule entity. */
export async function createMarket(
  ctx: TestnetContext,
  ledger: Ledger,
  key: string,
  params: MarketParams,
): Promise<CreatedMarket> {
  const feed = TESTNET_ADDRESSES.chainlink[params.feedName];
  if (!feed) throw new Error(`Unknown feed ${params.feedName}`);
  const record = await ledger.step(`${key}:create`, `Create market: ${params.label}`, async () => {
    const cost = await ctx.verdict.creationCost();
    console.log(
      `  ${params.feedName} ${kindName(params.kind)} lower=${ethers.formatUnits(params.lower, feed.decimals)} ` +
        `upper=${params.upper === 0n ? "-" : ethers.formatUnits(params.upper, feed.decimals)} ` +
        `expiry=${new Date(params.expiry * 1000).toISOString()} cost=${cost} tinybars`,
    );
    const tx = await ctx.verdict.createMarket(
      ctx.resolverAddress,
      feedIdFor(feed.feed),
      params.kind,
      params.lower,
      params.upper,
      params.expiry,
      { value: weibars(cost), gasLimit: GAS.createMarket },
    );
    const receipt = await waitFor(tx.hash);
    const created = parseCreated(ctx.verdict, receipt);
    return {
      txHash: tx.hash,
      data: {
        id: created.id.toString(),
        yes: created.yes,
        no: created.no,
        schedule: created.schedule,
        scheduleCode: created.scheduleCode,
        lower: params.lower.toString(),
        upper: params.upper.toString(),
        expiry: String(params.expiry),
        kind: kindName(params.kind),
        feed: params.feedName,
      },
    };
  });
  const created = `${key}:create`;
  const id = BigInt(ledger.value(created, "id"));
  const yes = ledger.value(created, "yes");
  const no = ledger.value(created, "no");
  const schedule = ledger.value(created, "schedule");
  await ledger.step(`${key}:yes`, `Market ${id} YES token`, async () => ({ link: hashscanToken(yes), noCost: true }));
  await ledger.step(`${key}:no`, `Market ${id} NO token`, async () => ({ link: hashscanToken(no), noCost: true }));
  const scheduleId = longZeroToEntityId(schedule);
  if (schedule !== ethers.ZeroAddress && scheduleId) {
    await ledger.step(`${key}:schedule`, `Market ${id} schedule entity ${scheduleId}`, async () => ({
      link: hashscanSchedule(scheduleId),
      noCost: true,
      data: { scheduleId },
    }));
  } else {
    console.log(
      `  Market ${id}: HSS refused the schedule (code ${ledger.value(created, "scheduleCode")}); resolve(id) by hand at expiry.`,
    );
  }
  return { id, yes, no, schedule, txHash: record.txHash! };
}

function parseCreated(verdict: IVerdict, receipt: ContractTransactionReceipt) {
  let created: { id: bigint; yes: string; no: string; schedule: string } | null = null;
  let scheduleCode = "22";
  for (const log of receipt.logs) {
    let parsed;
    try {
      parsed = verdict.interface.parseLog({ topics: [...log.topics], data: log.data });
    } catch {
      parsed = null;
    }
    if (!parsed) continue;
    if (parsed.name === "MarketCreated") {
      created = { id: parsed.args.id, yes: parsed.args.yes, no: parsed.args.no, schedule: parsed.args.schedule };
    } else if (parsed.name === "ScheduleFailed") {
      scheduleCode = String(parsed.args.code);
    }
  }
  if (!created) throw new Error("MarketCreated event not found in the receipt");
  return { ...created, scheduleCode };
}

/** Waits for a transaction and throws when it reverted. */
export async function waitFor(txHash: string): Promise<ContractTransactionReceipt> {
  // HardhatEthersProvider does not implement waitForTransaction, so poll for the receipt instead.
  let receipt = null;
  for (let attempt = 0; attempt < 60 && !receipt; attempt++) {
    receipt = await ethers.provider.getTransactionReceipt(txHash);
    if (!receipt) await new Promise(resolve => setTimeout(resolve, 2000));
  }
  if (!receipt) throw new Error(`Transaction ${txHash} was not mined within two minutes`);
  if (receipt.status !== 1) throw new Error(`Transaction ${txHash} reverted`);
  return receipt as ContractTransactionReceipt;
}

/** Splits `splitTinybars` of HBAR into YES and NO for the deployer. */
export async function split(ctx: TestnetContext, ledger: Ledger, key: string, id: bigint, splitTinybars: bigint) {
  return ledger.step(`${key}:split`, `Market ${id} split ${ethers.formatUnits(splitTinybars, 8)} HBAR`, async () => {
    const tx = await ctx.verdict.split(id, ctx.deployer, ctx.deployer, {
      value: weibars(splitTinybars),
      gasLimit: GAS.call,
    });
    await waitFor(tx.hash);
    return { txHash: tx.hash };
  });
}

/** Grants `spender` an HTS allowance of `amount` units on `token`, as its own ledger step. */
export async function approve(
  ctx: TestnetContext,
  ledger: Ledger,
  key: string,
  title: string,
  token: string,
  spender: string,
  amount: bigint,
): Promise<StepRecord> {
  return ledger.step(key, title, async () => {
    const tx = await ctx.hts.approve(token, spender, amount, { gasLimit: GAS.call });
    await waitFor(tx.hash);
    return { txHash: tx.hash };
  });
}

/**
 * Seeds the market's pool with `yesUnits` YES against `liquidityTinybars` HBAR through
 * `addLiquidityETHNewPool`, paying the pool creation fee on top with a 1 percent cushion because
 * the exchange rate can tick between the quote and the call. Skips when the pair already exists.
 */
export async function seedPool(
  ctx: TestnetContext,
  ledger: Ledger,
  key: string,
  id: bigint,
  yes: string,
  yesUnits: bigint,
  liquidityTinybars: bigint,
): Promise<string> {
  await approve(
    ctx,
    ledger,
    `${key}:approve-saucer`,
    `Market ${id} approve SaucerSwap router on YES`,
    yes,
    TESTNET_ADDRESSES.saucerswap.router,
    yesUnits,
  );
  await ledger.step(`${key}:pool`, `Market ${id} pool creation and seed`, async () => {
    const existing = await ctx.factory.getPair(yes, TESTNET_ADDRESSES.saucerswap.whbarToken);
    if (existing !== ethers.ZeroAddress) {
      console.log(`  Pool already exists at ${existing}; recording it without a new transaction`);
      return { link: hashscanContract(existing), noCost: true, data: { pair: existing } };
    }
    const rate = await ethers.getContractAt("IExchangeRate", TESTNET_ADDRESSES.exchangeRate);
    const feeTinybars = await rate.tinycentsToTinybars.staticCall(await ctx.factory.pairCreateFee());
    const feeWithCushion = (feeTinybars * 101n) / 100n;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    console.log(
      `  ${yesUnits} YES units against ${liquidityTinybars} tinybars, creation fee ${feeTinybars} tinybars (+1 percent)`,
    );
    const tx = await ctx.saucerRouter.addLiquidityETHNewPool(
      yes,
      yesUnits,
      yesUnits,
      (liquidityTinybars * 99n) / 100n,
      ctx.deployer,
      deadline,
      { value: weibars(liquidityTinybars + feeWithCushion), gasLimit: GAS.createPool },
    );
    await waitFor(tx.hash);
    const pair = await ctx.factory.getPair(yes, TESTNET_ADDRESSES.saucerswap.whbarToken);
    return { txHash: tx.hash, data: { pair, feeTinybars: feeTinybars.toString() } };
  });
  return ledger.value(`${key}:pool`, "pair");
}

/** The market's view, with its status as a name. */
export async function readMarket(ctx: TestnetContext, id: bigint) {
  // An ethers Result spreads to its indexed entries only; toObject() gives the named struct fields.
  const result = await ctx.verdict.getMarket(id);
  const m = (result as unknown as { toObject(): unknown }).toObject() as typeof result;
  return { ...m, statusName: STATUS_NAMES[Number(m.status)] ?? `Unknown(${m.status})` };
}
