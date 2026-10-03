import { ethers, network } from "hardhat";
import type { MockHederaScheduleService, MockHederaTokenService } from "../../typechain-types";

/// Addresses of the Hedera system contracts, as on the real network.
export const HTS_ADDRESS = "0x0000000000000000000000000000000000000167";
export const HSS_ADDRESS = "0x000000000000000000000000000000000000016b";

export const SUCCESS = 22n;
export const ONE_HBAR = 100_000_000n; // tinybars

/**
 * Installs the HTS and HSS mocks at their real system contract addresses on the Hardhat network, so
 * contracts under test talk to 0x167 and 0x16b exactly as they do on Hedera. The mocks keep no
 * constructor state, which is what makes `hardhat_setCode` enough.
 */
export async function installHederaMocks(): Promise<{
  hts: MockHederaTokenService;
  hss: MockHederaScheduleService;
}> {
  const htsImpl = await (await ethers.getContractFactory("MockHederaTokenService")).deploy();
  const hssImpl = await (await ethers.getContractFactory("MockHederaScheduleService")).deploy();
  await network.provider.send("hardhat_setCode", [
    HTS_ADDRESS,
    await ethers.provider.getCode(await htsImpl.getAddress()),
  ]);
  await network.provider.send("hardhat_setCode", [
    HSS_ADDRESS,
    await ethers.provider.getCode(await hssImpl.getAddress()),
  ]);
  const hts = await ethers.getContractAt("MockHederaTokenService", HTS_ADDRESS);
  const hss = await ethers.getContractAt("MockHederaScheduleService", HSS_ADDRESS);
  return { hts, hss };
}

/** Pins the timestamp of the next block without mining it, so a transaction lands at a known second. */
export async function setNextTime(timestamp: bigint | number): Promise<void> {
  await network.provider.send("evm_setNextBlockTimestamp", [Number(timestamp)]);
}

/** Moves the chain to `timestamp` and mines a block there. */
export async function setTime(timestamp: bigint | number): Promise<void> {
  await network.provider.send("evm_setNextBlockTimestamp", [Number(timestamp)]);
  await network.provider.send("evm_mine", []);
}

export async function now(): Promise<bigint> {
  const block = await ethers.provider.getBlock("latest");
  if (!block) throw new Error("no latest block");
  return BigInt(block.timestamp);
}

/** Sets an account's HBAR balance, in the tinybar-as-wei convention the tests use. */
export async function setBalance(address: string, tinybars: bigint): Promise<void> {
  await network.provider.send("hardhat_setBalance", [address, "0x" + tinybars.toString(16)]);
}
