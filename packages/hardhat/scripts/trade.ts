import { ethers, deployments } from "hardhat";
import { TESTNET_ADDRESSES } from "../config/addresses";
import { parseArgs, requireArgs, hashscanTx, WEIBARS_PER_TINYBAR } from "./lib/routerCli";

/**
 * Runs one of the four router trades on Hedera testnet with a 2 percent slippage bound.
 *
 *   yarn hardhat run scripts/trade.ts --network hederaTestnet -- --id 3 --trade buyYes --amount 1
 *
 * `--amount` is HBAR for buyYes and buyNo, and whole tokens for sellYes and sellNo. sellNo also
 * sends enough HBAR to buy the matching YES, quoted just before the trade with the same 2 percent
 * headroom, and bounds the net (the NO's worth less the YES cost) with the same 2 percent.
 * Prints the trade result and a HashScan link.
 */

const SLIPPAGE_NUM = 98n;
const SLIPPAGE_DEN = 100n;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  requireArgs(args, ["id", "trade", "amount"]);

  const id = BigInt(args.id);
  const routerDeployment = await deployments.get("VerdictRouter");
  const router = await ethers.getContractAt("VerdictRouter", routerDeployment.address);
  const verdict = await ethers.getContractAt("IVerdict", (await deployments.get("Verdict")).address);
  const market = await verdict.getMarket(id);
  if (market.expiry === 0n) throw new Error(`Market ${id} does not exist`);
  const [deployer] = await ethers.getSigners();
  const hts = await ethers.getContractAt("IHederaTokenService", TESTNET_ADDRESSES.hts);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

  let tx;
  if (args.trade === "buyYes") {
    const hbarIn = ethers.parseEther(args.amount); // weibars at the JSON-RPC boundary
    const quote = await router.quoteBuyYes(id, hbarIn / WEIBARS_PER_TINYBAR);
    const minYesOut = (quote * SLIPPAGE_NUM) / SLIPPAGE_DEN;
    console.log(`buyYes: ${args.amount} HBAR, quote ${quote} YES units, min ${minYesOut}`);
    tx = await router.buyYes(id, minYesOut, deadline, { value: hbarIn });
  } else if (args.trade === "sellYes") {
    const yesIn = ethers.parseUnits(args.amount, 8);
    const quote = await router.quoteSellYes(id, yesIn);
    const minHbarOut = (quote * SLIPPAGE_NUM) / SLIPPAGE_DEN;
    console.log(`Approving the Verdict router for ${yesIn} YES units`);
    await (await hts.approve(market.yes, routerDeployment.address, yesIn)).wait();
    console.log(`sellYes: ${yesIn} YES units, quote ${quote} tinybars, min ${minHbarOut}`);
    tx = await router.sellYes(id, yesIn, minHbarOut, deadline);
  } else if (args.trade === "buyNo") {
    const hbarIn = ethers.parseEther(args.amount);
    const [, hbarBack] = await router.quoteBuyNo(id, hbarIn / WEIBARS_PER_TINYBAR);
    const minHbarBack = (hbarBack * SLIPPAGE_NUM) / SLIPPAGE_DEN;
    console.log(`buyNo: ${args.amount} HBAR, quote ${hbarBack} tinybars back, min ${minHbarBack}`);
    tx = await router.buyNo(id, minHbarBack, deadline, { value: hbarIn });
  } else if (args.trade === "sellNo") {
    const noIn = ethers.parseUnits(args.amount, 8);
    const [needed, net] = await router.quoteSellNo(id, noIn);
    const value = (needed * SLIPPAGE_DEN * WEIBARS_PER_TINYBAR) / SLIPPAGE_NUM; // quote plus 2 percent headroom
    const minHbarOut = (net * SLIPPAGE_NUM) / SLIPPAGE_DEN; // the net of the YES purchase, less 2 percent
    console.log(`Approving the Verdict router for ${noIn} NO units`);
    await (await hts.approve(market.no, routerDeployment.address, noIn)).wait();
    console.log(`sellNo: ${noIn} NO units, YES quote ${needed} tinybars, net ${net} tinybars, min net ${minHbarOut}`);
    tx = await router.sellNo(id, noIn, minHbarOut, deadline, { value });
  } else {
    throw new Error(`Unknown trade "${args.trade}". Known: buyYes, sellYes, buyNo, sellNo`);
  }

  console.log(`Transaction: ${hashscanTx(tx.hash)}`);
  const receipt = await tx.wait();
  if (!receipt) throw new Error("Transaction was not mined");
  for (const log of receipt.logs) {
    const parsed = router.interface.parseLog({ topics: [...log.topics], data: log.data });
    if (parsed && parsed.name === "Traded") {
      console.log(
        `Traded: in ${parsed.args.amountIn}, out ${parsed.args.amountOut}, refund ${parsed.args.refund} (caller ${deployer.address})`,
      );
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
