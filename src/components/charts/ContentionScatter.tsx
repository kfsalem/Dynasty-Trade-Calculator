import { useState } from 'react';
import type { LeagueContention, Quadrant } from '../../engine/analysis';
import { formatValue } from '../../lib/format';
import { ChartFigure } from './ChartFigure';
import { markProps } from './mark';
import { AxisX, AxisY, ChartTooltip, TooltipRow } from './ChartChrome';
import { useChartWidth } from './useChartWidth';
import { MARK, linear, niceTicks } from './scale';

/**
 * The contention quadrant, as an actual quadrant.
 *
 * The app has always computed a two-axis position for every team and then
 * thrown away everything except which of four boxes yours landed in. "Window
 * closing" tells you the verdict; it does not tell you that you are a hair
 * over the line, or that the two teams you would have to get past are both
 * further right than you are. That is what a scatter says and a label cannot.
 *
 * ### Why the dots are not coloured by quadrant
 *
 * The obvious design — four quadrants, four colours — is wrong twice over, and
 * both reasons are rules rather than preferences:
 *
 * - **Status colours are reserved.** `docs/DESIGN-SYSTEM.md` §4.1: positive,
 *   negative and caution never double as a category. Painting "Juggernaut"
 *   green and "Danger zone" red spends the status palette on identity, and the
 *   app then has nothing left to say *good* or *bad* with.
 * - **All-pairs forms cap at three categorical series.** In a scatter every
 *   point can sit beside every other, so a fourth hue has to separate from all
 *   three others under colour-vision deficiency, not merely from its
 *   neighbours.
 *
 * So this is an **emphasis** chart, which is the honest encoding anyway: the
 * story is "where am I", not "here are four kinds of team". Your team is the
 * accent dot, larger, ringed and directly labelled; the rest of the league is
 * recessive grey. The quadrant a team is in is carried by *position* against
 * the two median lines — which is what a quadrant has always meant — and named
 * in the corners.
 */

const QUADRANT_LABEL: Record<Quadrant, string> = {
  juggernaut: 'Juggernaut',
  win_now: 'Window closing',
  rebuilding: 'Rebuilding',
  danger: 'Danger zone',
};

interface Props {
  contention: LeagueContention;
  /** Roster id to team name. */
  teamNames: Map<number, string>;
  myRosterId: number;
}

const HEIGHT = 300;
const MARGIN = { top: 22, right: 18, bottom: 46, left: 52 } as const;

/** Pad a domain so no point is drawn on top of an axis. */
function padded(values: number[]): [number, number] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  // A league where every team is identical still needs a plot to draw into.
  const pad = span === 0 ? Math.abs(max) * 0.1 || 1 : span * 0.12;
  return [min - pad, max + pad];
}

