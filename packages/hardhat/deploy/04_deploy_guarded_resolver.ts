import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { deploymentDefaults, feedIdOf, hederaTestnetFeeds, hederaTestnetSupra } from "../config/addresses";
import { isLocalNetwork } from "../utils/localHedera";

const SUPRA_DECIMALS = 18;

/** Each guarded feed: the local mock aggregator 01 deploys, the testnet feed and the Supra pair for the asset. */
const guardedFeeds = [
  {
    localAggregator: "MockAggregatorHbarUsd",
    testnet: hederaTestnetFeeds.hbarUsd,
    pair: hederaTestnetSupra.pairs.hbarUsdt,
  },
  {
    localAggregator: "MockAggregatorBtcUsd",
    testnet: hederaTestnetFeeds.btcUsd,
    pair: hederaTestnetSupra.pairs.btcUsdt,
  },
  {
    localAggregator: "MockAggregatorEthUsd",
    testnet: hederaTestnetFeeds.ethUsd,
    pair: hederaTestnetSupra.pairs.ethUsdt,
  },
] as const;

/**
 * Deploys GuardedResolver over the deployed ChainlinkResolver and allows it on Verdict, so markets can be created
 * against it with no change to Verdict.
 *
 * On local networks it also deploys a MockSupraSValueFeed and publishes, for each pair, the price and time of the
 * matching mock aggregator's latest round, so the two oracles agree until a test or a developer moves one.
 * On Hedera testnet it runs only when `GUARDED=1` is set, so a normal deploy costs nothing extra, and it checks
 * the real Supra push oracle with pairs 75, 0 and 1 against HBAR / USD, BTC / USD and ETH / USD.
 * Tolerance, maximum delay and Supra staleness come from `deploymentDefaults.guardedResolver`.
 */
const deployGuardedResolver: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, execute, get, read, log } = hre.deployments;
  const local = isLocalNetwork(hre);

  if (!local && !(hre.network.name === "hederaTestnet" && process.env.GUARDED === "1")) {
    console.log(`04_deploy_guarded_resolver: skipping on ${hre.network.name}; set GUARDED=1 to deploy it on testnet.`);
    return;
  }

  let supraAddress: string;
  let feedIds: string[];
  if (local) {
    const supra = await deploy("MockSupraSValueFeed", { from: deployer, log: true, autoMine: true });
    feedIds = [];
    for (const feed of guardedFeeds) {
      const aggregator = await hre.ethers.getContractAt("MockAggregatorV3", (await get(feed.localAggregator)).address);
      if (supra.newlyDeployed) {
        const [, answer, , updatedAt] = await aggregator.latestRoundData();
        const scale = 10n ** BigInt(SUPRA_DECIMALS - Number(await aggregator.decimals()));
        await execute(
          "MockSupraSValueFeed",
          { from: deployer, log: true },
          "setSvalue",
          feed.pair,
          answer * scale,
          SUPRA_DECIMALS,
          updatedAt * 1000n,
        );
      }
      feedIds.push(feedIdOf(await aggregator.getAddress()));
    }
    supraAddress = supra.address;
  } else {
    supraAddress = hederaTestnetSupra.pushOracle.address;
    feedIds = guardedFeeds.map(feed => feedIdOf(feed.testnet.address));
  }

  const { toleranceBps, maxDelaySeconds, supraMaxStalenessSeconds } = deploymentDefaults.guardedResolver;
  const chainlink = await get("ChainlinkResolver");
  const guarded = await deploy("GuardedResolver", {
    from: deployer,
    args: [
      chainlink.address,
      supraAddress,
      toleranceBps,
      maxDelaySeconds,
      supraMaxStalenessSeconds,
      feedIds,
      guardedFeeds.map(feed => feed.pair),
    ],
    log: true,
    autoMine: true,
  });

  const allowed: boolean = await read("Verdict", "resolverAllowed", guarded.address);
  if (!allowed) {
    await execute("Verdict", { from: deployer, log: true }, "setResolver", guarded.address, true);
  }
  log(`GuardedResolver ${guarded.address} allowed on Verdict, Supra oracle ${supraAddress}`);
};

export default deployGuardedResolver;
deployGuardedResolver.tags = ["GuardedResolver"];
deployGuardedResolver.dependencies = ["ChainlinkResolver"];
