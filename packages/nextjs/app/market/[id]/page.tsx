"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SettlementBlock } from "./_components/SettlementBlock";
import type { NextPage } from "next";
import { EmptyState } from "~~/components/EmptyState";
import { HashScanLink } from "~~/components/HashScanLink";
import { KindBadge } from "~~/components/KindBadge";
import { LoadingState } from "~~/components/LoadingState";
import { OddsBar } from "~~/components/OddsBar";
import { OddsHistory } from "~~/components/OddsHistory";
import { PayoffDiagram } from "~~/components/PayoffDiagram";
import { PositionPanel } from "~~/components/PositionPanel";
import { RetryState } from "~~/components/RetryState";
import { StatusBadge } from "~~/components/StatusBadge";
import { TradePanel } from "~~/components/TradePanel";
import { useDeployedContractInfo } from "~~/hooks/scaffold-hbar";
import { useFeeds, useLivePrice, useVerdictMarket } from "~~/hooks/verdict";
import { aggregatorFromFeedId, knownFeedLabel } from "~~/lib/feeds";
import { feedAnswerToPrice, formatTimeToExpiry, formatUtc, shortHex, tinybarsToHbar } from "~~/lib/format";
import { isZeroAddress } from "~~/lib/hts";
import { KIND_DESCRIPTIONS } from "~~/lib/kinds";
import { conditionText, questionText } from "~~/lib/payoff";
import { marketPhase, nowSeconds } from "~~/lib/verdict";

type MarketPageProps = {
  params: Promise<{ id: string }>;
};

/**
 * One market: terms, settlement once settled, odds with reserves, the trade panel, split, merge and redeem,
 * the payoff diagram, the odds history and HashScan links for every entity involved.
 */
