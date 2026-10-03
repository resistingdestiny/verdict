// Deterministic checks for the Outside market kind, run by the harness (see yarn.json) and by hand.
// 1. The Kind enum in IVerdict.sol contains Outside, appended after Scalar.
// 2. test/Verdict.test.ts contains an Outside payoff table.
// 3. The contract test file passes (skipped with --skip-tests).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(new URL(".", import.meta.url).pathname, "../..");

const fail = (message) => {
  console.error(`check-outside-kind: ${message}`);
  process.exit(1);
};

const iface = readFileSync(resolve(root, "packages/hardhat/contracts/interfaces/IVerdict.sol"), "utf8");
const enumMatch = iface.match(/enum\s+Kind\s*\{([^}]*)\}/s);
if (!enumMatch) fail("no Kind enum found in IVerdict.sol");
const entries = enumMatch[1].split(",").map((entry) => entry.replace(/\/\/.*$/, "").trim());
if (!entries.includes("Outside")) fail("Outside is missing from the Kind enum");
if (entries.indexOf("Outside") !== entries.length - 1)
  fail("Outside must be appended after the existing kinds; enum order is storage layout");

const testFile = readFileSync(resolve(root, "packages/hardhat/test/Verdict.test.ts"), "utf8");
if (!testFile.includes("Outside")) fail("no Outside case found in test/Verdict.test.ts");
if (!/Outside[\s\S]{0,2000}payoutFor|payoutFor[\s\S]{0,2000}Outside/.test(testFile))
  fail("no Outside payoff table driven through payoutFor found in test/Verdict.test.ts");

if (!process.argv.includes("--skip-tests")) {
  const run = spawnSync("yarn", ["hardhat:test", "test/Verdict.test.ts"], {
    cwd: root,
    stdio: "inherit",
  });
  if (run.status !== 0) fail("yarn hardhat:test test/Verdict.test.ts did not pass");
}

console.log("check-outside-kind: Outside is in the enum, the payoff table exists and the tests pass.");
