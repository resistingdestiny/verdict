/**
 * Shared helpers for the hand-run router scripts: argv parsing and HashScan links.
 * The scripts run on Hedera testnet only, through the package scripts (`yarn hardhat:create-market`,
 * `yarn hardhat:seed-pool`, `yarn hardhat:trade`). Every flag can also be given as an upper-case environment
 * variable (`FEED=HBAR/USD KIND=Above ...`), which works the same under Yarn and npm.
 */

/** Parses `--flag value` pairs from process.argv (everything after the script name). */
export function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag.startsWith("--")) continue;
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    args[flag.slice(2)] = value;
    i++;
  }
  return args;
}

/** Returns `args[name]` or throws naming every required flag. */
export function requireArgs(args: Record<string, string>, names: string[]): void {
  for (const name of names) {
    const fromEnv = process.env[name.toUpperCase().replace(/-/g, "_")];
    if (!(name in args) && fromEnv) args[name] = fromEnv;
  }
  const missing = names.filter(name => !(name in args));
  if (missing.length > 0) throw new Error(`Missing required flags: ${missing.map(name => `--${name}`).join(" ")}`);
}

export function hashscanTx(txHash: string): string {
  return `https://hashscan.io/testnet/transaction/${txHash}`;
}

export function hashscanContract(address: string): string {
  return `https://hashscan.io/testnet/contract/${address}`;
}

export function hashscanToken(address: string): string {
  return `https://hashscan.io/testnet/token/${address}`;
}

/** Weibars per tinybar: the JSON-RPC relay speaks 18 decimals, the EVM speaks 8. */
export const WEIBARS_PER_TINYBAR = 10n ** 10n;