const MarketPage: NextPage<MarketPageProps> = ({ params }) => {
  const { id: idText } = use(params);
  const id = /^\d+$/.test(idText) ? BigInt(idText) : undefined;
  const { market, status, error, refetch, pair, hasPool, yesReserve, hbarReserve, routerDeployed } =
    useVerdictMarket(id);
  const { data: verdict } = useDeployedContractInfo({ contractName: "Verdict" });
  const feedIds = useMemo(() => (market ? [market.feedId] : []), [market]);
  const { feeds } = useFeeds(feedIds);
  const live = useLivePrice(market ? aggregatorFromFeedId(market.feedId) : undefined);
  const [now, setNow] = useState(nowSeconds());

  useEffect(() => {
    const timer = setInterval(() => setNow(nowSeconds()), 15_000);
    return () => clearInterval(timer);
  }, []);

  const phase = market ? marketPhase(market, now) : undefined;
  const settled = phase === "settled" || phase === "void";

  // A scheduled resolution has no user present to post the HCS record, so the page asks the record route
  // to write any missing settlement for this market. The route is idempotent and answers 503 without
  // operator credentials, which is fine here.
  useEffect(() => {
    if (!settled || id === undefined) return;
    fetch("/api/record", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ marketId: Number(id) }),
    }).catch((reason: unknown) => console.warn("record sync skipped:", reason));
  }, [settled, id]);

  if (status === "missing") {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-8">
        <EmptyState
          title="No such market"
          body={`There is no market #${idText} on this network.`}
          action={
            <Link href="/" className="btn btn-primary btn-sm">
              Back to markets
            </Link>
          }
        />
      </div>
    );
  }
  if (status === "absent") {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-8">
        <EmptyState
          title="Verdict is not deployed on this network"
          body="Deploy the contracts and come back to this page."
        />
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-8">
        <RetryState title={`Could not read market #${idText}`} error={error} onRetry={refetch} />
      </div>
    );
  }
  if (!market || !phase) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-8">
        <LoadingState label={`Reading market #${idText}`} />
      </div>
    );
  }

  const feedLabel =
    feeds.find(feed => feed.feedId.toLowerCase() === market.feedId.toLowerCase())?.label ??
    knownFeedLabel(market.feedId) ??
    shortHex(aggregatorFromFeedId(market.feedId));
  const question = questionText({
    feed: feedLabel,
    kind: market.kind,
    lower: market.lower,
    upper: market.upper,
    decimals: market.decimals,
    expiry: market.expiry,
  });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/" className="link text-xs text-base-content/60">
          Markets
        </Link>
        <span className="text-xs text-base-content/40">/</span>
        <span className="text-xs text-base-content/60">#{market.id.toString()}</span>
        <KindBadge kind={market.kind} />
        <StatusBadge phase={phase} />
      </div>
      <h1 className="mt-3 mb-1 text-2xl font-bold leading-snug sm:text-3xl">{question}</h1>
      <p className="mt-0 text-sm text-base-content/70">
        {feedLabel} {live.answer !== undefined ? `is ${feedAnswerToPrice(live.answer, market.decimals, 4)} now` : ""}
        {" · "}
        {phase === "open"
          ? `expires ${formatTimeToExpiry(market.expiry, now)}`
          : `expired ${formatTimeToExpiry(market.expiry, now)}`}{" "}
        ({formatUtc(market.expiry)})
      </p>

      <div className="mt-6 grid gap-5 lg:grid-cols-5">
        <div className="flex flex-col gap-5 lg:col-span-3">
          <section className="rounded-box border border-base-300 bg-base-100 p-5">
            <h2 className="m-0 text-lg font-semibold">Odds</h2>
            <div className="mt-3">
              <OddsBar
                probability={market.probability}
                hasPool={hasPool}
                yesReserve={yesReserve}
                hbarReserve={hbarReserve}
                seedHref={`/create?seed=${market.id.toString()}`}
              />
            </div>
            {!routerDeployed ? (
              <p className="mt-2 mb-0 text-xs text-base-content/60">
                The router is not deployed on this network, so no odds can be read.
              </p>
            ) : null}
          </section>

          {settled ? <SettlementBlock market={market} feedLabel={feedLabel} /> : null}

          <section className="rounded-box border border-base-300 bg-base-100 p-5">
            <h2 className="m-0 text-lg font-semibold">Payoff</h2>
            <p className="mt-1 mb-3 text-sm text-base-content/70">{KIND_DESCRIPTIONS[market.kind]}</p>
            <PayoffDiagram
              kind={market.kind}
              lower={market.lower}
              upper={market.upper}
              decimals={market.decimals}
              current={settled ? market.answer : live.answer}
              feedLabel={feedLabel}
            />
          </section>

          <section className="rounded-box border border-base-300 bg-base-100 p-5">
            <h2 className="m-0 text-lg font-semibold">Odds history</h2>
            <div className="mt-3">
              <OddsHistory pair={pair} yes={market.yes} />
            </div>
          </section>

          <section className="rounded-box border border-base-300 bg-base-100 p-5">
            <h2 className="m-0 text-lg font-semibold">Terms</h2>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-base-content/60">Feed</dt>
              <dd className="m-0">
                {feedLabel} (<HashScanLink kind="contract" value={aggregatorFromFeedId(market.feedId)} />)
              </dd>
              <dt className="text-base-content/60">Condition</dt>
              <dd className="m-0">{conditionText(market.kind, market.lower, market.upper, market.decimals)}</dd>
              <dt className="text-base-content/60">Expiry</dt>
              <dd className="m-0">{formatUtc(market.expiry)}</dd>
              <dt className="text-base-content/60">Created</dt>
              <dd className="m-0">
                {formatUtc(market.createdAt)} by <HashScanLink kind="account" value={market.creator} />
              </dd>
              <dt className="text-base-content/60">Collateral</dt>
              <dd className="m-0">{tinybarsToHbar(market.collateral, 4)} HBAR backing the outstanding tokens</dd>
              <dt className="text-base-content/60">Reserve</dt>
              <dd className="m-0">{tinybarsToHbar(market.reserve, 4)} HBAR held for the scheduled resolution</dd>
              <dt className="text-base-content/60">Resolver</dt>
              <dd className="m-0">
                <HashScanLink kind="contract" value={market.resolver} />
              </dd>
            </dl>
          </section>
        </div>

        <div className="flex flex-col gap-5 lg:col-span-2">
          <TradePanel market={market} hasPool={hasPool} onTraded={refetch} />
          <PositionPanel market={market} onChanged={refetch} />
          <section className="rounded-box border border-base-300 bg-base-100 p-5">
            <h2 className="m-0 text-lg font-semibold">On HashScan</h2>
            <ul className="mt-3 m-0 list-none space-y-1.5 p-0 text-sm">
              <li>
                YES token: <HashScanLink kind="token" value={market.yes} />
              </li>
              <li>
                NO token: <HashScanLink kind="token" value={market.no} />
              </li>
              <li>
                Pool:{" "}
                {pair ? (
                  <HashScanLink kind="contract" value={pair} />
                ) : (
                  <span className="text-base-content/60">none yet</span>
                )}
              </li>
              <li>
                Schedule:{" "}
                {isZeroAddress(market.schedule) ? (
                  <span className="text-base-content/60">
                    scheduling failed at creation; resolve() still works after expiry
                  </span>
                ) : (
                  <HashScanLink kind="schedule" value={market.schedule} />
                )}
              </li>
              {verdict ? (
                <li>
                  Verdict: <HashScanLink kind="contract" value={verdict.address} />
                </li>
              ) : null}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
};

export default MarketPage;
