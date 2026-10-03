// Recovers the deployer's HBAR from deployment v1 after the scheduled-run timing defect: resolves any market
// past its expiry that is still open (the manual fallback the README documents), removes the deployer's pool
// liquidity, and redeems the YES and NO it holds. Run by hand on testnet:
//   VERDICT_V1=0x51c0810324931151bA31db317F23810040e0a250 MARKETS=1,2,3,4 \
//   yarn workspace @sh/hardhat hardhat run scripts/spikes/recover-v1.ts --network hederaTestnet
import { ethers } from "hardhat";
import { TESTNET_ADDRESSES } from "../../config/addresses";

const HASHSCAN = "https://hashscan.io/testnet/transaction";
const GAS = 3_000_000n;

const erc20Abi = ["function balanceOf(address) view returns (uint256)"];
const factoryAbi = ["function getPair(address,address) view returns (address)"];
const pairAbi = ["function lpToken() view returns (address)"];
const routerAbi = [
  "function removeLiquidityETH(address token, uint liquidity, uint amountTokenMin, uint amountETHMin, address to, uint deadline) returns (uint amountToken, uint amountETH)",
];

async function main() {
  const verdictAddress = process.env.VERDICT_V1;
  if (!verdictAddress) throw new Error("set VERDICT_V1 to the deployment v1 Verdict address");
  const ids = (process.env.MARKETS ?? "").split(",").filter(Boolean).map(BigInt);
  const [deployer] = await ethers.getSigners();
  const verdict = await ethers.getContractAt("IVerdict", verdictAddress, deployer);
  const hts = await ethers.getContractAt("IHederaTokenService", TESTNET_ADDRESSES.hts, deployer);
  const factory = new ethers.Contract(TESTNET_ADDRESSES.saucerswap.factory, factoryAbi, deployer);
  const router = new ethers.Contract(TESTNET_ADDRESSES.saucerswap.router, routerAbi, deployer);
  const before = await ethers.provider.getBalance(deployer.address);
  console.log(`deployer ${deployer.address} holds ${ethers.formatUnits(before, 18)} HBAR`);

  for (const id of ids) {
    const market = await verdict.getMarket(id);
    const now = BigInt(Math.floor(Date.now() / 1000));
    console.log(`market ${id}: status ${market.status}, expiry ${market.expiry}, payout ${market.payout}`);
    if (market.status === 0n && now > market.expiry) {
      const tx = await verdict.resolve(id, { gasLimit: GAS });
      await tx.wait();
      console.log(`  resolved by hand: ${HASHSCAN}/${tx.hash}`);
    }
    const settled = await verdict.getMarket(id);
    if (settled.status === 0n) {
      console.log("  still open, skipping");
      continue;
    }
    const pair = (await factory.getPair(market.yes, TESTNET_ADDRESSES.saucerswap.whbarToken)) as string;
    if (pair !== ethers.ZeroAddress) {
      // A SaucerSwap pair mints a separate HTS token for its liquidity; the pair contract is not that token.
      const lpToken = (await new ethers.Contract(pair, pairAbi, deployer).lpToken()) as string;
      const lp = new ethers.Contract(lpToken, erc20Abi, deployer);
      const liquidity: bigint = await lp.balanceOf(deployer.address);
      if (liquidity > 0n) {
        await (
          await hts.approve(lpToken, TESTNET_ADDRESSES.saucerswap.router, liquidity, { gasLimit: 1_000_000n })
        ).wait();
        const deadline = Math.floor(Date.now() / 1000) + 600;
        const tx = await router.removeLiquidityETH(market.yes, liquidity, 0, 0, deployer.address, deadline, {
          gasLimit: GAS,
        });
        await tx.wait();
        console.log(`  removed ${liquidity} LP units: ${HASHSCAN}/${tx.hash}`);
      }
    }
    const yes = new ethers.Contract(market.yes, erc20Abi, deployer);
    const no = new ethers.Contract(market.no, erc20Abi, deployer);
    const yesBal: bigint = await yes.balanceOf(deployer.address);
    const noBal: bigint = await no.balanceOf(deployer.address);
    if (yesBal === 0n && noBal === 0n) {
      console.log("  nothing to redeem");
      continue;
    }
    if (yesBal > 0n) await (await hts.approve(market.yes, verdictAddress, yesBal, { gasLimit: 1_000_000n })).wait();
    if (noBal > 0n) await (await hts.approve(market.no, verdictAddress, noBal, { gasLimit: 1_000_000n })).wait();
    const tx = await verdict.redeem(id, yesBal, noBal, deployer.address, { gasLimit: GAS });
    await tx.wait();
    console.log(`  redeemed ${yesBal} YES and ${noBal} NO at payout ${settled.payout}: ${HASHSCAN}/${tx.hash}`);
  }

  const after = await ethers.provider.getBalance(deployer.address);
  console.log(
    `deployer now holds ${ethers.formatUnits(after, 18)} HBAR (${ethers.formatUnits(after - before, 18)} recovered net of fees)`,
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
