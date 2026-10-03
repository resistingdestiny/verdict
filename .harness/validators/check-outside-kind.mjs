// Deterministic checks for the Outside market kind, run by the harness (see yarn.json) and by hand.
// 1. The Kind enum in IVerdict.sol contains Outside, appended after Scalar.
// 2. Verdict.sol names Kind.Outside at least twice: the bounds check in createMarket and the payoff branch.
// 3. The test helper's Kind mirror, the frontend lib, the question text, the record builders, the scripts
//    and the README all name Outside (the kind list is duplicated in each of them).
// 4. test/Verdict.test.ts contains an Outside payoff table.
// 5. The contract test file passes (skipped with --skip-tests).
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

const verdict = readFileSync(resolve(root, "packages/hardhat/contracts/Verdict.sol"), "utf8");
const outsideUses = verdict.match(/Kind\.Outside/g) ?? [];
if (outsideUses.length < 2)
  fail("Verdict.sol must name Kind.Outside in both the createMarket bounds check and the payoff function");

const duplicates = [
  "packages/hardhat/test/helpers/verdict.ts",
  "packages/nextjs/lib/payoff.ts",
  "packages/nextjs/lib/question.ts",
  "packages/nextjs/app/api/_lib/messages.ts",
  "packages/nextjs/app/llms.txt/route.ts",
  "packages/hardhat/scripts/lib/testnetMarket.ts",
  "packages/hardhat/scripts/record-sync.ts",
  "README.md",
];
for (const file of duplicates) {
  if (!readFileSync(resolve(root, file), "utf8").includes("Outside")) fail(`${file} does not name Outside`);
}

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

console.log("check-outside-kind: Outside is in the enum, the contract, every duplicated kind list and the payoff table, and the tests pass.");
