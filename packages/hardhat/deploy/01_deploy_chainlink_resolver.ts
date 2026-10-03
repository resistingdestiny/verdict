import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { feedIdOf, hederaSystem, hederaTestnetFeeds } from "../config/addresses";
import { isLocalNetwork } from "../utils/localHedera";

const ONE_HBAR = 100_000_000n;
const DAY = 24 * 60 * 60;

/** A mock aggregator per testnet feed, with a starting price in the feed's 8 decimals. */
const localFeeds = [
  { name: "MockAggregatorHbarUsd", pair: "HBAR / USD", price: 8_000_000n, staleness: 6 * 60 * 60 },
  { name: "MockAggregatorBtcUsd", pair: "BTC / USD", price: 110_000n * ONE_HBAR, staleness: DAY },
  { name: "MockAggregatorEthUsd", pair: "ETH / USD", price: 4_000n * ONE_HBAR, staleness: DAY },
] as const;

/**
 * Deploys ChainlinkResolver and allows it on Verdict. On Hedera testnet it reads the three Chainlink feeds
 * from `config/addresses.ts`. On local networks it deploys a MockAggregatorV3 per feed with one round at a
 * starting price, gives every Hardhat account unlimited automatic token associations (as a wallet would be
 * configured), and creates three sample markets with a few HBAR split into each so the app has data.
 */
const deployChainlinkResolver: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, execute, read, log } = hre.deployments;
  const local = isLocalNetwork(hre);

  let aggregators: string[];
  let staleness: number[];
  if (local) {
    const block = await hre.ethers.provider.getBlock("latest");
    if (!block) throw new Error("no latest block");
    aggregators = [];
    staleness = [];
    for (const feed of localFeeds) {
      const result = await deploy(feed.name, {
        contract: "MockAggregatorV3",
        from: deployer,
        args: [8, feed.pair],
        log: true,
        autoMine: true,
      });
      if (result.newlyDeployed) {
        await execute(feed.name, { from: deployer, log: true }, "pushRound", feed.price, block.timestamp);
      }
      aggregators.push(result.address);
      staleness.push(feed.staleness);
    }
  } else {
    const feeds = Object.values(hederaTestnetFeeds);
    aggregators = feeds.map(feed => feed.address);
    staleness = feeds.map(feed => feed.maxStalenessSeconds);
  }

  const resolver = await deploy("ChainlinkResolver", {
    from: deployer,
    args: [aggregators, staleness],
    log: true,
    autoMine: true,
  });

  const allowed: boolean = await read("Verdict", "resolverAllowed", resolver.address);
  if (!allowed) {
    await execute("Verdict", { from: deployer, log: true }, "setResolver", resolver.address, true);
  }

  if (!local) return;

  const hts = await hre.ethers.getContractAt("MockHederaTokenService", hederaSystem.hts.address);
  for (const signer of await hre.ethers.getSigners()) {
    await (await hts.setAutoAssociationSlots(signer.address, hre.ethers.MaxUint256)).wait();
  }

  const marketCount: bigint = await read("Verdict", "marketCount");
  if (marketCount > 0n) return;

  const block = await hre.ethers.provider.getBlock("latest");
  if (!block) throw new Error("no latest block");
  const now = block.timestamp;
  const creationCost: bigint = await read("Verdict", "creationCost");
  const [hbarUsd, btcUsd, ethUsd] = aggregators.map(feedIdOf);
  const samples = [
    { kind: 0, feedId: hbarUsd, lower: 7_000_000n, upper: 0n, expiry: now + DAY, label: "HBAR / USD above 0.07" },
    {
      kind: 2,
      feedId: ethUsd,
      lower: 3_500n * ONE_HBAR,
      upper: 4_500n * ONE_HBAR,
      expiry: now + 2 * DAY,
      label: "ETH / USD between 3500 and 4500",
    },
    {
      kind: 3,
      feedId: btcUsd,
      lower: 100_000n * ONE_HBAR,
      upper: 120_000n * ONE_HBAR,
      expiry: now + 3 * DAY,
      label: "BTC / USD scalar 100000 to 120000",
    },
  ];
  for (const [index, sample] of samples.entries()) {
    await execute(
      "Verdict",
      { from: deployer, value: creationCost.toString(), log: true },
      "createMarket",
      resolver.address,
      sample.feedId,
      sample.kind,
      sample.lower,
      sample.upper,
      sample.expiry,
    );
    await execute(
      "Verdict",
      { from: deployer, value: (20n * ONE_HBAR).toString(), log: true },
      "split",
      index,
      deployer,
      deployer,
    );
    log(`Sample market ${index}: ${sample.label}, 20 HBAR split to the deployer`);
  }
};

export default deployChainlinkResolver;
deployChainlinkResolver.tags = ["ChainlinkResolver"];
deployChainlinkResolver.dependencies = ["Verdict"];
