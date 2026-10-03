import { type Address, erc20Abi } from "viem";

/**
 * HTS helpers for the app side: the token facade ABI, long-zero address to entity id conversion,
 * HashScan URLs and the mirror node association check.
 */

/** HTS success response code. */
export const HTS_SUCCESS = 22n;

/**
 * Every HTS token exposes an ERC-20 facade at its address (HIP-218) plus `associate()` for the caller (HIP-719).
 * A wallet cannot call the system contract's `associateToken` on its own behalf from the EVM, so the facade is
 * the one-click association path.
 */
export const htsTokenAbi = [
  ...erc20Abi,
  {
    type: "function",
    name: "associate",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "responseCode", type: "uint256" }],
  },
] as const;

export const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

export const isZeroAddress = (address: string | undefined): boolean =>
  !address || address.toLowerCase() === ZERO_ADDRESS;

/** True for an address whose first 12 bytes are zero, which is how Hedera entities appear in the EVM. */
export function isLongZero(address: string): boolean {
  return /^0x0{24}[0-9a-fA-F]{16}$/.test(address);
}

/** "0.0.N" for a long-zero address, or null for a regular EVM address. */
export function longZeroToEntityId(address: string): string | null {
  if (!isLongZero(address)) return null;
  return `0.0.${BigInt(`0x${address.slice(-16)}`).toString()}`;
}

export type HederaNetworkName = "testnet" | "mainnet";

export function networkName(chainId: number | undefined): HederaNetworkName {
  return chainId === 295 ? "mainnet" : "testnet";
}

export type HashScanKind = "account" | "contract" | "token" | "schedule" | "tx" | "topic";

/** A HashScan URL. Entities are linked by 0.0.N when the address is long-zero, otherwise by EVM address. */
export function hashscanUrl(network: HederaNetworkName, kind: HashScanKind, value: string): string {
  const base = `https://hashscan.io/${network}`;
  const entity = longZeroToEntityId(value) ?? value;
  switch (kind) {
    case "tx":
      return `${base}/transaction/${value}`;
    case "token":
      return `${base}/token/${entity}`;
    case "schedule":
      return `${base}/schedule/${entity}`;
    case "topic":
      return `${base}/topic/${entity}`;
    case "contract":
      return `${base}/contract/${entity}`;
    case "account":
      return `${base}/account/${entity}`;
  }
}

/** Mirror node base URL for a chain. `NEXT_PUBLIC_MIRROR_NODE_URL` overrides the public one. */
export function mirrorNodeBase(chainId: number | undefined): string {
  const override = process.env.NEXT_PUBLIC_MIRROR_NODE_URL;
  if (override) return override.replace(/\/$/, "");
  return `https://${networkName(chainId)}.mirrornode.hedera.com`;
}

type MirrorTokensPage = { tokens?: { token_id: string }[] };

/**
 * Whether `account` is associated with `token`, from the mirror node. A 404 means the account has never
 * been seen by the network, so it cannot be associated either. Throws on other failures so callers can
 * fall back to a balance read.
 */
export async function isAssociatedOnMirror(mirrorBase: string, account: Address, token: Address): Promise<boolean> {
  const tokenId = longZeroToEntityId(token);
  if (!tokenId) throw new Error(`${token} is not an HTS token address`);
  const response = await fetch(`${mirrorBase}/api/v1/accounts/${account}/tokens?token.id=${tokenId}&limit=1`);
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`mirror node ${response.status} for ${account} tokens`);
  const body = (await response.json()) as MirrorTokensPage;
  return (body.tokens ?? []).some(entry => entry.token_id === tokenId);
}
