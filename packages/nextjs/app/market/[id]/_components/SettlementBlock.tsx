import { HashScanLink } from "~~/components/HashScanLink";
import { PAYOUT_SCALE, feedAnswerToPrice, formatUtc, payoutToHbar } from "~~/lib/format";
import { isZeroAddress } from "~~/lib/hts";
import { type MarketView, Status } from "~~/lib/verdict";

type SettlementBlockProps = {
  market: MarketView;
  feedLabel: string;
};

/** How a market settled: the payout, the reading it came from and who, or what, sent the resolving transaction. */
export const SettlementBlock = ({ market, feedLabel }: SettlementBlockProps) => {
  const isVoid = market.status === Status.Void;
  return (
    <section className="rounded-box border border-base-300 bg-base-100 p-5">
      <h2 className="m-0 text-lg font-semibold">{isVoid ? "Void" : "Settlement"}</h2>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-base-content/60">YES pays</dt>
        <dd className="m-0 font-semibold">{payoutToHbar(market.payout)} HBAR</dd>
        <dt className="text-base-content/60">NO pays</dt>
        <dd className="m-0 font-semibold">{payoutToHbar(PAYOUT_SCALE - market.payout)} HBAR</dd>
        {isVoid ? null : (
          <>
            <dt className="text-base-content/60">Answer</dt>
            <dd className="m-0">
              {feedAnswerToPrice(market.answer, market.decimals)} ({feedLabel})
            </dd>
            <dt className="text-base-content/60">Round</dt>
            <dd className="m-0 break-all">{market.roundId.toString()}</dd>
            <dt className="text-base-content/60">Published</dt>
            <dd className="m-0">{formatUtc(market.updatedAt)}</dd>
          </>
        )}
      </dl>
      <p className="mt-3 mb-0 text-sm text-base-content/80">
        {isVoid
          ? "No fresh feed reading existed 24 hours after expiry, so anyone was allowed to void the market. Both tokens pay 0.5 HBAR."
          : market.settledBySchedule
            ? "Settled by the schedule, no account sent this transaction."
            : "Settled by a resolve() call after expiry."}
        {market.settledBySchedule && !isZeroAddress(market.schedule) ? (
          <>
            {" "}
            <HashScanLink kind="schedule" value={market.schedule} label="View the schedule on HashScan" />
          </>
        ) : null}
      </p>
    </section>
  );
};
