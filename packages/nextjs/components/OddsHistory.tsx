"use client";

import { EmptyState } from "./EmptyState";
import { LoadingState } from "./LoadingState";
import { RetryState } from "./RetryState";
import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { useScaffoldReadContract, useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { formatPercent, formatUtc } from "~~/lib/format";
import { mirrorNodeBase } from "~~/lib/hts";
import { fetchSyncHistory, yesIsToken0 } from "~~/lib/odds";

type OddsHistoryProps = {
  pair: Address | undefined;
  yes: Address;
};

const WIDTH = 360;
const HEIGHT = 160;
const PAD = { left: 36, right: 10, top: 10, bottom: 26 };

/**
 * The implied YES probability over time, from the pool's `Sync` events read through the mirror node.
 * Reserves only change on a swap or a liquidity event, so the line is a step chart.
 */
export const OddsHistory = ({ pair, yes }: OddsHistoryProps) => {
  const { targetNetwork } = useTargetNetwork();
  const whbar = useScaffoldReadContract({ contractName: "SaucerSwapRouter", functionName: "whbar", watch: false });
  const yesFirst = whbar.data ? yesIsToken0(yes, whbar.data as Address) : undefined;

  const history = useQuery({
    queryKey: ["verdict", "sync-history", targetNetwork.id, pair, yesFirst],
    enabled: Boolean(pair) && yesFirst !== undefined,
    refetchInterval: 30_000,
    retry: 1,
    queryFn: () => fetchSyncHistory(mirrorNodeBase(targetNetwork.id), pair as Address, yesFirst as boolean),
  });

  if (!pair) return <EmptyState title="No pool yet" body="The odds history starts with the first liquidity." />;
  if (whbar.isError)
    return (
      <RetryState title="Could not read the SaucerSwap router" error={whbar.error} onRetry={() => whbar.refetch()} />
    );
  if (history.isError)
    return (
      <RetryState title="Could not read the pool history" error={history.error} onRetry={() => history.refetch()} />
    );
  if (!history.data) return <LoadingState label="Reading Sync events from the mirror node" />;
  if (history.data.length === 0)
    return <EmptyState title="No trades yet" body="The pool has not emitted a Sync event." />;

  const points = history.data;
  const start = points[0].time;
  const end = Math.max(points[points.length - 1].time, Math.floor(Date.now() / 1000));
  const span = Math.max(end - start, 1);
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const x = (time: number) => PAD.left + ((time - start) / span) * plotWidth;
  const y = (probability: bigint) => PAD.top + plotHeight - (Number(probability) / 1e8) * plotHeight;
  const bottom = PAD.top + plotHeight;
  let path = "";
  points.forEach((point, i) => {
    const px = x(point.time).toFixed(1);
    const py = y(point.probability).toFixed(1);
    if (i === 0) path += `M${px},${py}`;
    else path += ` L${px},${y(points[i - 1].probability).toFixed(1)} L${px},${py}`;
  });
  path += ` L${x(end).toFixed(1)},${y(points[points.length - 1].probability).toFixed(1)}`;
  const last = points[points.length - 1];

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-auto"
        role="img"
        aria-label="Implied YES probability over time"
      >
        {[0n, 50_000_000n, 100_000_000n].map(level => (
          <g key={level.toString()}>
            <line
              x1={PAD.left}
              y1={y(level)}
              x2={WIDTH - PAD.right}
              y2={y(level)}
              className="stroke-base-content/20"
              strokeWidth={1}
            />
            <text x={PAD.left - 4} y={y(level) + 3} textAnchor="end" className="fill-base-content/60" fontSize={10}>
              {formatPercent(level, 0)}
            </text>
          </g>
        ))}
        <text x={PAD.left} y={bottom + 16} textAnchor="start" className="fill-base-content/60" fontSize={10}>
          {formatUtc(start)}
        </text>
        <text x={WIDTH - PAD.right} y={bottom + 16} textAnchor="end" className="fill-base-content/60" fontSize={10}>
          now
        </text>
        <path d={path} fill="none" className="stroke-primary" strokeWidth={2} />
        <circle cx={x(end)} cy={y(last.probability)} r={3} className="fill-primary" />
      </svg>
      <figcaption className="mt-1 text-xs text-base-content/70">
        {points.length} pool updates, last at {formatUtc(last.time)}: YES {formatPercent(last.probability)}
      </figcaption>
    </figure>
  );
};
