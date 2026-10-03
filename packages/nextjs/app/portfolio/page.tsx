"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { NextPage } from "next";
import type { Hex } from "viem";
import { useAccount, useReadContracts } from "wagmi";
import { EmptyState } from "~~/components/EmptyState";
import { KindBadge } from "~~/components/KindBadge";
import { LoadingState } from "~~/components/LoadingState";
import { PositionPanel } from "~~/components/PositionPanel";
import { RetryState } from "~~/components/RetryState";
import { StatusBadge } from "~~/components/StatusBadge";
import { useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { useFeeds, useVerdictMarkets } from "~~/hooks/verdict";
import { aggregatorFromFeedId, knownFeedLabel } from "~~/lib/feeds";
import { PAYOUT_SCALE, shortHex, tinybarsToHbar, tokenUnitsToWhole } from "~~/lib/format";
import { htsTokenAbi } from "~~/lib/hts";
import { questionText } from "~~/lib/payoff";
import { type MarketView, marketPhase, nowSeconds } from "~~/lib/verdict";
import scaffoldConfig from "~~/scaffold.config";

type Position = {
  market: MarketView;
  yes: bigint;
  no: bigint;
  /** Tinybars at current odds, or at the settlement payout. Undefined while the market has no pool. */
  value: bigint | undefined;
};

/** The wallet's YES and NO across every market, valued at current odds, with redeem on settled markets. */
const Portfolio: NextPage = () => {
  const { address: account } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const { markets, status, error, refetch } = useVerdictMarkets();
  const [open, setOpen] = useState<string | null>(null);
  const now = nowSeconds();

  const feedIds = useMemo(
    () => Array.from(new Set(markets.map(market => market.feedId.toLowerCase()))) as Hex[],
    [markets],
  );
  const { feeds } = useFeeds(feedIds);
  const labelFor = (feedId: Hex) =>
    feeds.find(feed => feed.feedId.toLowerCase() === feedId.toLowerCase())?.label ??
    knownFeedLabel(feedId) ??
    shortHex(aggregatorFromFeedId(feedId));

  const calls = useMemo(
    () =>
      account
        ? markets.flatMap(market =>
            [market.yes, market.no].map(token => ({
              address: token,
              abi: htsTokenAbi,
              functionName: "balanceOf" as const,
              args: [account] as const,
              chainId: targetNetwork.id,
            })),
          )
        : [],
    [account, markets, targetNetwork.id],
  );
  const balances = useReadContracts({
    contracts: calls,
    allowFailure: true,
    query: { enabled: calls.length > 0, refetchInterval: scaffoldConfig.pollingInterval },
  });

  const positions = useMemo<Position[]>(() => {
    if (!balances.data) return [];
    return markets
      .map((market, index) => {
        const yesEntry = balances.data[index * 2];
        const noEntry = balances.data[index * 2 + 1];
        const yes = yesEntry?.status === "success" ? BigInt(yesEntry.result as bigint) : 0n;
        const no = noEntry?.status === "success" ? BigInt(noEntry.result as bigint) : 0n;
        const phase = marketPhase(market, now);
        let value: bigint | undefined;
        if (phase === "settled" || phase === "void") {
          value = (yes * market.payout + no * (PAYOUT_SCALE - market.payout)) / PAYOUT_SCALE;
        } else if (market.probability > 0n) {
          value = (yes * market.probability + no * (PAYOUT_SCALE - market.probability)) / PAYOUT_SCALE;
        }
        return { market, yes, no, value };
      })
      .filter(position => position.yes > 0n || position.no > 0n);
  }, [balances.data, markets, now]);

  const total = positions.reduce((sum, position) => sum + (position.value ?? 0n), 0n);
  const unpriced = positions.filter(position => position.value === undefined).length;

  const refreshAll = async () => {
    await refetch();
    await balances.refetch();
  };

  let body: React.ReactNode;
  if (!account) {
    body = <EmptyState title="No wallet connected" body="Connect a wallet to see its YES and NO across markets." />;
  } else if (status === "absent") {
    body = <EmptyState title="Verdict is not deployed on this network" />;
  } else if (status === "error") {
    body = <RetryState title="Could not read the markets" error={error} onRetry={refreshAll} />;
  } else if (balances.isError) {
    body = <RetryState title="Could not read token balances" error={balances.error} onRetry={refreshAll} />;
  } else if (status === "loading" || (calls.length > 0 && !balances.data)) {
    body = <LoadingState label="Reading balances" />;
  } else if (positions.length === 0) {
    body = (
      <EmptyState
        title="No positions"
        body="This wallet holds no YES or NO tokens."
        action={
          <Link href="/" className="btn btn-primary btn-sm">
            Browse markets
          </Link>
        }
      />
    );
  } else {
    body = (
      <div className="flex flex-col gap-4">
        <div className="rounded-box border border-base-300 bg-base-100 p-5">
          <p className="m-0 text-sm text-base-content/60">Value at current odds and settlement payouts</p>
          <p className="m-0 text-2xl font-bold">{tinybarsToHbar(total, 4)} HBAR</p>
          {unpriced > 0 ? (
            <p className="m-0 text-xs text-base-content/60">
              {unpriced} position{unpriced === 1 ? "" : "s"} in markets without a pool are not counted.
            </p>
          ) : null}
        </div>
        {positions.map(position => {
          const { market } = position;
          const phase = marketPhase(market, now);
          const key = market.id.toString();
          const settled = phase === "settled" || phase === "void";
          return (
            <div key={key} className="rounded-box border border-base-300 bg-base-100 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-base-content/60">#{key}</span>
                <KindBadge kind={market.kind} />
                <StatusBadge phase={phase} />
              </div>
              <Link href={`/market/${key}`} className="mt-2 block font-semibold leading-snug hover:underline">
                {questionText({
                  feed: labelFor(market.feedId),
                  kind: market.kind,
                  lower: market.lower,
                  upper: market.upper,
                  decimals: market.decimals,
                  expiry: market.expiry,
                })}
              </Link>
              <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <div>
                  <p className="m-0 text-xs text-base-content/60">YES</p>
                  <p className="m-0 font-medium">{tokenUnitsToWhole(position.yes, 4)}</p>
                </div>
                <div>
                  <p className="m-0 text-xs text-base-content/60">NO</p>
                  <p className="m-0 font-medium">{tokenUnitsToWhole(position.no, 4)}</p>
                </div>
                <div>
                  <p className="m-0 text-xs text-base-content/60">Value</p>
                  <p className="m-0 font-medium">
                    {position.value !== undefined ? `${tinybarsToHbar(position.value, 4)} HBAR` : "no pool"}
                  </p>
                </div>
              </div>
              {settled ? (
                <div className="mt-3">
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => setOpen(open === key ? null : key)}
                  >
                    {open === key ? "Hide redeem" : "Redeem"}
                  </button>
                  {open === key ? (
                    <div className="mt-3">
                      <PositionPanel market={market} onChanged={refreshAll} initial="redeem" />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="m-0 text-3xl font-bold">Portfolio</h1>
      <p className="mt-2 mb-6 text-sm text-base-content/70">
        Balances come from each token&apos;s ERC-20 facade. Open positions are valued at the pool&apos;s implied odds,
        settled ones at their payout.
      </p>
      {body}
    </div>
  );
};

export default Portfolio;
