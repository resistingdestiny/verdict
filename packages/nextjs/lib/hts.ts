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

/**
 * Whether `account` is associated with `token`, answered by the app's `/api/mirror/association` route, which
 * asks the mirror node on the server. An account the network has never seen (a fresh burner wallet) is
 * reported as not associated. Throws on other failures so callers can fall back to a balance read.
 */
export async function isAssociatedOnMirror(account: Address, token: Address): Promise<boolean> {
  const tokenId = longZeroToEntityId(token);
  if (!tokenId) throw new Error(`${token} is not an HTS token address`);
  const response = await fetch(`/api/mirror/association?account=${account}&token=${token}`);
  if (!response.ok) throw new Error(`association lookup ${response.status} for ${account}`);
  const body = (await response.json()) as { associated: boolean };
  return body.associated;
}
