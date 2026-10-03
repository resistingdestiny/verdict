import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

/**
 * Creates the HCS record topic after the contracts deploy. The Hiero SDK lives
 * in the nextjs package, so the actual work runs in packages/nextjs/scripts/
 * create-topic.mjs, which also writes the topic id into verdict.config.ts.
 * Skips on any network other than Hedera testnet, when the operator env is
 * missing, or when a topic is already configured.
 */
const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  if (hre.network.name !== "hederaTestnet") {
    console.log(`03_create_hcs_topic: skipping on ${hre.network.name}; the record topic is a testnet resource.`);
    return;
  }
  if (!process.env.HEDERA_OPERATOR_ID || !process.env.HEDERA_OPERATOR_KEY) {
    console.log("03_create_hcs_topic: HEDERA_OPERATOR_ID or HEDERA_OPERATOR_KEY not set; skipping topic creation.");
    return;
  }

  const nextjsDir = path.join(__dirname, "..", "..", "nextjs");
  const config = fs.readFileSync(path.join(nextjsDir, "verdict.config.ts"), "utf8");
  if (/hcsTopicId:\s*"0\.0\.\d+"/.test(config)) {
    console.log("03_create_hcs_topic: a topic is already configured in verdict.config.ts; skipping.");
    return;
  }

  const result = spawnSync("node", ["scripts/create-topic.mjs"], {
    cwd: nextjsDir,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error("03_create_hcs_topic: create-topic.mjs failed.");
  }
};
func.tags = ["HcsTopic"];

export default func;
