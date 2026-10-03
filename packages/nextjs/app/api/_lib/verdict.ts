import { type Abi, type Address, createPublicClient, http } from "viem";
import { hederaTestnet } from "viem/chains";
import deployedContracts from "~~/contracts/deployedContracts";
import scaffoldConfig from "~~/scaffold.config";

/**
 * Server-side access to the Verdict deployment on Hedera testnet (chain 296).
 * The Verdict and VerdictRouter entries appear in deployedContracts.ts once the
 * reference deployment lands; until then every getter returns null and the API
 * routes answer with a clear error object instead of crashing.
 */

export const VERDICT_CHAIN_ID = 296;

export type DeployedContract = { address: Address; abi: Abi };

type ContractsFile = Record<number, Record<string, { address: Address; abi: Abi }> | undefined>;

const byChain = deployedContracts as unknown as ContractsFile;

export function getDeployedContract(name: "Verdict" | "VerdictRouter"): DeployedContract | null {
  const entry = byChain[VERDICT_CHAIN_ID]?.[name];
  return entry ? { address: entry.address, abi: entry.abi } : null;
}

export const verdictPublicClient = createPublicClient({
  chain: hederaTestnet,
  transport: http(scaffoldConfig.rpcOverrides?.[hederaTestnet.id]),
});

/** Minimal IResolver slice used to resolve a feed id to its human-readable name. */
export const RESOLVER_ABI = [
  {
    type: "function",
    name: "describe",
    inputs: [{ name: "feedId", type: "bytes32", internalType: "bytes32" }],
    outputs: [{ name: "", type: "string", internalType: "string" }],
    stateMutability: "view",
  },
] as const;
