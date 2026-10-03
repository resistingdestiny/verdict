"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { NextPage } from "next";
import toast from "react-hot-toast";
import { ArrowPathIcon } from "@heroicons/react/24/outline";
import { FeedMessage, fetchRecordFeed, marketsMissingSettlement, syncRecord } from "~~/lib/record";
import verdictConfig from "~~/verdict.config";

type MarketSummary = { id: number; status: string };

function field(label: string, value: string | number | null | undefined) {
  if (value === null || value === undefined) return null;
  return (
    <div className="flex justify-between gap-4 text-sm" key={label}>
      <span className="opacity-60">{label}</span>
      <span className="font-mono text-right break-all">{value}</span>
    </div>
  );
}

function MessageCard({ message }: { message: FeedMessage }) {
  const topicId = verdictConfig.hcsTopicId;
  const hashScanUrl = verdictConfig.hashScanUrl;
  const payload = message.payload;
  const when = message.consensusTimestamp.split(".")[0];
  const date = new Date(Number(when) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

  return (
    <div className="card bg-base-100 shadow-md">
      <div className="card-body p-5 gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className={`badge ${payload?.type === "market_settled" ? "badge-accent" : "badge-primary"}`}>
              {payload?.type === "market_settled" ? "Settled" : payload?.type === "market_created" ? "Created" : "Message"}
            </span>
            {payload && (
              <Link href={`/market/${payload.market}`} className="link link-hover font-semibold">
                Market {payload.market}
              </Link>
            )}
          </div>
          <span className="text-xs opacity-60">{date}</span>
        </div>

        {payload ? (
          <div className="flex flex-col gap-1 mt-1">
            {payload.type === "market_created" ? (
              <>
                {field("Feed", payload.feed as string | null)}
                {field("Kind", payload.kind as string | null)}
                {field("Lower", payload.lower as string | null)}
                {field("Upper", payload.upper as string | null)}
                {field("Expiry", payload.expiry as string | null)}
                {field("YES token", payload.yes as string | null)}
                {field("NO token", payload.no as string | null)}
                {field("Schedule", payload.schedule as string | null)}
              </>
            ) : (
              <>
                {field("YES payout", `${payload.yesPayout} HBAR`)}
                {field("Answer", payload.answer as string | null)}
                {field("Round", payload.roundId as string | null)}
                {field("Reading at", payload.updatedAt as string | null)}
                {field("Settled by", payload.settledBy as string | null)}
              </>
            )}
          </div>
        ) : (
          <pre className="text-xs bg-base-200 rounded-lg p-3 overflow-x-auto">{message.text}</pre>
        )}

        <div className="flex flex-wrap gap-3 mt-2 text-sm">
          <a href={`${hashScanUrl}/topic/${topicId}`} target="_blank" rel="noreferrer" className="link link-hover">
            Message #{message.sequenceNumber} on HashScan
          </a>
          {typeof payload?.tx === "string" && (
            <a href={`${hashScanUrl}/transaction/${payload.tx}`} target="_blank" rel="noreferrer" className="link link-hover">
              Source transaction
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

const RecordPage: NextPage = () => {
  const topicId = verdictConfig.hcsTopicId;
  const [feed, setFeed] = useState<FeedMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setFeed(await fetchRecordFeed());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (topicId) void load();
  }, [topicId, load]);

  const onSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/markets");
      const data = (await res.json()) as { markets?: MarketSummary[]; error?: string };
      if (!res.ok || !data.markets) throw new Error(data.error ?? `Markets API answered ${res.status}`);
      const current = feed ?? (await fetchRecordFeed());
      const missing = marketsMissingSettlement(data.markets, current);
      if (missing.length === 0) {
        toast.success("Record is up to date");
      } else {
        for (const id of missing) {
          const result = await syncRecord(id);
          toast.success(`Market ${id}: wrote ${result.written.length} message(s)`);
        }
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  };

  if (!topicId) {
    return (
      <div className="flex flex-col items-center grow px-5 py-16">
        <div className="card bg-base-100 shadow-md max-w-xl w-full">
          <div className="card-body items-center text-center">
            <h1 className="card-title">Market record</h1>
            <p className="opacity-70">
              The HCS record topic is not configured yet. Once the topic is created and its id is written to
              verdict.config.ts, this page shows every market&apos;s terms and settlement, newest first.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center grow px-5 py-10 w-full">
      <div className="w-full max-w-2xl flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Market record</h1>
            <p className="text-sm opacity-70">
              HCS topic{" "}
              <a
                href={`${verdictConfig.hashScanUrl}/topic/${topicId}`}
                target="_blank"
                rel="noreferrer"
                className="link link-hover font-mono"
              >
                {topicId}
              </a>{" "}
              read through the mirror node.
            </p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={onSync} disabled={syncing}>
            {syncing ? <span className="loading loading-spinner loading-xs" /> : <ArrowPathIcon className="h-4 w-4" />}
            Sync
          </button>
        </div>

        {error && (
          <div className="alert alert-error flex justify-between">
            <span>The mirror node could not be reached: {error}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => void load()}>
              Retry
            </button>
          </div>
        )}

        {!error && feed === null && (
          <div className="flex justify-center py-16">
            <span className="loading loading-spinner loading-lg" />
          </div>
        )}

        {!error && feed !== null && feed.length === 0 && (
          <div className="card bg-base-100 shadow-md">
            <div className="card-body items-center text-center">
              <p className="opacity-70">No messages on the topic yet. Create a market, then use Sync to write its terms.</p>
            </div>
          </div>
        )}

        {!error && feed?.map(m => <MessageCard key={m.sequenceNumber} message={m} />)}
      </div>
    </div>
  );
};

export default RecordPage;
