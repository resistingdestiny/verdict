import Link from "next/link";
import { formatPercent, tinybarsToHbar, tokenUnitsToWhole } from "~~/lib/format";
import { complement } from "~~/lib/odds";

type OddsBarProps = {
  probability: bigint;
  hasPool: boolean;
  yesReserve?: bigint;
  hbarReserve?: bigint;
  seedHref?: string;
  compact?: boolean;
};

/**
 * YES and NO as a two-segment bar with the percentages, and the pool reserves beside it.
 * Without a pool it says so and points at the seed step.
 */
export const OddsBar = ({ probability, hasPool, yesReserve, hbarReserve, seedHref, compact }: OddsBarProps) => {
  if (!hasPool || probability === 0n) {
    return (
      <div className="text-sm text-base-content/70">
        <span>No pool yet</span>
        {seedHref ? (
          <>
            {" "}
            <Link href={seedHref} className="link">
              seed one
            </Link>
          </>
        ) : null}
      </div>
    );
  }
  const yesPercent = Number(probability) / 1_000_000;
  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-semibold text-primary">YES {formatPercent(probability)}</span>
        <span className="font-semibold text-base-content/70">NO {formatPercent(complement(probability))}</span>
      </div>
      <div
        className="mt-1 flex h-2.5 w-full overflow-hidden rounded-full bg-base-300"
        role="img"
        aria-label={`YES ${formatPercent(probability)}, NO ${formatPercent(complement(probability))}`}
      >
        <div className="h-full bg-primary" style={{ width: `${yesPercent}%` }} />
      </div>
      {!compact && yesReserve !== undefined && hbarReserve !== undefined ? (
        <p className="m-0 mt-1 text-xs text-base-content/60">
          Pool reserves: {tokenUnitsToWhole(yesReserve, 2)} YES and {tinybarsToHbar(hbarReserve, 2)} HBAR
        </p>
      ) : null}
    </div>
  );
};
