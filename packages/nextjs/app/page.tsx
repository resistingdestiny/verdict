"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { NextPage } from "next";
import type { Hex } from "viem";
import { EmptyState } from "~~/components/EmptyState";
import { LoadingState } from "~~/components/LoadingState";
import { MarketCard } from "~~/components/MarketCard";
import { RetryState } from "~~/components/RetryState";
import { useFeeds, useVerdictMarkets } from "~~/hooks/verdict";
import { aggregatorFromFeedId, knownFeedLabel } from "~~/lib/feeds";
import { shortHex } from "~~/lib/format";
import { type Filter, marketPhase, matchesFilter, nowSeconds } from "~~/lib/verdict";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "settled", label: "Settled" },
  { key: "void", label: "Void" },
];

const PHASE_ORDER = { open: 0, awaiting: 1, settled: 2, void: 3 } as const;

/** Every market, newest expiry first within each phase, with filters for open, settled and void. */
const Home: NextPage = () => {
  const { markets, status, error, refetch, routerDeployed } = useVerdictMarkets();
  const [filter, setFilter] = useState<Filter>("all");
  const [now, setNow] = useState(nowSeconds());

  useEffect(() => {
    const timer = setInterval(() => setNow(nowSeconds()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const feedIds = useMemo(
    () => Array.from(new Set(markets.map(market => market.feedId.toLowerCase()))) as Hex[],
    [markets],
  );
  const { feeds } = useFeeds(feedIds);
  const labelFor = (feedId: Hex) =>
    feeds.find(feed => feed.feedId.toLowerCase() === feedId.toLowerCase())?.label ??
    knownFeedLabel(feedId) ??
    shortHex(aggregatorFromFeedId(feedId));

  const sorted = useMemo(
    () =>
      [...markets].sort((a, b) => {
        const phaseDelta = PHASE_ORDER[marketPhase(a, now)] - PHASE_ORDER[marketPhase(b, now)];
        if (phaseDelta !== 0) return phaseDelta;
        return marketPhase(a, now) === "open" ? Number(a.expiry - b.expiry) : Number(b.expiry - a.expiry);
      }),
    [markets, now],
  );
  const shown = sorted.filter(market => matchesFilter(marketPhase(market, now), filter));
  const countFor = (key: Filter) => markets.filter(market => matchesFilter(marketPhase(market, now), key)).length;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-3xl font-bold">Markets</h1>
          <p className="mt-2 mb-0 max-w-2xl text-sm text-base-content/70">
            A question about a price becomes two HTS tokens whose payouts add up to 1 HBAR. A SaucerSwap pool prices
            them, a Chainlink feed settles them, and the Hedera Schedule Service resolves each market with no keeper.
          </p>
        </div>
        <Link href="/create" className="btn btn-primary btn-sm">
          Create a market
        </Link>
      </div>

      <div role="tablist" className="tabs tabs-box mt-6 w-fit tabs-sm">
        {FILTERS.map(entry => (
          <button
            key={entry.key}
            role="tab"
            type="button"
            className={`tab ${filter === entry.key ? "tab-active" : ""}`}
            onClick={() => setFilter(entry.key)}
          >
            {entry.label}
            {status === "ready" ? <span className="ml-1 text-xs opacity-60">{countFor(entry.key)}</span> : null}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {status === "absent" ? (
          <EmptyState
            title="Verdict is not deployed on this network"
            body={
              <>
                Deploy the contracts with{" "}
                <code className="rounded bg-base-200 px-1">yarn hardhat:deploy --network hederaTestnet</code> and the
                markets appear here.
              </>
            }
          />
        ) : status === "loading" ? (
          <LoadingState label="Reading markets from the ledger" />
        ) : status === "error" ? (
          <RetryState title="Could not read the markets" error={error} onRetry={refetch} />
        ) : shown.length === 0 ? (
          <EmptyState
            title={markets.length === 0 ? "No markets yet" : `No ${filter} markets`}
            body={markets.length === 0 ? "Be the first to ask a question about a price." : undefined}
            action={
              markets.length === 0 ? (
                <Link href="/create" className="btn btn-primary btn-sm">
                  Create a market
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {shown.map(market => (
              <MarketCard
                key={market.id.toString()}
                market={market}
                feedLabel={labelFor(market.feedId)}
                now={now}
                hasRouter={routerDeployed}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Home;
