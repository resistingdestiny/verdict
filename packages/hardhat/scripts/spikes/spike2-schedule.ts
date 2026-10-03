// Spike 2: a contract schedules a call to itself through HSS.
// Records the horizon hasScheduleCapacity accepts, the schedule address, the fee charged at scheduling,
// then waits for the execution and records the sender the scheduled call saw and the balance drawn.
// Run by hand on testnet: yarn workspace @sh/hardhat hardhat run scripts/spikes/spike2-schedule.ts --network hederaTestnet
import { ethers } from "hardhat";

const HASHSCAN = "https://hashscan.io/testnet";
const MIRROR = "https://testnet.mirrornode.hedera.com/api/v1";
const ONE_HBAR = 100_000_000n;
const GAS_LIMIT = 2_000_000n;

async function main() {
  const [deployer] = await ethers.getSigners();
  const spike = await (await ethers.getContractFactory("SpikeScheduler")).deploy();
  await spike.waitForDeployment();
  const address = await spike.getAddress();
  console.log("SpikeScheduler", address, `${HASHSCAN}/contract/${address}`);
  await (await deployer.sendTransaction({ to: address, value: 10n * ONE_HBAR * 10n ** 10n })).wait();

  const block = await ethers.provider.getBlock("latest");
  const now = BigInt(block!.timestamp);
  const horizons: [string, bigint][] = [
    ["5 min", 300n],
    ["1 day", 86_400n],
    ["30 days", 30n * 86_400n],
    ["62 days", 62n * 86_400n],
    ["90 days", 90n * 86_400n],
    ["1 year", 365n * 86_400n],
  ];
  for (const [label, ahead] of horizons) {
    const ok = await spike.capacity(now + ahead, GAS_LIMIT);
    console.log(`hasScheduleCapacity(now + ${label}) = ${ok}`);
  }

  const second = now + 150n;
  const balanceBefore = await ethers.provider.getBalance(address);
  const tx = await spike.schedule(second, GAS_LIMIT, { gasLimit: 1_000_000 });
  const receipt = await tx.wait();
  const scheduled = receipt?.logs
    .map(log => {
      try {
        return spike.interface.parseLog({ topics: [...log.topics], data: log.data });
      } catch {
        return null;
      }
    })
    .find(parsed => parsed?.name === "Scheduled");
  const balanceAfter = await ethers.provider.getBalance(address);
  console.log(
    `scheduleCall -> code ${scheduled?.args.code}, schedule ${scheduled?.args.schedule}, gas ${receipt?.gasUsed}, ` +
      `contract balance ${ethers.formatUnits(balanceBefore, 18)} -> ${ethers.formatUnits(balanceAfter, 18)} HBAR, ` +
      `tx ${HASHSCAN}/transaction/${receipt?.hash}`,
  );
  if (scheduled?.args.code !== 22n) throw new Error("schedule failed");
  console.log("schedule entity", `${HASHSCAN}/schedule/${scheduled?.args.schedule}`);

  console.log("waiting for the scheduled execution at", new Date(Number(second) * 1000).toISOString());
  for (let i = 0; i < 40; i++) {
    await new Promise(resolve => setTimeout(resolve, 15_000));
    const pings = await spike.pings();
    if (pings > 0n) break;
    process.stdout.write(".");
  }
  console.log("\npings", await spike.pings());

  const logs = await ethers.provider.getLogs({
    address,
    fromBlock: receipt!.blockNumber,
    topics: [spike.interface.getEvent("Pinged").topicHash],
  });
  for (const log of logs) {
    const parsed = spike.interface.parseLog({ topics: [...log.topics], data: log.data });
    console.log(
      `Pinged: sender ${parsed?.args.sender}, origin ${parsed?.args.origin}, at ${parsed?.args.timestamp}, ` +
        `gasLeft ${parsed?.args.gasLeft}, contract balance ${parsed?.args.balance} tinybars, tx ${HASHSCAN}/transaction/${log.transactionHash}`,
    );
  }
  const balanceEnd = await ethers.provider.getBalance(address);
  console.log(
    `contract balance after execution ${ethers.formatUnits(balanceEnd, 18)} HBAR (drawn ${ethers.formatUnits(balanceAfter - balanceEnd, 18)})`,
  );

  const results = await fetch(`${MIRROR}/contracts/${address}/results?limit=5&order=desc`).then(r => r.json());
  for (const r of results.results ?? []) {
    console.log(
      `mirror: from ${r.from} to ${r.to} function ${r.function_parameters?.slice(0, 10)} result ${r.result} hash ${r.hash}`,
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
