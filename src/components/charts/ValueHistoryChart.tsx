import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Position } from '../../types';
import { POSITION_STYLES, formatValue } from '../../lib/format';
import { fetchValueHistory } from '../../data/load';
import { playerSeries, type HistoryPoint, type HistoryQbs } from '../../values/valueHistory';
import { AxisY, ChartTooltip, TooltipRow } from './ChartChrome';
import { ChartFigure } from './ChartFigure';
import { MARK, linear, niceTicks } from './scale';
import { useChartWidth } from './useChartWidth';

/**
 * A player's FantasyCalc value over time, in the player panel (#158).
 *
 * Change over time for one player, on one axis: dynasty and win-now are the
 * same currency, so they share a scale and the design system's one-axis rule
 * holds. Dynasty is drawn in the position hue and win-now in grey, which is
 * how the rest of the app marks the figure in focus against its context
 * (`RoleMoveDumbbell`). Both solid: a dash here would read as a projection.
 *
 * The market's figure, not the league-adjusted one in the tiles above it — a
 * league-adjusted value depends on that league's rosters on the day, which the
 * history cannot reproduce — so the title says whose number it is.
 */

const HEIGHT = 150;
const PAD = { top: 12, right: 64, bottom: 26, left: 48 };
/** Fewest pixels between the two end labels before the lower one is pushed down. */
const LABEL_GAP = 13;

const day = (date: string) => Date.parse(`${date}T12:00:00Z`) / 86_400_000;
const shortDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

interface Props {
  playerId: string;
  position: Position;
  numQbs: HistoryQbs;
}

export function ValueHistoryChart({ playerId, position, numQbs }: Props) {
  const query = useQuery({
    queryKey: ['valueHistory', numQbs],
    queryFn: () => fetchValueHistory(numQbs),
    staleTime: Infinity,
    retry: 1,
  });
  const series = useMemo(
    () => (query.data ? playerSeries(query.data, playerId) : []),
    [query.data, playerId],
  );

  if (query.isPending) return <div className="skeleton mt-4 h-40 w-full rounded-card" aria-hidden="true" />;
  // One point is a price, not a history; the tiles above already show it.
  if (series.length < 2) return null;
  return <Chart series={series} position={position} />;
}

