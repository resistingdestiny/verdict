// Validates template.json against the shape create-scaffold-hbar reads: capabilities, defaults and outro.
// The CLI strips the file from scaffolded projects, so this check runs in CI on the repository itself.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL(".", import.meta.url).pathname, "..");
const manifest = JSON.parse(readFileSync(resolve(root, "template.json"), "utf8"));
const config = manifest["create-scaffold-hbar"];
const problems = [];

if (!config) problems.push("missing create-scaffold-hbar key");
const capabilities = config?.capabilities ?? {};
for (const key of ["frontend", "solidityFramework", "packageManager"]) {
  if (!Array.isArray(capabilities[key]) || capabilities[key].length === 0) problems.push(`capabilities.${key} must be a non-empty array`);
}
const defaults = config?.defaults ?? {};
for (const key of ["frontend", "solidityFramework"]) {
  if (!capabilities[key]?.includes(defaults[key])) problems.push(`defaults.${key} (${defaults[key]}) is not in capabilities.${key}`);
}
if (!capabilities.solidityFramework?.every(f => f === "hardhat")) problems.push("only hardhat is present in packages/");
for (const section of config?.outro?.sections ?? []) {
  for (const step of section.steps ?? []) {
    if (!step.command && !step.url && !step.text) problems.push(`outro step without command, url or text: ${JSON.stringify(step)}`);
  }
}

if (problems.length > 0) {
  console.error(`template.json problems:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("template.json is valid.");
