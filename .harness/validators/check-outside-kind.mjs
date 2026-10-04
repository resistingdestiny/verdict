// Deterministic checks for the Outside market kind, run by the harness (see yarn.json) and by hand.
// 1. The Kind enum in IVerdict.sol contains Outside, appended after Scalar.
// 2. Verdict.sol names Kind.Outside at least twice: the bounds check in createMarket and the payoff branch.
// 3. packages/nextjs/lib/kinds.ts (the one TypeScript definition of the kinds) and the README name Outside,
//    and no other TypeScript file outside the tests keeps its own copy of the kind names.
// 4. test/Verdict.test.ts contains an Outside payoff table.
// 5. The contract test file passes (skipped with --skip-tests).
import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(new URL(".", import.meta.url).pathname, "../..");

const fail = (message) => {
  console.error(`check-outside-kind: ${message}`);
  process.exit(1);
};

const iface = readFileSync(resolve(root, "packages/hardhat/contracts/interfaces/IVerdict.sol"), "utf8");
const enumMatch = iface.match(/enum\s+Kind\s*\{([^}]*)\}/s);
if (!enumMatch) fail("no Kind enum found in IVerdict.sol");
// Strip line comments before splitting: the Scalar comment itself contains a comma ("[0, 1]").
const entries = enumMatch[1]
  .replace(/\/\/.*$/gm, "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
if (!entries.includes("Outside")) fail("Outside is missing from the Kind enum");
if (entries.indexOf("Outside") !== entries.length - 1)
  fail("Outside must be appended after the existing kinds; enum order is storage layout");

const verdict = readFileSync(resolve(root, "packages/hardhat/contracts/Verdict.sol"), "utf8");
const outsideUses = verdict.match(/Kind\.Outside/g) ?? [];
if (outsideUses.length < 2)
  fail("Verdict.sol must name Kind.Outside in both the createMarket bounds check and the payoff function");

for (const file of ["packages/nextjs/lib/kinds.ts", "README.md"]) {
  if (!readFileSync(resolve(root, file), "utf8").includes("Outside")) fail(`${file} does not name Outside`);
}

const kindsModule = resolve(root, "packages/nextjs/lib/kinds.ts");
const sourceDirs = [
  "packages/nextjs/app",
  "packages/nextjs/components",
  "packages/nextjs/hooks",
  "packages/nextjs/lib",
  "packages/hardhat/scripts",
  "packages/hardhat/test/helpers",
];
for (const dir of sourceDirs) {
  for (const entry of readdirSync(resolve(root, dir), { recursive: true })) {
    const path = resolve(root, dir, entry);
    if (!/\.tsx?$/.test(entry) || entry.includes("__tests__") || path === kindsModule) continue;
    if (/"Between",\s*"Scalar"/.test(readFileSync(path, "utf8")))
      fail(
        `${relative(root, path)} keeps its own copy of the kind names; import them from packages/nextjs/lib/kinds.ts`,
      );
  }
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

console.log(
  "check-outside-kind: Outside is in the enum, the contract, the kinds module and the payoff table, and the tests pass.",
);
