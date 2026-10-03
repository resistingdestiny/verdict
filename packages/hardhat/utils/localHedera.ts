import type { HardhatRuntimeEnvironment } from "hardhat/types";
import { hederaSystem } from "../config/addresses";

/** True for the in-process `hardhat` network and a `localhost` node, where Hedera services are mocked. */
export function isLocalNetwork(hre: HardhatRuntimeEnvironment): boolean {
  return hre.network.name === "hardhat" || hre.network.name === "localhost";
}

/**
 * Installs the HTS and HSS mocks at 0x167 and 0x16b with `hardhat_setCode`, so contracts deployed locally
 * talk to the same addresses they use on Hedera. Both mocks keep no constructor state, which is what makes
 * copying their runtime code enough. Safe to run again: it simply rewrites the same code.
 */
export async function installLocalHederaMocks(hre: HardhatRuntimeEnvironment): Promise<void> {
  const [signer] = await hre.ethers.getSigners();
  for (const [name, target] of [
    ["MockHederaTokenService", hederaSystem.hts.address],
    ["MockHederaScheduleService", hederaSystem.hss.address],
  ] as const) {
    const impl = await (await hre.ethers.getContractFactory(name, signer)).deploy();
    await impl.waitForDeployment();
    const code = await hre.ethers.provider.getCode(await impl.getAddress());
    await hre.network.provider.send("hardhat_setCode", [target, code]);
  }
}
