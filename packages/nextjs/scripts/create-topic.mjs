import { AccountId, Client, PrivateKey, TopicCreateTransaction } from "@hiero-ledger/sdk";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

/**
 * Creates the Verdict HCS record topic on Hedera testnet with the operator key
 * as submit key, writes the topic id into verdict.config.ts and prints the
 * HashScan link. Run with: yarn record:create-topic
 *
 * Reads HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY from the environment or
 * from .env.local next to this script's package.
 */

const packageDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function loadEnvLocal() {
  const envPath = path.join(packageDir, ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}

async function main() {
  loadEnvLocal();
  const operatorId = process.env.HEDERA_OPERATOR_ID;
  const operatorKey = process.env.HEDERA_OPERATOR_KEY;
  if (!operatorId || !operatorKey) {
    throw new Error("Set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY in .env.local or the environment.");
  }

  const configPath = path.join(packageDir, "verdict.config.ts");
  const config = fs.readFileSync(configPath, "utf8");
  const existing = config.match(/hcsTopicId:\s*"(0\.0\.\d+)"/);
  if (existing) {
    console.log(`Topic already configured: ${existing[1]}`);
    console.log(`https://hashscan.io/testnet/topic/${existing[1]}`);
    return;
  }

  const key = PrivateKey.fromString(operatorKey);
  const client = Client.forTestnet().setOperator(AccountId.fromString(operatorId), key);
  try {
    const response = await new TopicCreateTransaction()
      .setTopicMemo("Verdict market record")
      .setSubmitKey(key.publicKey)
      .execute(client);
    const receipt = await response.getReceipt(client);
    const topicId = receipt.topicId.toString();

    const updated = config.replace(/hcsTopicId:\s*(null|"0\.0\.\d+")/, `hcsTopicId: "${topicId}"`);
    if (updated === config) throw new Error("Could not find the hcsTopicId line in verdict.config.ts");
    fs.writeFileSync(configPath, updated);

    console.log(`Topic created: ${topicId}`);
    console.log(`https://hashscan.io/testnet/topic/${topicId}`);
  } finally {
    client.close();
  }
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
