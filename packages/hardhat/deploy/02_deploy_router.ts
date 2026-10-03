import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { TESTNET_ADDRESSES } from "../config/addresses";

/**
 * Deploys VerdictRouter against the already deployed Verdict and the SaucerSwap V1 testnet
 * addresses from config/addresses.ts. The router is stateless and replaceable: redeploying it
 * never touches markets or collateral.
 */
const deployVerdictRouter: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const verdict = await hre.deployments.get("Verdict");
  const { saucerswap } = TESTNET_ADDRESSES;

  await deploy("VerdictRouter", {
    from: deployer,
    args: [verdict.address, saucerswap.router, saucerswap.factory, saucerswap.whbarToken],
    log: true,
    autoMine: true,
  });
};

export default deployVerdictRouter;
deployVerdictRouter.tags = ["VerdictRouter"];
deployVerdictRouter.dependencies = ["Verdict"];