function Chart({ series, position }: { series: HistoryPoint[]; position: Position }) {
  const { ref, width } = useChartWidth(400);
  const [active, setActive] = useState<number | null>(null);
  const style = POSITION_STYLES[position];

  const first = series[0];
  const last = series[series.length - 1];
  const change = (last.value - first.value) / first.value;

  /*
    The axis is widened to round numbers on both sides, so every point sits
    between two labelled gridlines. `niceTicks` alone stops at the last round
    number inside the data, which left the top line floating above the grid.
  */
  const values = series.flatMap((p) => [p.value, p.redraft]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const rough = niceTicks(min, max, 3);
  const step = rough.length > 1 ? rough[1] - rough[0] : Math.max(1, Math.abs(max) * 0.1);
  const lo = Math.floor(min / step) * step;
  const hi = Math.max(lo + step, Math.ceil(max / step) * step);
  const ticks = niceTicks(lo, hi, Math.round((hi - lo) / step));
  const x = linear([day(first.date), day(last.date)], [PAD.left, width - PAD.right]);
  const y = linear([lo, hi], [HEIGHT - PAD.bottom, PAD.top]);

  const path = (pick: (p: HistoryPoint) => number) =>
    series.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(day(p.date))},${y(pick(p))}`).join(' ');

  // End labels, nudged apart when the two lines finish close together.
  let dynastyY = y(last.value);
  let winNowY = y(last.redraft);
  if (Math.abs(dynastyY - winNowY) < LABEL_GAP) {
    const mid = (dynastyY + winNowY) / 2;
    const upper = mid - LABEL_GAP / 2;
    const lower = mid + LABEL_GAP / 2;
    [dynastyY, winNowY] = last.value >= last.redraft ? [upper, lower] : [lower, upper];
  }

  /** The point nearest the pointer, so the whole plot is one hover target. */
  const nearest = (clientX: number, rect: DOMRect) => {
    const px = clientX - rect.left;
    let best = 0;
    for (let i = 1; i < series.length; i++) {
      if (Math.abs(x(day(series[i].date)) - px) < Math.abs(x(day(series[best].date)) - px)) best = i;
    }
    return best;
  };

  const hovered = active === null ? null : series[active];

  return (
    <ChartFigure
      title="FantasyCalc value over time"
      description={
        <>
          Dynasty value{' '}
          <span className="font-semibold text-ink">
            {change === 0
              ? 'unchanged'
              : `${change > 0 ? 'up' : 'down'} ${Math.abs(change * 100).toFixed(change > -0.1 && change < 0.1 ? 1 : 0)}%`}
          </span>{' '}
          since {shortDate(first.date)}. The market&apos;s price at each weekly refresh, before
          this league&apos;s adjustment.
        </>
      }
      legend={[
        { label: 'Dynasty', swatch: style.bar, shape: 'line' },
        { label: 'Win-now', swatch: 'bg-subtle', shape: 'line' },
      ]}
      table={{
        columns: ['Date', 'Dynasty', 'Win-now'],
        rows: series.map((p) => [shortDate(p.date), formatValue(p.value), formatValue(p.redraft)]),
      }}
    >
      <div ref={ref} className="relative">
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`Dynasty value from ${formatValue(first.value)} on ${shortDate(first.date)} to ${formatValue(last.value)} on ${shortDate(last.date)}.`}
          onPointerMove={(event) =>
            setActive(nearest(event.clientX, event.currentTarget.getBoundingClientRect()))
          }
          onPointerLeave={() => setActive(null)}
        >
          <AxisY scale={y} ticks={ticks} x={PAD.left} width={width - PAD.right} format={formatValue} />
          <g aria-hidden="true">
            <text x={PAD.left} y={HEIGHT - 6} className="fill-subtle text-[11px]">
              {shortDate(first.date)}
            </text>
            <text x={width - PAD.right} y={HEIGHT - 6} textAnchor="end" className="fill-subtle text-[11px]">
              {shortDate(last.date)}
            </text>
          </g>

          {hovered && (
            <line
              x1={x(day(hovered.date))}
              x2={x(day(hovered.date))}
              y1={PAD.top}
              y2={HEIGHT - PAD.bottom}
              className="stroke-line"
              strokeWidth={1}
              aria-hidden="true"
            />
          )}

          <path d={path((p) => p.redraft)} className="fill-none stroke-subtle" strokeWidth={MARK.LINE} strokeLinejoin="round" aria-hidden="true" />
          <path d={path((p) => p.value)} className={`fill-none ${style.stroke}`} strokeWidth={MARK.LINE} strokeLinejoin="round" aria-hidden="true" />

          {series.map((p, i) => (
            <g key={p.date} aria-hidden="true">
              <circle cx={x(day(p.date))} cy={y(p.redraft)} r={i === active ? MARK.DOT + 1 : MARK.DOT} className="fill-subtle stroke-surface" strokeWidth={MARK.RING} />
              <circle cx={x(day(p.date))} cy={y(p.value)} r={i === active ? MARK.DOT + 1 : MARK.DOT} className={`${style.fill} stroke-surface`} strokeWidth={MARK.RING} />
            </g>
          ))}

          <g aria-hidden="true">
            <text x={width - PAD.right + 8} y={dynastyY + 4} className="fill-muted text-[11px] font-semibold">
              Dynasty
            </text>
            <text x={width - PAD.right + 8} y={winNowY + 4} className="fill-subtle text-[11px]">
              Win-now
            </text>
          </g>
        </svg>

        {/* A non-breaking hyphen in "win-now": the card is narrow, and "win-" alone on a line reads as a typo. */}
        {hovered && (
          <ChartTooltip x={x(day(hovered.date))} y={y(Math.max(hovered.value, hovered.redraft))} width={width}>
            <p className="mb-0.5 text-subtle">{shortDate(hovered.date)}</p>
            <TooltipRow value={formatValue(hovered.value)} label="dynasty" swatch={style.bar} />
            <TooltipRow value={formatValue(hovered.redraft)} label={'win‑now'} swatch="bg-subtle" />
          </ChartTooltip>
        )}
      </div>
    </ChartFigure>
  );
}
