import { useDeployedContractInfo, useScaffoldReadContract } from "~~/hooks/scaffold-hbar";
import { isZeroAddress } from "~~/lib/hts";
import { type Kind, isKind } from "~~/lib/kinds";
import { type Market, type MarketView } from "~~/lib/verdict";

/** How a single market read stands. "missing" means the contract answered that no such market exists. */
export type MarketLoadStatus = "absent" | "loading" | "missing" | "error" | "ready";

/** One market with its pool state from the router: pair address, reserves and implied probability. */
export function useVerdictMarket(id: bigint | undefined) {
  const { data: verdict, isLoading: verdictLoading } = useDeployedContractInfo({ contractName: "Verdict" });
  const { data: router, isLoading: routerLoading } = useDeployedContractInfo({ contractName: "VerdictRouter" });

  // One retry only, so a NoSuchMarket revert reaches the "missing" state quickly.
  const read = useScaffoldReadContract({
    contractName: "Verdict",
    functionName: "getMarket",
    args: [id],
    query: { retry: 1 },
  });
  const pair = useScaffoldReadContract({ contractName: "VerdictRouter", functionName: "pairOf", args: [id] });
  const reserves = useScaffoldReadContract({ contractName: "VerdictRouter", functionName: "reserves", args: [id] });
  const probability = useScaffoldReadContract({
    contractName: "VerdictRouter",
    functionName: "impliedProbability",
    args: [id],
  });

  const raw = read.data as Market | undefined;
  const exists = raw !== undefined && !isZeroAddress(raw.creator) && isKind(raw.kind);

  let status: MarketLoadStatus;
  if (id === undefined) status = "missing";
  else if (!verdict) status = verdictLoading ? "loading" : "absent";
  else if (read.isError) status = /NoSuchMarket/.test(String(read.error?.message ?? "")) ? "missing" : "error";
  else if (raw === undefined) status = "loading";
  else if (!exists) status = "missing";
  else status = "ready";

  const market: MarketView | undefined =
    exists && id !== undefined
      ? { ...raw, id, kind: raw.kind as Kind, probability: probability.data ? BigInt(probability.data) : 0n }
      : undefined;

  const [yesReserve, hbarReserve] = (reserves.data as readonly [bigint, bigint] | undefined) ?? [0n, 0n];
  const pairAddress = pair.data as `0x${string}` | undefined;
  const hasPool = Boolean(pairAddress && !isZeroAddress(pairAddress));

  const refetch = async () => {
    await Promise.all([read.refetch(), pair.refetch(), reserves.refetch(), probability.refetch()]);
  };

  return {
    market,
    status,
    error: read.error ?? null,
    routerDeployed: Boolean(router),
    routerLoading,
    pair: hasPool ? pairAddress : undefined,
    hasPool,
    yesReserve,
    hbarReserve,
    refetch,
  };
}