export function ContentionScatter({ contention, teamNames, myRosterId }: Props) {
  const { ref, width } = useChartWidth();
  const [active, setActive] = useState<string | null>(null);

  const { points, nowMedian, retainedMedian } = contention;
  const plotWidth = Math.max(220, width - MARGIN.left - MARGIN.right);

  // The medians are inside the domain by construction, but including them
  // explicitly keeps both split lines on the plot even in a two-team league
  // where one of them coincides with an extreme.
  const x = linear(padded([...points.map((p) => p.nowScore), nowMedian]), [
    MARGIN.left,
    MARGIN.left + plotWidth,
  ]);
  const y = linear(padded([...points.map((p) => p.retainedShare), retainedMedian]), [
    HEIGHT - MARGIN.bottom,
    MARGIN.top,
  ]);

  const xTicks = niceTicks(x.domain[0], x.domain[1], 4);
  const yTicks = niceTicks(y.domain[0], y.domain[1], 4);

  const name = (rosterId: number) => teamNames.get(rosterId) ?? `Team ${rosterId}`;
  const ratio = (value: number) => `${value.toFixed(2)}×`;

  const hovered = points.find((p) => String(p.rosterId) === active);

  // Corner labels. Inset from the plot edge rather than from the split lines,
  // so an off-centre median cannot push one out of its own quadrant.
  const corners: { quadrant: Quadrant; x: number; y: number; anchor: 'start' | 'end' }[] = [
    { quadrant: 'juggernaut', x: MARGIN.left + plotWidth - 4, y: MARGIN.top + 4, anchor: 'end' },
    { quadrant: 'rebuilding', x: MARGIN.left + 4, y: MARGIN.top + 4, anchor: 'start' },
    {
      quadrant: 'win_now',
      x: MARGIN.left + plotWidth - 4,
      y: HEIGHT - MARGIN.bottom - 8,
      anchor: 'end',
    },
    { quadrant: 'danger', x: MARGIN.left + 4, y: HEIGHT - MARGIN.bottom - 8, anchor: 'start' },
  ];

  return (
    <ChartFigure
      title="Where the league sits"
      description={
        <>
          Every team on the two axes the verdict is a median split of: how strong the
          lineup is <strong>now</strong>, against how much future value it holds per point
          of that present strength. The crosshair is the league median on each. Your team
          is the highlighted dot.
        </>
      }
      table={{
        columns: ['Team', 'Now', 'Future per point', 'Verdict'],
        rows: [...points]
          .sort((a, b) => b.nowScore - a.nowScore)
          .map((point) => [
            name(point.rosterId) + (point.rosterId === myRosterId ? ' (you)' : ''),
            formatValue(point.nowScore),
            ratio(point.retainedShare),
            QUADRANT_LABEL[point.quadrant],
          ]),
      }}
    >
      <div ref={ref} className="relative">
        <svg
          width="100%"
          height={HEIGHT}
          viewBox={`0 0 ${Math.max(width, 260)} ${HEIGHT}`}
          role="group"
          aria-label="League contention scatter"
        >
          <AxisY
            scale={y}
            ticks={yTicks}
            x={MARGIN.left}
            width={MARGIN.left + plotWidth}
            format={(value) => value.toFixed(2)}
            label="Future value per point →"
          />
          <AxisX
            scale={x}
            ticks={xTicks}
            y={HEIGHT - MARGIN.bottom}
            format={(value) => formatValue(value)}
            label="Win-now lineup strength →"
          />

          {/* The two split lines. Same hairline weight as the grid: they are
              chrome, not data — the data is which side of them a team is on. */}
          <line
            x1={x(nowMedian)}
            x2={x(nowMedian)}
            y1={MARGIN.top}
            y2={HEIGHT - MARGIN.bottom}
            className="stroke-control"
            strokeWidth={1}
            aria-hidden="true"
          />
          <line
            x1={MARGIN.left}
            x2={MARGIN.left + plotWidth}
            y1={y(retainedMedian)}
            y2={y(retainedMedian)}
            className="stroke-control"
            strokeWidth={1}
            aria-hidden="true"
          />

          {corners.map((corner) => (
            <text
              key={corner.quadrant}
              x={corner.x}
              y={corner.y}
              textAnchor={corner.anchor}
              className="fill-subtle text-[10px] font-semibold uppercase tracking-wide"
              aria-hidden="true"
            >
              {QUADRANT_LABEL[corner.quadrant]}
            </text>
          ))}

          {points.map((point) => {
            const mine = point.rosterId === myRosterId;
            const cx = x(point.nowScore);
            const cy = y(point.retainedShare);
            const label = `${name(point.rosterId)}${mine ? ', your team' : ''}: ${formatValue(
              point.nowScore,
            )} now, ${ratio(point.retainedShare)} future per point. ${
              QUADRANT_LABEL[point.quadrant]
            }.`;

            return (
              <g
                key={point.rosterId}
                {...markProps(String(point.rosterId), label, setActive)}
                className="focus:outline-none"
              >
                {/*
                  A transparent hit target far larger than the dot. An 8px mark
                  is a pinpoint nobody lands on with a mouse and nobody can hit
                  at all on a phone; the painted dot is what you see, this is
                  what you aim at.
                */}
                <circle cx={cx} cy={cy} r={MARK.HIT / 2} fill="transparent" />
                <circle
                  cx={cx}
                  cy={cy}
                  r={mine ? MARK.DOT + 2 : MARK.DOT}
                  className={`${mine ? 'fill-accent' : 'fill-subtle'} stroke-surface`}
                  strokeWidth={MARK.RING}
                />
                {/* Your team is the only direct label. A name on all ten dots is
                    the chart nobody reads.

                    It flips below the dot near the top of the plot, where it
                    would otherwise land on the row the corner labels occupy —
                    a rebuilding team sits high and left by definition, so
                    "REBUILDING" and the team name collided in exactly the case
                    the chart is most often read in. */}
                {mine && (
                  <text
                    x={cx}
                    y={cy < MARGIN.top + 28 ? cy + 20 : cy - 12}
                    textAnchor="middle"
                    className="fill-ink text-[11px] font-semibold"
                  >
                    {name(point.rosterId)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {hovered && (
          <ChartTooltip x={x(hovered.nowScore)} y={y(hovered.retainedShare)} width={width}>
            <p className="font-semibold text-ink">{name(hovered.rosterId)}</p>
            <TooltipRow value={formatValue(hovered.nowScore)} label="now" />
            <TooltipRow value={ratio(hovered.retainedShare)} label="future per point" />
            <p className="mt-0.5 text-subtle">{QUADRANT_LABEL[hovered.quadrant]}</p>
          </ChartTooltip>
        )}
      </div>
    </ChartFigure>
  );
}
