import { useState } from 'react';
import type { Position } from '../../types';
import type { PositionScarcity } from '../../engine/replacement';
import { SKILL_POSITIONS } from '../../engine/analysis';
import { POSITION_STYLES, formatValue } from '../../lib/format';
import { ChartFigure, type LegendItem } from './ChartFigure';
import { markProps } from './mark';
import { AxisX, CHIP, ChartTooltip, PositionChip, TooltipRow } from './ChartChrome';
import { useChartWidth } from './useChartWidth';
import { MARK, barPath, linear } from './scale';

/**
 * How much of an elite player's value survives replacement, per position.
 *
 * Why the app weights positions the way it does, shown rather than asserted.
 *
 * Plotted as the share of an elite player's value that *survives* replacement,
 * not as replacement level itself. A high replacement level means the position
 * is cheap to replace — so charting it directly would draw the longest bar for
 * quarterbacks in a shallow league and teach the exact opposite of the point.
 *
 * Both scales, since R8 gave the app two of them. Showing only the dynasty
 * column had this panel quoting a tight-end replacement of 1,548 while the
 * lineup a few inches up the page was scored against 253 — a panel disagreeing
 * with the engine, which is the exact failure it was fixed for once already.
 * The gap between the two bars is worth reading on its own: a position can be
 * expensive to replace as an asset and cheap to replace this Sunday.
 *
 * Two series on one axis, which is the only way this chart is allowed to exist:
 * both are a *percentage retained*, so they share a scale honestly. The
 * standing temptation named in `docs/DESIGN-SYSTEM.md` §4.4 is to plot dynasty
 * value against win-now value on two y-scales, and that is forbidden — the
 * alignment between two such axes is arbitrary and invents a relationship that
 * is not in the data. Percentages of their own maximum are comparable; raw
 * dynasty and win-now points are not.
 *
 * Hue carries **position**; fill-versus-outline carries **which scale**. That
 * split is why the pair still reads as one position rather than as eight
 * unrelated bars, and it is why the legend swatches here are neutral: they are
 * explaining an encoding channel, not a colour.
 */

interface Props {
  scarcity: Partial<Record<Position, PositionScarcity>>;
  teamCount: number;
}

const ROW = 34;
const BAR = 8;
const VALUE_COLUMN = 44;
const PLOT_LEFT = CHIP.width + 12;
const AXIS = 26;

const LEGEND: LegendItem[] = [
  { label: 'Dynasty — what he is worth to hold', swatch: 'bg-subtle' },
  { label: 'Win-now — what he is worth this season', swatch: 'border-subtle', shape: 'outline' },
];

export function ScarcityChart({ scarcity, teamCount }: Props) {
  const { ref, width } = useChartWidth();
  const [active, setActive] = useState<string | null>(null);

  const rows = SKILL_POSITIONS.map((position) => scarcity[position])
    .filter((row): row is PositionScarcity => row !== undefined && row.topMarket > 0)
    .sort((a, b) => b.retained - a.retained);

  if (rows.length === 0) return null;

  const height = rows.length * ROW + AXIS;
  const plotRight = Math.max(PLOT_LEFT + 90, width - VALUE_COLUMN);
  const x = linear([0, 1], [PLOT_LEFT, plotRight]);
  const pct = (share: number) => `${Math.round(share * 100)}%`;

  const hovered = rows.find((row) => row.position === active);

  return (
    <ChartFigure
      title="What each position is really worth here"
      description={
        <>
          With {teamCount} teams and this lineup, a player is only worth what he adds over
          the best man at his position who starts for nobody. The bars show how much of an
          elite player's value survives that test — high means the position is scarce and
          worth paying for, low means you can replace him off waivers. A position can be
          dear to replace as an asset and cheap to replace on Sunday.
        </>
      }
      legend={LEGEND}
      table={{
        columns: ['Position', 'Dynasty kept', 'Win-now kept', 'Starters', 'Replacement cost'],
        rows: rows.map((row) => [
          row.position,
          pct(row.retained),
          pct(row.retainedWinNow),
          row.startersNeeded,
          `${formatValue(row.value)} / ${formatValue(row.winNow)}`,
        ]),
      }}
    >
      <div ref={ref} className="relative">
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${Math.max(width, 260)} ${height}`}
          role="group"
          aria-label="Share of an elite player's value retained, by position"
        >
          <AxisX
            scale={x}
            ticks={[0, 0.25, 0.5, 0.75, 1]}
            y={rows.length * ROW}
            format={pct}
          />

          {rows.map((row, i) => {
            const top = i * ROW;
            const style = POSITION_STYLES[row.position];
            // The 2px surface gap between the pair. Never a stroke: a border
            // around a mark is ink that is not data, and in dark mode the gap
            // is what makes adjacent position hues legal at all.
            const dynastyTop = top + (ROW - (BAR * 2 + MARK.GAP)) / 2;
            const winNowTop = dynastyTop + BAR + MARK.GAP;

            return (
              <g
                key={row.position}
                {...markProps(
                  row.position,
                  `${row.position}: an elite player keeps ${pct(
                    row.retained,
                  )} of his dynasty value and ${pct(
                    row.retainedWinNow,
                  )} of his win-now value here. ${row.startersNeeded} hold a starting job in this league; replacing one costs ${formatValue(
                    row.value,
                  )} as an asset and ${formatValue(row.winNow)} for this season.`,
                  setActive,
                )}
                className="focus:outline-none"
              >
                <rect x={0} y={top} width={Math.max(width, 260)} height={ROW} fill="transparent" />
                <PositionChip position={row.position} x={0} y={top + (ROW - CHIP.height) / 2} />

                <path
                  d={barPath(
                    PLOT_LEFT,
                    dynastyTop,
                    x(row.retained) - PLOT_LEFT,
                    BAR,
                    MARK.BAR_RADIUS,
                    'right',
                  )}
                  className={style.fill}
                />
                {/* The outlined twin. Same hue so the pair reads as one
                    position, different weight so the two scales stay apart
                    without spending a second colour on it. */}
                <path
                  d={barPath(
                    PLOT_LEFT,
                    winNowTop,
                    x(row.retainedWinNow) - PLOT_LEFT,
                    BAR,
                    MARK.BAR_RADIUS,
                    'right',
                  )}
                  fill="none"
                  className={style.stroke}
                  strokeWidth={MARK.LINE}
                />

                <text
                  x={Math.max(width, 260) - 2}
                  y={dynastyTop + BAR}
                  textAnchor="end"
                  className="tabular fill-ink text-[11px] font-semibold"
                >
                  {pct(row.retained)}
                </text>
                <text
                  x={Math.max(width, 260) - 2}
                  y={winNowTop + BAR}
                  textAnchor="end"
                  className="tabular fill-subtle text-[11px]"
                >
                  {pct(row.retainedWinNow)}
                </text>
              </g>
            );
          })}
        </svg>

        {hovered && (
          <ChartTooltip
            x={x(Math.max(hovered.retained, hovered.retainedWinNow))}
            y={rows.indexOf(hovered) * ROW + ROW / 2}
            width={width}
          >
            <p className="font-semibold text-ink">{hovered.position}</p>
            <TooltipRow
              value={pct(hovered.retained)}
              label="kept, dynasty"
              swatch={POSITION_STYLES[hovered.position].bar}
            />
            <TooltipRow value={pct(hovered.retainedWinNow)} label="kept, win-now" />
            <p className="mt-0.5 text-subtle">
              {hovered.startersNeeded} start · replacing one costs{' '}
              {formatValue(hovered.value)}
            </p>
          </ChartTooltip>
        )}
      </div>
    </ChartFigure>
  );
}
