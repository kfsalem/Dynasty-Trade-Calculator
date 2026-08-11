import { useState } from 'react';
import type { PositionalStrength } from '../../engine/analysis';
import { formatValue } from '../../lib/format';
import { ChartFigure } from './ChartFigure';
import { markProps } from './mark';
import { CHIP, ChartTooltip, PositionChip, TooltipRow } from './ChartChrome';
import { useChartWidth } from './useChartWidth';
import { MARK, barPath } from './scale';

/**
 * Strengths and weaknesses, as a diverging bar around the league median.
 *
 * The form was already right — `docs/DESIGN-SYSTEM.md` §4.4 says so — so this
 * is the same shape drawn to the mark specs, plus the one thing it was missing.
 *
 * **It was encoding the verdict in colour alone.** A green bar meant a
 * strength and a red bar meant a weakness, and nothing else on the row said
 * which. That is the rule the design system is least willing to bend: gain and
 * loss carry a sign or an arrow, never just the hue. The signed delta now rides
 * the bar's tip, so the direction survives a monochrome screen, a colourblind
 * reader, and a printout.
 *
 * Green and red here are a legitimate use of the reserved status palette rather
 * than a category smuggled in: the axis genuinely is polarity — above the
 * median is good and below it is bad — which is what diverging means, with grey
 * at the midpoint where the reading is "neither".
 */

interface Props {
  positions: PositionalStrength[];
}

const ROW = 30;
const BAR = 12;
/** Room for the value column on the right. */
const VALUE_COLUMN = 76;
/**
 * Reserved either side of the plot for the signed delta that rides each bar's
 * tip.
 *
 * Without it a bar at full extent has nowhere to put its own label: the first
 * render of this chart drew "−7,110" straight through the RB chip, because the
 * bar reached the plot edge and the label was placed six pixels beyond it. The
 * marks spec is explicit that a label which does not fit moves rather than
 * overlapping, and the cheapest way to guarantee it fits is to never let the
 * bar have the space in the first place.
 */
const LABEL_GUTTER = 48;
/** Where the plot starts, past the chip and its gutter. */
const PLOT_LEFT = CHIP.width + 12 + LABEL_GUTTER;
/** The axis caption under the centre line. */
const FOOTER = 22;

const VERDICT_WORD = {
  strength: 'Strength',
  weakness: 'Weakness',
  neutral: 'Even with the league',
} as const;

export function PositionalStrengthChart({ positions }: Props) {
  const { ref, width } = useChartWidth();
  const [active, setActive] = useState<string | null>(null);

  const height = positions.length * ROW + FOOTER;
  const plotRight = Math.max(PLOT_LEFT + 80, width - VALUE_COLUMN - LABEL_GUTTER);
  const centre = (PLOT_LEFT + plotRight) / 2;
  const halfWidth = centre - PLOT_LEFT;

  const hovered = positions.find((p) => p.position === active);

  // Clamped at two standard deviations: past that the bar has made its point,
  // and letting one outlier set the scale flattens the other three rows to
  // nothing.
  const extent = (z: number) => (Math.min(Math.abs(z), 2) / 2) * halfWidth;
  const delta = (item: PositionalStrength) => item.starterValue - item.leagueMedian;
  const signed = (value: number) =>
    `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatValue(Math.abs(value))}`;

  return (
    <ChartFigure
      title="Strengths and weaknesses"
      description="Starting value at each position against the league median. Flex slots count toward the position of whoever fills them."
      table={{
        columns: ['Position', 'Starting value', 'League median', 'Difference', 'Verdict'],
        rows: positions.map((item) => [
          item.position,
          formatValue(item.starterValue),
          formatValue(item.leagueMedian),
          signed(delta(item)),
          VERDICT_WORD[item.verdict],
        ]),
      }}
    >
      <div ref={ref} className="relative">
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${Math.max(width, 260)} ${height}`}
          role="group"
          aria-label="Starting value by position against the league median"
        >
          {/* The median. A single reference line for all four rows, which is the
              whole reason this is one chart rather than four bars. */}
          <line
            x1={centre}
            x2={centre}
            y1={0}
            y2={positions.length * ROW}
            className="stroke-control"
            strokeWidth={1}
            aria-hidden="true"
          />
          <text
            x={centre}
            y={height - 6}
            textAnchor="middle"
            className="fill-subtle text-[10px] font-semibold uppercase tracking-wide"
            aria-hidden="true"
          >
            League median
          </text>

          {positions.map((item, i) => {
            const top = i * ROW;
            const barTop = top + (ROW - BAR) / 2;
            const size = extent(item.z);
            const strong = item.z > 0;
            const difference = delta(item);

            const fill =
              item.verdict === 'strength'
                ? 'fill-positive'
                : item.verdict === 'weakness'
                  ? 'fill-negative'
                  : 'fill-subtle';

            return (
              <g
                key={item.position}
                {...markProps(
                  item.position,
                  `${item.position}: ${formatValue(item.starterValue)} of starting value, ${
                    difference === 0
                      ? 'level with'
                      : `${formatValue(Math.abs(difference))} ${difference > 0 ? 'above' : 'below'}`
                  } the league median of ${formatValue(item.leagueMedian)}. ${
                    VERDICT_WORD[item.verdict]
                  }.`,
                  setActive,
                )}
                className="focus:outline-none"
              >
                <rect
                  x={0}
                  y={top}
                  width={Math.max(width, 260)}
                  height={ROW}
                  fill="transparent"
                />
                <PositionChip position={item.position} x={0} y={top + (ROW - CHIP.height) / 2} />

                <path
                  d={
                    strong
                      ? barPath(centre, barTop, size, BAR, MARK.BAR_RADIUS, 'right')
                      : barPath(centre - size, barTop, size, BAR, MARK.BAR_RADIUS, 'left')
                  }
                  className={fill}
                />

                {/* The value at the tip, signed. This is what stops the chart
                    from saying "good" and "bad" in colour alone. */}
                <text
                  x={strong ? centre + size + 6 : centre - size - 6}
                  y={top + ROW / 2 + 4}
                  textAnchor={strong ? 'start' : 'end'}
                  className="tabular fill-muted text-[11px]"
                >
                  {signed(difference)}
                </text>

                <text
                  x={Math.max(width, 260) - 2}
                  y={top + ROW / 2 + 4}
                  textAnchor="end"
                  className="tabular fill-ink text-xs font-semibold"
                >
                  {formatValue(item.starterValue)}
                </text>
              </g>
            );
          })}
        </svg>

        {hovered && (
          <ChartTooltip
            x={centre}
            y={positions.indexOf(hovered) * ROW + ROW / 2}
            width={width}
          >
            <p className="font-semibold text-ink">{hovered.position}</p>
            <TooltipRow value={formatValue(hovered.starterValue)} label="starting value" />
            <TooltipRow value={formatValue(hovered.leagueMedian)} label="league median" />
            <p className="mt-0.5 text-subtle">{VERDICT_WORD[hovered.verdict]}</p>
          </ChartTooltip>
        )}
      </div>
    </ChartFigure>
  );
}
