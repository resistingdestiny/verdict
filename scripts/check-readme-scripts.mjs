// Checks that every `yarn <script>` or `npm run <script>` the README names exists in a package.json.
// Run by CI so the docs never drift from the scripts.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL(".", import.meta.url).pathname, "..");
const readme = readFileSync(resolve(root, "README.md"), "utf8");
const agents = readFileSync(resolve(root, "AGENTS.md"), "utf8");

const scripts = new Set();
for (const pkg of ["package.json", "packages/hardhat/package.json", "packages/nextjs/package.json"]) {
  const json = JSON.parse(readFileSync(resolve(root, pkg), "utf8"));
  for (const name of Object.keys(json.scripts ?? {})) scripts.add(name);
}

const pattern = /\b(?:yarn|npm run)\s+([a-z][a-z0-9:-]*)/g;
const missing = new Set();
for (const text of [readme, agents]) {
  for (const match of text.matchAll(pattern)) {
    const name = match[1];
    // yarn's own subcommands and workspace invocations are not package scripts
    if (["install", "workspace", "workspaces", "dlx", "run", "add", "remove", "create"].includes(name)) continue;
    if (!scripts.has(name)) missing.add(name);
  }
}

if (missing.size > 0) {
  console.error(`Scripts named in the docs but missing from package.json: ${[...missing].join(", ")}`);
  process.exit(1);
}
console.log(`All ${scripts.size} documented scripts exist.`);
