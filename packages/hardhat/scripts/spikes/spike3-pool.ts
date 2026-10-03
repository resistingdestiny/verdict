// Spike 3: an account creates a SaucerSwap V1 pool for a fresh HTS token against HBAR, then swaps both ways.
// Records the fee, the gas, the association the LP token needs and the refund behaviour.
// Needs the token from spike 1 held by the deployer: pass TOKEN=0x... in the environment.
// Run by hand on testnet: TOKEN=0x... yarn workspace @sh/hardhat hardhat run scripts/spikes/spike3-pool.ts --network hederaTestnet
import { ethers } from "hardhat";

const HASHSCAN = "https://hashscan.io/testnet";
const MIRROR = "https://testnet.mirrornode.hedera.com/api/v1";
const FACTORY = "0x00000000000000000000000000000000000026e7";
const ROUTER = "0x0000000000000000000000000000000000004b40";
const WHBAR_TOKEN = "0x0000000000000000000000000000000000003aD2";
const EXCHANGE_RATE = "0x0000000000000000000000000000000000000168";
const ONE_HBAR = 100_000_000n;
const WEIBARS = 10n ** 10n;

const routerAbi = [
  "function addLiquidityETHNewPool(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) payable returns (uint amountToken, uint amountETH, uint liquidity)",
  "function swapExactETHForTokens(uint amountOutMin, address[] path, address to, uint deadline) payable returns (uint[] amounts)",
  "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline) returns (uint[] amounts)",
  "function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)",
];
const factoryAbi = [
  "function pairCreateFee() view returns (uint256)",
  "function getPair(address,address) view returns (address)",
];
const erc20Abi = [
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];

async function main() {
  const token = process.env.TOKEN;
  if (!token) throw new Error("set TOKEN to the HTS token address from spike 1");
  const [deployer] = await ethers.getSigners();
  const router = new ethers.Contract(ROUTER, routerAbi, deployer);
  const factory = new ethers.Contract(FACTORY, factoryAbi, deployer);
  const erc20 = new ethers.Contract(token, erc20Abi, deployer);
  const rate = new ethers.Contract(
    EXCHANGE_RATE,
    ["function tinycentsToTinybars(uint256) view returns (uint256)"],
    deployer,
  );

  const account = await fetch(`${MIRROR}/accounts/${deployer.address}`).then(r => r.json());
  console.log(
    "deployer",
    deployer.address,
    account.account,
    "max auto associations",
    account.max_automatic_token_associations,
  );

  const feeTinycents: bigint = await factory.pairCreateFee();
  const feeTinybars: bigint = await rate.tinycentsToTinybars(feeTinycents);
  console.log(`pairCreateFee ${feeTinycents} tinycents = ${feeTinybars} tinybars = ${Number(feeTinybars) / 1e8} HBAR`);

  const tokenAmount = 500_000_000n; // 5 tokens with 8 decimals
  const hbarLiquidity = 5n * ONE_HBAR;
  await (await erc20.approve(ROUTER, tokenAmount, { gasLimit: 800_000 })).wait();
  console.log("approved router on token");

  const deadline = Math.floor(Date.now() / 1000) + 600;
  const value = (hbarLiquidity + feeTinybars + ONE_HBAR) * WEIBARS; // one HBAR extra to observe the refund
  const balanceBefore = await ethers.provider.getBalance(deployer.address);
  const tx = await router.addLiquidityETHNewPool(
    token,
    tokenAmount,
    tokenAmount,
    hbarLiquidity,
    deployer.address,
    deadline,
    {
      value,
      gasLimit: 9_000_000,
    },
  );
  const receipt = await tx.wait();
  const balanceAfter = await ethers.provider.getBalance(deployer.address);
  console.log(
    `pool created: gas ${receipt?.gasUsed}, deployer balance change ${ethers.formatUnits(balanceBefore - balanceAfter, 18)} HBAR, tx ${HASHSCAN}/transaction/${receipt?.hash}`,
  );
  const pair = await factory.getPair(token, WHBAR_TOKEN);
  console.log("pair", pair, `${HASHSCAN}/contract/${pair}`);

  const buy = await (
    await router.swapExactETHForTokens(0, [WHBAR_TOKEN, token], deployer.address, deadline, {
      value: ONE_HBAR * WEIBARS,
      gasLimit: 1_500_000,
    })
  ).wait();
  console.log("swap HBAR -> token gas", buy?.gasUsed, `${HASHSCAN}/transaction/${buy?.hash}`);

  await (await erc20.approve(ROUTER, 50_000_000n, { gasLimit: 800_000 })).wait();
  const sell = await (
    await router.swapExactTokensForETH(50_000_000n, 0, [token, WHBAR_TOKEN], deployer.address, deadline, {
      gasLimit: 1_500_000,
    })
  ).wait();
  console.log("swap token -> HBAR gas", sell?.gasUsed, `${HASHSCAN}/transaction/${sell?.hash}`);

  const tokens = await fetch(`${MIRROR}/accounts/${deployer.address}/tokens?limit=50`).then(r => r.json());
  console.log(
    "deployer token associations now:",
    (tokens.tokens ?? []).map((t: { token_id: string }) => t.token_id).join(", "),
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
