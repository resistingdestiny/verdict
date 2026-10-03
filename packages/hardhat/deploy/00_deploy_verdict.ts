import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deploymentDefaults } from "../config/addresses";
import { installLocalHederaMocks, isLocalNetwork } from "../utils/localHedera";

/**
 * Deploys Verdict with the deployer as owner. On local networks the HTS and HSS mocks are installed first
 * at 0x167 and 0x16b, so the contract works against the same addresses it uses on Hedera.
 *
 * `TOKEN_CREATE_VALUE` (tinybars) overrides the value sent with each HTS token creation; the owner can also
 * change it later with `setTokenCreateValue`.
 */
const deployVerdict: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, log } = hre.deployments;

  if (isLocalNetwork(hre)) {
    await installLocalHederaMocks(hre);
    log("Installed HTS and HSS mocks at 0x167 and 0x16b");
  }

  const tokenCreateValue = process.env.TOKEN_CREATE_VALUE
    ? BigInt(process.env.TOKEN_CREATE_VALUE)
    : deploymentDefaults.tokenCreateValue;

  await deploy("Verdict", {
    from: deployer,
    args: [deployer, tokenCreateValue],
    log: true,
    autoMine: true,
  });
};

export default deployVerdict;
deployVerdict.tags = ["Verdict"];
