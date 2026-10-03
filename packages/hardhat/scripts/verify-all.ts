import * as fs from "fs";
import * as path from "path";
import { verifyOnSourcify } from "./verifySourcify";
import { Ledger, appendTableRow, EVIDENCE_PATH } from "./lib/evidence";
import { hashscanContract } from "./lib/hashscan";

/**
 * Verifies Verdict, ChainlinkResolver and VerdictRouter on Sourcify from deployments/hederaTestnet,
 * through the scaffold's verify flow, and records each deployment in docs/EVIDENCE.md and
 * docs/COSTS.md:
 *
 *   yarn hardhat:compile && yarn hardhat:verify-all
 *
 * Idempotent: a contract Sourcify already knows is reported as verified without resubmitting, and
 * a deployment already in the checkpoint is not written to the docs twice. Runs with ts-node and
 * needs no network account, only the compiled artifacts and the deployment files.
 */

const CONTRACTS = ["Verdict", "ChainlinkResolver", "VerdictRouter"] as const;
const NETWORK = { chainId: 296, hashscan: "https://hashscan.io/testnet" };
const DEPLOYMENTS_DIR = path.join(__dirname, "..", "deployments", "hederaTestnet");
const SOURCIFY_API = "https://sourcify.dev/server/v2";
const SECTION = "## Verified contracts";
const HEADER = "| Contract | Address | HashScan | Sourcify match |";

type Deployment = { address: string; transactionHash?: string; receipt?: { from?: string } };

function readDeployment(name: string): Deployment | null {
  const file = path.join(DEPLOYMENTS_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as Deployment;
}

/** Sourcify's current match for the address, or null when it has none. */
async function existingMatch(address: string): Promise<string | null> {
  const res = await fetch(`${SOURCIFY_API}/contract/${NETWORK.chainId}/${address}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Sourcify answered ${res.status} for ${address}`);
  const body = (await res.json()) as { match?: string | null; runtimeMatch?: string | null };
  return body.match ?? body.runtimeMatch ?? null;
}

async function main() {
  const missing = CONTRACTS.filter(name => !readDeployment(name));
  if (missing.length === CONTRACTS.length) {
    throw new Error(`No deployments in ${DEPLOYMENTS_DIR}. Run yarn hardhat:deploy --network hederaTestnet first.`);
  }
  if (!fs.existsSync(path.join(__dirname, "..", "artifacts", "build-info"))) {
    throw new Error(
      "No artifacts/build-info. Run yarn hardhat:compile first so Sourcify gets the exact compiler input.",
    );
  }

  const deployer = readDeployment(CONTRACTS[0])?.receipt?.from ?? readDeployment("VerdictRouter")?.receipt?.from;
  if (!deployer) throw new Error("Deployment files carry no receipt.from; cannot open the ledger for this deployer.");
  const ledger = new Ledger("hederaTestnet", deployer);

  let failures = 0;
  for (const name of CONTRACTS) {
    const deployment = readDeployment(name);
    if (!deployment) {
      console.log(`${name}: not deployed, skipping`);
      failures += 1;
      continue;
    }
    const { address } = deployment;
    const known = await existingMatch(address);
    let match: string | null = known;
    if (known) {
      console.log(`${name} at ${address}: already verified (${known})`);
    } else {
      console.log(`${name} at ${address}: submitting to Sourcify`);
      const ok = await verifyOnSourcify(name, address, NETWORK);
      match = ok ? ((await existingMatch(address)) ?? "match") : null;
      if (!ok) failures += 1;
    }
    if (deployment.transactionHash) {
      await ledger.step(`deploy:${name}`, `Deploy ${name}`, async () => ({
        txHash: deployment.transactionHash,
        link: hashscanContract(address),
        data: { address },
      }));
    }
    await ledger
      .step(`verify:${name}`, `Verify ${name} on Sourcify`, async () => {
        if (!match) throw new Error(`${name} is not verified yet`);
        appendTableRow(
          EVIDENCE_PATH,
          SECTION,
          HEADER,
          `| \`${name}\` | ${address} | [contract](${hashscanContract(address)}) | ${match} |`,
        );
        return { noEvidence: true, data: { address, match } };
      })
      .catch(e => console.log(`  ${e instanceof Error ? e.message : String(e)}; rerun after fixing`));
  }
  await ledger.flush(true);
  if (failures > 0) {
    console.log(`${failures} contract(s) not verified.`);
    process.exitCode = 1;
  } else {
    console.log("All three contracts are verified on Sourcify and listed in docs/EVIDENCE.md.");
  }
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
