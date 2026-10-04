import { feedAnswerToPrice } from "~~/lib/format";
import { type Kind, kindUsesUpper } from "~~/lib/kinds";
import { payoffPoints, priceDomain } from "~~/lib/payoff";

type PayoffDiagramProps = {
  kind: Kind;
  lower: bigint;
  upper: bigint;
  decimals: number;
  current?: bigint;
  feedLabel: string;
};

const WIDTH = 360;
const HEIGHT = 190;
const PAD = { left: 44, right: 14, top: 18, bottom: 34 };

/**
 * What one YES and one NO token pay across the price range, as plain SVG. The bounds are marked with
 * dashed lines and the current price, when known, with a solid one.
 */
export const PayoffDiagram = ({ kind, lower, upper, decimals, current, feedLabel }: PayoffDiagramProps) => {
  const { min, max } = priceDomain(kind, lower, upper, current);
  const points = payoffPoints(kind, lower, upper, min, max);
  const span = Number(max - min);
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const x = (price: bigint) => PAD.left + (Number(price - min) / span) * plotWidth;
  const y = (payout: bigint) => PAD.top + plotHeight - (Number(payout) / 1e8) * plotHeight;
  const toPath = (pick: (p: (typeof points)[number]) => bigint) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.price).toFixed(1)},${y(pick(p)).toFixed(1)}`).join(" ");
  const markers = [{ price: lower, label: feedAnswerToPrice(lower, decimals, 4) }];
  if (kindUsesUpper(kind)) markers.push({ price: upper, label: feedAnswerToPrice(upper, decimals, 4) });
  const bottom = PAD.top + plotHeight;

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-auto"
        role="img"
        aria-label={`Payoff of YES and NO against ${feedLabel}`}
      >
        <line
          x1={PAD.left}
          y1={bottom}
          x2={WIDTH - PAD.right}
          y2={bottom}
          className="stroke-base-content/30"
          strokeWidth={1}
        />
        <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={bottom} className="stroke-base-content/30" strokeWidth={1} />
        <text x={PAD.left - 6} y={PAD.top + 4} textAnchor="end" className="fill-base-content/60" fontSize={10}>
          1 HBAR
        </text>
        <text x={PAD.left - 6} y={bottom + 4} textAnchor="end" className="fill-base-content/60" fontSize={10}>
          0
        </text>
        <text x={PAD.left} y={HEIGHT - 6} textAnchor="start" className="fill-base-content/60" fontSize={10}>
          {feedAnswerToPrice(min, decimals, 4)}
        </text>
        <text x={WIDTH - PAD.right} y={HEIGHT - 6} textAnchor="end" className="fill-base-content/60" fontSize={10}>
          {feedAnswerToPrice(max, decimals, 4)}
        </text>
        {markers.map(marker => (
          <g key={marker.label}>
            <line
              x1={x(marker.price)}
              y1={PAD.top}
              x2={x(marker.price)}
              y2={bottom}
              className="stroke-base-content/50"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <text
              x={x(marker.price)}
              y={PAD.top - 6}
              textAnchor="middle"
              className="fill-base-content/70"
              fontSize={10}
            >
              {marker.label}
            </text>
          </g>
        ))}
        {current !== undefined ? (
          <g>
            <line
              x1={x(current)}
              y1={PAD.top}
              x2={x(current)}
              y2={bottom}
              className="stroke-base-content"
              strokeWidth={1}
            />
            <text x={x(current)} y={bottom + 14} textAnchor="middle" className="fill-base-content" fontSize={10}>
              now {feedAnswerToPrice(current, decimals, 4)}
            </text>
          </g>
        ) : null}
        <path
          d={toPath(p => p.no)}
          fill="none"
          className="stroke-base-content/45"
          strokeWidth={2}
          strokeDasharray="5 4"
        />
        <path d={toPath(p => p.yes)} fill="none" className="stroke-primary" strokeWidth={2.5} />
      </svg>
      <figcaption className="mt-1 flex items-center gap-4 text-xs text-base-content/70">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-5 bg-primary" /> YES pays
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-5 border-t-2 border-dashed border-base-content/45" /> NO pays
        </span>
      </figcaption>
    </figure>
  );
};
