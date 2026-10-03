import Link from "next/link";
import { KindBadge } from "./KindBadge";
import { OddsBar } from "./OddsBar";
import { StatusBadge } from "./StatusBadge";
import { formatTimeToExpiry, formatUtc } from "~~/lib/format";
import { questionText } from "~~/lib/payoff";
import { type MarketView, marketPhase } from "~~/lib/verdict";

type MarketCardProps = {
  market: MarketView;
  feedLabel: string;
  now: number;
  hasRouter: boolean;
};

/** One market in the list: question, kind, status, odds and time to expiry. */
export const MarketCard = ({ market, feedLabel, now, hasRouter }: MarketCardProps) => {
  const phase = marketPhase(market, now);
  const question = questionText({
    feed: feedLabel,
    kind: market.kind,
    lower: market.lower,
    upper: market.upper,
    decimals: market.decimals,
    expiry: market.expiry,
  });
  return (
    <Link
      href={`/market/${market.id.toString()}`}
      className="block rounded-box border border-base-300 bg-base-100 p-5 transition-colors hover:border-primary"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-base-content/60">#{market.id.toString()}</span>
        <KindBadge kind={market.kind} />
        <StatusBadge phase={phase} />
        <span className="ml-auto text-xs text-base-content/60" title={formatUtc(market.expiry)}>
          {phase === "open"
            ? `Expires ${formatTimeToExpiry(market.expiry, now)}`
            : `Expired ${formatTimeToExpiry(market.expiry, now)}`}
        </span>
      </div>
      <p className="my-3 font-semibold leading-snug">{question}</p>
      <OddsBar probability={market.probability} hasPool={hasRouter && market.probability > 0n} compact />
    </Link>
  );
};
