import { ethers, deployments } from "hardhat";
import { TESTNET_ADDRESSES, feedIdFor } from "../config/addresses";
import { parseArgs, requireArgs, hashscanTx, hashscanToken, WEIBARS_PER_TINYBAR } from "./lib/routerCli";

/**
 * Creates a Verdict market on Hedera testnet.
 *
 *   FEED=HBAR/USD KIND=Above LOWER=0.10 EXPIRY=2026-10-09T16:00:00Z yarn hardhat:create-market
 *   (flags of the same names also work when the script is run through hardhat directly)
 *
 * `RESOLVER=guarded` creates the market against the deployed GuardedResolver (deployed with
 * `GUARDED=1 yarn hardhat:deploy:testnet`) instead of ChainlinkResolver, the default.
 *
 * Bounds are human units, converted with the feed's decimals. Prints the market id, the YES and NO
 * tokens and the resolution schedule, with HashScan links.
 */

const KINDS: Record<string, number> = { Above: 0, Below: 1, Between: 2, Scalar: 3 };

/** `RESOLVER` values and the deployment each names, with the command that deploys it. */
const RESOLVERS: Record<string, { name: string; deploy: string }> = {
  chainlink: { name: "ChainlinkResolver", deploy: "yarn hardhat:deploy:testnet" },
  guarded: { name: "GuardedResolver", deploy: "GUARDED=1 yarn hardhat:deploy:testnet" },
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  requireArgs(args, ["feed", "kind", "lower", "expiry"]);

  const feed = TESTNET_ADDRESSES.chainlink[args.feed];
  if (!feed)
    throw new Error(`Unknown feed "${args.feed}". Known: ${Object.keys(TESTNET_ADDRESSES.chainlink).join(", ")}`);
  const kind = KINDS[args.kind];
  if (kind === undefined) throw new Error(`Unknown kind "${args.kind}". Known: ${Object.keys(KINDS).join(", ")}`);
  const needsUpper = kind === 2 || kind === 3;
  if (needsUpper) requireArgs(args, ["upper"]);

  const lower = ethers.parseUnits(args.lower, feed.decimals);
  const upper = needsUpper ? ethers.parseUnits(args.upper, feed.decimals) : 0n;
  const expiryMs = Date.parse(args.expiry);
  if (Number.isNaN(expiryMs)) throw new Error(`Bad --expiry "${args.expiry}", expected an ISO date`);
  const expiry = Math.floor(expiryMs / 1000);

  const resolverKey = args.resolver ?? process.env.RESOLVER ?? "chainlink";
  const resolver = RESOLVERS[resolverKey];
  if (!resolver) throw new Error(`Unknown resolver "${resolverKey}". Known: ${Object.keys(RESOLVERS).join(", ")}`);
  const resolverDeployment = await deployments.getOrNull(resolver.name);
  if (!resolverDeployment) throw new Error(`${resolver.name} is not deployed. Run ${resolver.deploy} first.`);
  const verdictDeployment = await deployments.get("Verdict");
  const verdict = await ethers.getContractAt("IVerdict", verdictDeployment.address);

  const cost = await verdict.creationCost();
  const feedId = feedIdFor(feed.feed);
  console.log(
    `Creating ${args.kind} market on ${args.feed}: lower=${args.lower} upper=${needsUpper ? args.upper : "-"} expiry=${args.expiry}`,
  );
  console.log(`${resolver.name} ${resolverDeployment.address}, feedId ${feedId}, cost ${cost} tinybars`);

  const tx = await verdict.createMarket(resolverDeployment.address, feedId, kind, lower, upper, expiry, {
    value: cost * WEIBARS_PER_TINYBAR,
    gasLimit: 6_000_000n, // two HTS token creations plus the HSS schedule, measured at about 2.5 million gas
  });
  console.log(`Transaction: ${hashscanTx(tx.hash)}`);
  const receipt = await tx.wait();
  if (!receipt) throw new Error("Transaction was not mined");

  for (const log of receipt.logs) {
    const parsed = verdict.interface.parseLog({ topics: [...log.topics], data: log.data });
    if (parsed && parsed.name === "MarketCreated") {
      console.log(`Market id: ${parsed.args.id}`);
      console.log(`YES token: ${parsed.args.yes}  ${hashscanToken(parsed.args.yes)}`);
      console.log(`NO token:  ${parsed.args.no}  ${hashscanToken(parsed.args.no)}`);
      const scheduleId = `0.0.${BigInt(parsed.args.schedule as string)}`;
      console.log(
        `Schedule:  ${parsed.args.schedule} (${scheduleId}) https://hashscan.io/testnet/schedule/${scheduleId}`,
      );
      return;
    }
  }
  throw new Error("MarketCreated event not found in the receipt");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
