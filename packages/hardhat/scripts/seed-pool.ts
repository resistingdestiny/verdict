import { ethers, deployments } from "hardhat";
import { TESTNET_ADDRESSES } from "../config/addresses";
import { parseArgs, requireArgs, hashscanTx, hashscanContract, WEIBARS_PER_TINYBAR } from "./lib/routerCli";

/**
 * Splits HBAR into YES and NO and seeds the market's SaucerSwap pool on Hedera testnet.
 *
 *   ID=3 SPLIT=20 LIQUIDITY=10 yarn hardhat:seed-pool
 *
 * Splits `SPLIT` HBAR, approves the SaucerSwap router on YES, then calls addLiquidityETHNewPool
 * with that many whole YES against `LIQUIDITY` HBAR, plus the pool creation fee. The gas limit is
 * 9,000,000 because pool creation measured about 6.8 million gas on testnet. The creator keeps the
 * NO leg: seeding a pool is a position, and the NO tokens stay in the deployer account.
 */

const POOL_CREATE_GAS_LIMIT = 9_000_000n;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  requireArgs(args, ["id", "split", "liquidity"]);

  const id = BigInt(args.id);
  const splitHbar = ethers.parseUnits(args.split, 8); // tinybars inside the EVM
  const liquidityTinybars = ethers.parseUnits(args.liquidity, 8);

  const [deployer] = await ethers.getSigners();
  const verdictDeployment = await deployments.get("Verdict");
  const verdict = await ethers.getContractAt("IVerdict", verdictDeployment.address);
  const market = await verdict.getMarket(id);
  if (market.expiry === 0n) throw new Error(`Market ${id} does not exist`);

  const { saucerswap, hts: htsAddress, exchangeRate } = TESTNET_ADDRESSES;
  const hts = await ethers.getContractAt("IHederaTokenService", htsAddress);
  const factory = await ethers.getContractAt("ISaucerSwapFactory", saucerswap.factory);
  const saucerRouter = await ethers.getContractAt("ISaucerSwapRouter", saucerswap.router);
  const rate = await ethers.getContractAt("IExchangeRate", exchangeRate);

  const existing = await factory.getPair(market.yes, saucerswap.whbarToken);
  if (existing !== ethers.ZeroAddress) throw new Error(`Pool already exists at ${existing}`);

  console.log(`Splitting ${args.split} HBAR into YES and NO on market ${id}`);
  const splitTx = await verdict.split(id, deployer.address, deployer.address, {
    value: splitHbar * WEIBARS_PER_TINYBAR,
    gasLimit: 3_000_000n, // two first-use token associations for the recipient cost about 700,000 gas each
  });
  console.log(`Split: ${hashscanTx(splitTx.hash)}`);
  await splitTx.wait();

  console.log(`Approving the SaucerSwap router for ${splitHbar} YES units`);
  const approveTx = await hts.approve(market.yes, saucerswap.router, splitHbar, { gasLimit: 1_000_000n });
  console.log(`Approve: ${hashscanTx(approveTx.hash)}`);
  await approveTx.wait();

  const feeTinybars = await rate.tinycentsToTinybars.staticCall(await factory.pairCreateFee());
  const valueTinybars = liquidityTinybars + feeTinybars;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  console.log(`Creating the pool: ${splitHbar} YES against ${liquidityTinybars} tinybars, fee ${feeTinybars} tinybars`);
  const seedTx = await saucerRouter.addLiquidityETHNewPool(
    market.yes,
    splitHbar,
    splitHbar,
    liquidityTinybars,
    deployer.address,
    deadline,
    { value: valueTinybars * WEIBARS_PER_TINYBAR, gasLimit: POOL_CREATE_GAS_LIMIT },
  );
  console.log(`Pool creation: ${hashscanTx(seedTx.hash)}`);
  await seedTx.wait();

  const pair = await factory.getPair(market.yes, saucerswap.whbarToken);
  console.log(`Pool: ${pair}  ${hashscanContract(pair)}`);
  console.log(`The creator keeps the NO leg of the split in ${deployer.address}.`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
