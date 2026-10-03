// Spike 1: a contract creates an HTS token with itself as treasury and supply key.
// Records the fee, the gas, what happens to excess value, and whether a mint plus transfer to the deployer works.
// Run by hand on testnet: yarn workspace @sh/hardhat hardhat run scripts/spikes/spike1-hts-create.ts --network hederaTestnet
import { ethers } from "hardhat";

const HASHSCAN = "https://hashscan.io/testnet";
const ONE_HBAR = 100_000_000n;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("deployer", deployer.address);
  const before = await ethers.provider.getBalance(deployer.address);

  const spike = await (await ethers.getContractFactory("SpikeHts")).deploy();
  await spike.waitForDeployment();
  const address = await spike.getAddress();
  console.log("SpikeHts", address, `${HASHSCAN}/contract/${address}`);

  // Fund the contract so the creation fee and the excess are visible in its own balance.
  await (await deployer.sendTransaction({ to: address, value: 2n * ONE_HBAR * 10n ** 10n })).wait();

  for (const valueHbar of [1n, 5n, 20n]) {
    const value = valueHbar * ONE_HBAR * 10n ** 10n; // weibars at the RPC boundary
    const tx = await spike.create("Verdict spike", "VSPK", { value, gasLimit: 1_500_000 });
    const receipt = await tx.wait();
    const created = receipt?.logs
      .map(log => {
        try {
          return spike.interface.parseLog({ topics: [...log.topics], data: log.data });
        } catch {
          return null;
        }
      })
      .find(parsed => parsed?.name === "Created");
    console.log(
      `create with ${valueHbar} HBAR -> code ${created?.args.code}, token ${created?.args.token}, gas ${receipt?.gasUsed}, ` +
        `contract balance ${created?.args.balanceBefore} -> ${created?.args.balanceAfter} tinybars, tx ${HASHSCAN}/transaction/${receipt?.hash}`,
    );
    if (created?.args.code === 22n) break;
  }

  const token = await spike.token();
  if (token === ethers.ZeroAddress) throw new Error("no token created");
  console.log("token", token, `${HASHSCAN}/token/${token}`);

  const mint = await (await spike.mint(1_000_000_000n, { gasLimit: 400_000 })).wait();
  console.log("mint gas", mint?.gasUsed, `${HASHSCAN}/transaction/${mint?.hash}`);

  // The deployer associates through the token's HIP-719 facade, then the contract transfers.
  const facade = new ethers.Contract(token, ["function associate() returns (uint256)"], deployer);
  const assoc = await (await facade.associate({ gasLimit: 800_000 })).wait();
  console.log("associate gas", assoc?.gasUsed, `${HASHSCAN}/transaction/${assoc?.hash}`);

  const send = await (await spike.send(deployer.address, 100_000_000n, { gasLimit: 400_000 })).wait();
  console.log("transfer gas", send?.gasUsed, `${HASHSCAN}/transaction/${send?.hash}`);

  const after = await ethers.provider.getBalance(deployer.address);
  console.log("deployer spent", ethers.formatUnits(before - after, 18), "HBAR in total");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
