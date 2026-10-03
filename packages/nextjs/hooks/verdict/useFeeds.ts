import { useMemo } from "react";
import type { Address, Hex } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { useDeployedContractInfo, useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { TESTNET_FEEDS, aggregatorFromFeedId, aggregatorV3Abi, feedIdFor } from "~~/lib/feeds";
import { shortHex } from "~~/lib/format";
import scaffoldConfig from "~~/scaffold.config";

export type FeedOption = {
  feedId: Hex;
  aggregator: Address;
  label: string;
  decimals: number;
  /** True when the deployed resolver describes the feed, which is what `createMarket` needs. */
  allowed: boolean;
};

/**
 * The feeds the Create page offers. Candidates are the testnet table plus any feed id already used by an
 * existing market; each is confirmed against the deployed resolver's `describe` and `feedDecimals`.
 * Without a resolver the table is returned with `allowed` false so the page can explain why.
 */
export function useFeeds(extraFeedIds: readonly Hex[] = []) {
  const { data: resolver, isLoading: resolverLoading } = useDeployedContractInfo({
    contractName: "ChainlinkResolver",
  });
  const { targetNetwork } = useTargetNetwork();

  const candidates = useMemo(() => {
    const list = TESTNET_FEEDS.map(feed => ({ ...feed, feedId: feedIdFor(feed.aggregator) }));
    for (const feedId of extraFeedIds) {
      if (list.some(feed => feed.feedId.toLowerCase() === feedId.toLowerCase())) continue;
      const aggregator = aggregatorFromFeedId(feedId);
      list.push({ feedId, aggregator, label: shortHex(aggregator), decimals: 8 });
    }
    return list;
  }, [extraFeedIds]);

  const calls = useMemo(
    () =>
      resolver
        ? candidates.flatMap(candidate => [
            {
              address: resolver.address,
              abi: resolver.abi,
              functionName: "describe" as const,
              args: [candidate.feedId] as const,
              chainId: targetNetwork.id,
            },
            {
              address: resolver.address,
              abi: resolver.abi,
              functionName: "feedDecimals" as const,
              args: [candidate.feedId] as const,
              chainId: targetNetwork.id,
            },
          ])
        : [],
    [resolver, candidates, targetNetwork.id],
  );

  const reads = useReadContracts({ contracts: calls, allowFailure: true, query: { enabled: calls.length > 0 } });

  const feeds = useMemo<FeedOption[]>(
    () =>
      candidates.map((candidate, index) => {
        const described = reads.data?.[index * 2];
        const decimalsRead = reads.data?.[index * 2 + 1];
        const description = described?.status === "success" ? String(described.result) : "";
        const decimals = decimalsRead?.status === "success" ? Number(decimalsRead.result) : candidate.decimals;
        return {
          feedId: candidate.feedId,
          aggregator: candidate.aggregator,
          label: description.length > 0 ? description : candidate.label,
          decimals,
          allowed: description.length > 0,
        };
      }),
    [candidates, reads.data],
  );

  return {
    feeds,
    resolverAddress: resolver?.address,
    resolverDeployed: Boolean(resolver),
    isLoading: resolverLoading || (calls.length > 0 && reads.isLoading),
    error: reads.error ?? null,
  };
}

/** The latest round of a Chainlink aggregator, read directly from the feed. */
export function useLivePrice(aggregator: Address | undefined) {
  const { targetNetwork } = useTargetNetwork();
  const round = useReadContract({
    address: aggregator,
    abi: aggregatorV3Abi,
    functionName: "latestRoundData",
    chainId: targetNetwork.id,
    query: { enabled: Boolean(aggregator), refetchInterval: scaffoldConfig.pollingInterval },
  });
  const data = round.data as readonly [bigint, bigint, bigint, bigint, bigint] | undefined;
  return {
    answer: data?.[1],
    updatedAt: data ? Number(data[3]) : undefined,
    roundId: data?.[0],
    isLoading: round.isLoading,
    isError: round.isError,
    error: round.error ?? null,
    refetch: round.refetch,
  };
}
