import { formatUnits } from "viem";
import { RESOLVER_ABI, getDeployedContract, verdictPublicClient } from "~~/app/api/_lib/verdict";
import { evmToContractId, evmToHederaId } from "~~/lib/mirror";
import { isoDate, kindName, questionText } from "~~/lib/question";
import verdictConfig from "~~/verdict.config";

/**
 * Shared builder for the JSON market shape served by /api/markets and
 * /api/markets/[id]. Everything comes from contract views through the testnet
 * RPC, plus mirror node lookups for the 0.0.x ids.
 */

export const STATUS_NAMES = ["Open", "Settled", "Void"] as const;

export type RawMarket = {
  creator: string;
  resolver: string;
  feedId: `0x${string}`;
  kind: number;
  status: number;
  decimals: number;
  expiry: bigint;
  createdAt: bigint;
  lower: bigint;
  upper: bigint;
  yes: string;
  no: string;
  schedule: string;
  collateral: bigint;
  reserve: bigint;
  payout: bigint;
  answer: bigint;
  roundId: bigint;
  updatedAt: bigint;
  settledBySchedule: boolean;
};

export type MarketJson = {
  id: number;
  question: string;
  feed: string | null;
  feedId: `0x${string}`;
  kind: string;
  status: string;
  decimals: number;
  lower: string;
  upper: string | null;
  expiry: string;
  createdAt: string;
  yes: { evm: string; id: string | null };
  no: { evm: string; id: string | null };
  schedule: { evm: string; id: string | null } | null;
  pair: { evm: string; id: string | null } | null;
  odds: { impliedProbability: string; percent: string } | null;
  reserves: { yes: string; hbar: string } | null;
  collateralHbar: string;
  settlement: {
    yesPayout: string;
    answer: string | null;
    roundId: string | null;
    updatedAt: string | null;
    bySchedule: boolean;
  } | null;
  links: {
    contract: string;
    yes: string;
    no: string;
    schedule: string | null;
    pair: string | null;
    market: string;
  };
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Trim trailing zeros from a decimal string, keeping at least the integer part. */
export function trimDecimal(text: string): string {
  if (!text.includes(".")) return text;
  const trimmed = text.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "" || trimmed === "-" ? "0" : trimmed;
}

export function tinybarsToHbar(tinybars: bigint): string {
  return trimDecimal(formatUnits(tinybars, 8));
}

function memoize<K, V>(fn: (key: K) => Promise<V>): (key: K) => Promise<V> {
  const cache = new Map<K, Promise<V>>();
  return key => {
    let hit = cache.get(key);
    if (!hit) {
      hit = fn(key);
      cache.set(key, hit);
    }
    return hit;
  };
}

const hederaId = memoize((evm: string) => evmToHederaId(evm, { baseUrl: verdictConfig.mirrorNodeUrl }));
const feedName = memoize(async (key: string): Promise<string | null> => {
  const [resolver, feedId] = key.split(":");
  try {
    return await verdictPublicClient.readContract({
      address: resolver as `0x${string}`,
      abi: RESOLVER_ABI,
      functionName: "describe",
      args: [feedId as `0x${string}`],
    });
  } catch {
    // A resolver that cannot be reached must not break the API; the feed name becomes null.
    return null;
  }
});

export async function readMarketCount(): Promise<bigint | null> {
  const contract = getDeployedContract("Verdict");
  if (!contract) return null;
  const count = await verdictPublicClient.readContract({
    address: contract.address,
    abi: contract.abi,
    functionName: "marketCount",
  });
  return count as unknown as bigint;
}

export async function readMarketRaw(id: bigint): Promise<RawMarket | null> {
  const contract = getDeployedContract("Verdict");
  if (!contract) return null;
  try {
    const market = await verdictPublicClient.readContract({
      address: contract.address,
      abi: contract.abi,
      functionName: "getMarket",
      args: [id],
    });
    return market as unknown as RawMarket;
  } catch {
    // getMarket reverts with NoSuchMarket for ids that do not exist.
    return null;
  }
}

async function routerView<T>(functionName: string, id: bigint): Promise<T | null> {
  const router = getDeployedContract("VerdictRouter");
  if (!router) return null;
  try {
    const value = await verdictPublicClient.readContract({
      address: router.address,
      abi: router.abi,
      functionName,
      args: [id],
    });
    return value as unknown as T;
  } catch {
    // No pool or a reverting view means no odds and no reserves.
    return null;
  }
}

export async function marketToJson(id: bigint, raw: RawMarket): Promise<MarketJson> {
  const contract = getDeployedContract("Verdict");
  const hashScan = verdictConfig.hashScanUrl;

  const [feed, yesId, noId, scheduleId, probability, reserves, pair] = await Promise.all([
    feedName(`${raw.resolver}:${raw.feedId}`),
    hederaId(raw.yes),
    hederaId(raw.no),
    raw.schedule.toLowerCase() === ZERO_ADDRESS ? Promise.resolve(null) : hederaId(raw.schedule),
    routerView<bigint>("impliedProbability", id),
    routerView<readonly [bigint, bigint] | { yesReserve: bigint; hbarReserve: bigint }>("reserves", id),
    routerView<string>("pairOf", id),
  ]);

  const contractId = contract
    ? await evmToContractId(contract.address, { baseUrl: verdictConfig.mirrorNodeUrl })
    : null;
  const hasPair = pair && pair.toLowerCase() !== ZERO_ADDRESS;
  const pairId = hasPair ? await hederaId(pair) : null;

  const yesReserve = reserves ? (Array.isArray(reserves) ? reserves[0] : reserves.yesReserve) : null;
  const hbarReserve = reserves ? (Array.isArray(reserves) ? reserves[1] : reserves.hbarReserve) : null;
  const usesUpper = raw.kind === 2 || raw.kind === 3;
  const settled = raw.status === 1 || raw.status === 2;

  return {
    id: Number(id),
    question: questionText({
      feed,
      kind: raw.kind,
      lower: raw.lower,
      upper: raw.upper,
      decimals: raw.decimals,
      expiry: raw.expiry,
    }),
    feed,
    feedId: raw.feedId,
    kind: kindName(raw.kind),
    status: STATUS_NAMES[raw.status] ?? `Unknown(${raw.status})`,
    decimals: raw.decimals,
    lower: formatUnits(raw.lower, raw.decimals),
    upper: usesUpper ? formatUnits(raw.upper, raw.decimals) : null,
    expiry: isoDate(raw.expiry),
    createdAt: isoDate(raw.createdAt),
    yes: { evm: raw.yes, id: yesId },
    no: { evm: raw.no, id: noId },
    schedule: raw.schedule.toLowerCase() === ZERO_ADDRESS ? null : { evm: raw.schedule, id: scheduleId },
    pair: hasPair ? { evm: pair, id: pairId } : null,
    odds:
      probability !== null && probability !== undefined
        ? {
            impliedProbability: trimDecimal(formatUnits(probability, 8)),
            percent: trimDecimal((Number(probability) / 1e6).toFixed(4)),
          }
        : null,
    reserves:
      yesReserve !== null && yesReserve !== undefined && hbarReserve !== null && hbarReserve !== undefined
        ? { yes: trimDecimal(formatUnits(yesReserve, 8)), hbar: tinybarsToHbar(hbarReserve) }
        : null,
    collateralHbar: tinybarsToHbar(raw.collateral),
    settlement: settled
      ? {
          yesPayout: trimDecimal(formatUnits(raw.payout, 8)),
          answer: raw.status === 2 ? null : formatUnits(raw.answer, raw.decimals),
          roundId: raw.status === 2 ? null : raw.roundId.toString(),
          updatedAt: raw.status === 2 ? null : isoDate(raw.updatedAt),
          bySchedule: raw.settledBySchedule,
        }
      : null,
    links: {
      contract: contractId ? `${hashScan}/contract/${contractId}` : `${hashScan}/contract/${contract?.address ?? ""}`,
      yes: `${hashScan}/token/${yesId ?? raw.yes}`,
      no: `${hashScan}/token/${noId ?? raw.no}`,
      schedule: scheduleId ? `${hashScan}/schedule/${scheduleId}` : null,
      pair: hasPair ? `${hashScan}/contract/${pairId ?? pair}` : null,
      market: `/market/${Number(id)}`,
    },
  };
}
