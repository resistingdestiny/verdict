import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import { useDeployedContractInfo, useScaffoldReadContract, useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { isZeroAddress } from "~~/lib/hts";
import { type Kind, isKind } from "~~/lib/payoff";
import { type Market, type MarketView } from "~~/lib/verdict";
import scaffoldConfig from "~~/scaffold.config";

/** How a chain read stands. "absent" means the contract is not in `deployedContracts.ts` or has no code. */
export type LoadStatus = "absent" | "loading" | "error" | "ready";

/**
 * Every market, from `marketCount` and `getMarket(i)`, with the router's implied probability for each.
 * Ids 0 to `marketCount` inclusive are read so the list is right whether the contract numbers markets
 * from 0 or from 1; reads that revert or return an empty market are dropped.
 */
export function useVerdictMarkets() {
  const { targetNetwork } = useTargetNetwork();
  const { data: verdict, isLoading: verdictLoading } = useDeployedContractInfo({ contractName: "Verdict" });
  const { data: router } = useDeployedContractInfo({ contractName: "VerdictRouter" });

  const count = useScaffoldReadContract({ contractName: "Verdict", functionName: "marketCount" });

  const ids = useMemo(
    () => (count.data === undefined ? [] : Array.from({ length: Number(count.data) + 1 }, (_, i) => BigInt(i))),
    [count.data],
  );

  const marketCalls = useMemo(
    () =>
      verdict
        ? ids.map(id => ({
            address: verdict.address,
            abi: verdict.abi,
            functionName: "getMarket" as const,
            args: [id] as const,
            chainId: targetNetwork.id,
          }))
        : [],
    [verdict, ids, targetNetwork.id],
  );

  const probabilityCalls = useMemo(
    () =>
      router
        ? ids.map(id => ({
            address: router.address,
            abi: router.abi,
            functionName: "impliedProbability" as const,
            args: [id] as const,
            chainId: targetNetwork.id,
          }))
        : [],
    [router, ids, targetNetwork.id],
  );

  const marketReads = useReadContracts({
    contracts: marketCalls,
    allowFailure: true,
    query: { enabled: marketCalls.length > 0, refetchInterval: scaffoldConfig.pollingInterval },
  });

  const probabilityReads = useReadContracts({
    contracts: probabilityCalls,
    allowFailure: true,
    query: { enabled: probabilityCalls.length > 0, refetchInterval: scaffoldConfig.pollingInterval },
  });

  const markets = useMemo<MarketView[]>(() => {
    if (!marketReads.data) return [];
    const list: MarketView[] = [];
    marketReads.data.forEach((entry, index) => {
      if (entry.status !== "success") return;
      const market = entry.result as Market;
      if (isZeroAddress(market.creator) || !isKind(market.kind)) return;
      const probabilityEntry = probabilityReads.data?.[index];
      const probability =
        probabilityEntry && probabilityEntry.status === "success" ? BigInt(probabilityEntry.result as bigint) : 0n;
      list.push({ ...market, id: ids[index], kind: market.kind as Kind, probability });
    });
    return list;
  }, [marketReads.data, probabilityReads.data, ids]);

  let status: LoadStatus;
  if (!verdict) status = verdictLoading ? "loading" : "absent";
  else if (count.isError || marketReads.isError) status = "error";
  else if (count.data === undefined || (ids.length > 0 && !marketReads.data)) status = "loading";
  else status = "ready";

  const refetch = async () => {
    await count.refetch();
    await marketReads.refetch();
    await probabilityReads.refetch();
  };

  return {
    markets,
    status,
    error: count.error ?? marketReads.error ?? null,
    routerDeployed: Boolean(router),
    refetch,
  };
}
