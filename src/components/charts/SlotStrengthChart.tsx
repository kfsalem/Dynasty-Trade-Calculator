import { useState } from 'react';
import type { SlotStrength } from '../../engine/rosterDepth';
import { slotEligibility } from '../../engine/rosterValue';
import { SKILL_POSITIONS } from '../../engine/analysis';
import { POSITION_STYLES, formatValue } from '../../lib/format';
import { ChartFigure } from './ChartFigure';
import { markProps } from './mark';
import { ChartTooltip, TooltipRow } from './ChartChrome';
import { useChartWidth } from './useChartWidth';
import { MARK, barPath } from './scale';

/**
 * Where the lineup is weak, slot by slot (#101, #120).
 *
 * #64 moved weakness detection from the position to the slot: a roster with two
 * elite receivers and nothing at WR3 holds the most receiver value in the league
 * and has a hole in the lineup it fields. The position chart could not show that
 * hole, and on a live league missed four of twenty-one weak slots. This plots
 * the measure the advice is actually drawn from — each starting slot against
 * the same slot on every roster, WR2 against every WR2.
 *
 * The same diverging form as `PositionalStrengthChart`, drawn to the same mark
 * specs, and the same bar for a verdict: 0.75 standard deviations either side.
 * Kickers and defences are left out, as `weakestSlot` leaves them out — they
 * have no market, so every roster ties at zero and the bar would say nothing.
 */

interface Props {
  slots: SlotStrength[];
}

const ROW = 30;
const BAR = 12;
/** Wide enough for `WR2`, `FLEX` and `SUPER_FLEX`'s short form. */
const SLOT_CHIP = { width: 44, height: 18 } as const;
const VALUE_COLUMN = 76;
/** Room either side of the plot for the signed delta at each bar's tip. */
const LABEL_GUTTER = 48;
const PLOT_LEFT = SLOT_CHIP.width + 12 + LABEL_GUTTER;
const FOOTER = 22;

const VERDICT_WORD = {
  strength: 'Strong here',
  weakness: 'Weak here',
  neutral: 'Even with the league',
} as const;

const ordinal = (n: number) => {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
};

/** A slot that only a skill position can fill — the ones with a market. */
const priced = (slot: SlotStrength) =>
  slotEligibility(slot.slot).some((position) => SKILL_POSITIONS.includes(position));

/**
 * The slot's label on a chip. Coloured by position where the slot takes only
 * one, so a WR2 reads as a receiver at a glance; neutral for a flex, which is
 * no position in particular. The letters are always there, so the colour is
 * never the only thing saying which slot this is.
 */
function SlotChip({ slot, x, y }: { slot: SlotStrength; x: number; y: number }) {
  const eligible = slotEligibility(slot.slot);
  const style = eligible.length === 1 ? POSITION_STYLES[eligible[0]] : null;

  return (
    <g aria-hidden="true">
      <rect
        x={x}
        y={y}
        width={SLOT_CHIP.width}
        height={SLOT_CHIP.height}
        rx={4}
        className={style ? style.fillSoft : 'fill-line'}
      />
      <text
        x={x + SLOT_CHIP.width / 2}
        y={y + SLOT_CHIP.height / 2 + 4}
        textAnchor="middle"
        className={`${style ? style.fill : 'fill-muted'} text-[11px] font-semibold`}
      >
        {slot.label.replace('SUPER_FLEX', 'SF')}
      </text>
    </g>
  );
}

export function SlotStrengthChart({ slots }: Props) {
  const { ref, width } = useChartWidth();
  const [active, setActive] = useState<string | null>(null);
  const rows = slots.filter(priced);
  if (rows.length === 0) return null;

  const drawn = Math.max(width, 260);
  const height = rows.length * ROW + FOOTER;
  const plotRight = Math.max(PLOT_LEFT + 80, width - VALUE_COLUMN - LABEL_GUTTER);
  const centre = (PLOT_LEFT + plotRight) / 2;
  const halfWidth = centre - PLOT_LEFT;

  const hovered = rows.find((s) => s.label === active);

  // Clamped at two standard deviations, as the position chart is: past that
  // the bar has made its point, and one outlier would flatten every other row.
  const extent = (z: number) => (Math.min(Math.abs(z), 2) / 2) * halfWidth;
  const delta = (slot: SlotStrength) => slot.value - slot.leagueMedian;
  const signed = (value: number) =>
    `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatValue(Math.abs(value))}`;
  const standing = (slot: SlotStrength) => `${ordinal(slot.rank)} of ${slot.teamCount}`;

  return (
    <ChartFigure
      title="Where your lineup is weak"
      description="Each starting slot against the same slot on every roster in the league — your WR2 against every WR2. This is what the weakest spot under What to focus on is measured on. Kickers and defences have no market and are left out."
      table={{
        columns: ['Slot', 'Starter', 'Value', 'League median', 'Difference', 'Rank', 'Verdict'],
        rows: rows.map((slot) => [
          slot.label,
          slot.entry?.player.name ?? 'Empty',
          formatValue(slot.value),
          formatValue(slot.leagueMedian),
          signed(delta(slot)),
          standing(slot),
          VERDICT_WORD[slot.verdict],
        ]),
      }}
    >
      <div ref={ref} className="relative">
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${drawn} ${height}`}
          role="group"
          aria-label="Each starting slot against the league median at that slot"
        >
          <line
            x1={centre}
            x2={centre}
            y1={0}
            y2={rows.length * ROW}
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
            League median at each slot
          </text>

          {rows.map((slot, i) => {
            const top = i * ROW;
            const barTop = top + (ROW - BAR) / 2;
            const size = extent(slot.z);
            const strong = slot.z > 0;
            const difference = delta(slot);
            // Diverging, so the status pair is legitimate here, as it is on the
            // position chart: the axis genuinely is polarity. The signed figure
            // at the tip carries the direction without the hue.
            const fill =
              slot.verdict === 'strength'
                ? 'fill-positive'
                : slot.verdict === 'weakness'
                  ? 'fill-negative'
                  : 'fill-subtle';

            return (
              <g
                key={slot.label}
                {...markProps(
                  slot.label,
                  `${slot.label}: ${slot.entry?.player.name ?? 'nobody'}, ${formatValue(slot.value)}, ${
                    difference === 0
                      ? 'level with'
                      : `${formatValue(Math.abs(difference))} ${difference > 0 ? 'above' : 'below'}`
                  } the league median of ${formatValue(slot.leagueMedian)} at this slot. ${standing(
                    slot,
                  )}. ${VERDICT_WORD[slot.verdict]}.`,
                  setActive,
                )}
                className="focus:outline-none"
              >
                <rect x={0} y={top} width={drawn} height={ROW} fill="transparent" />
                <SlotChip slot={slot} x={0} y={top + (ROW - SLOT_CHIP.height) / 2} />

                <path
                  d={
                    strong
                      ? barPath(centre, barTop, size, BAR, MARK.BAR_RADIUS, 'right')
                      : barPath(centre - size, barTop, size, BAR, MARK.BAR_RADIUS, 'left')
                  }
                  className={fill}
                />

                <text
                  x={strong ? centre + size + 6 : centre - size - 6}
                  y={top + ROW / 2 + 4}
                  textAnchor={strong ? 'start' : 'end'}
                  className="tabular fill-muted text-[11px]"
                >
                  {signed(difference)}
                </text>

                <text
                  x={drawn - 2}
                  y={top + ROW / 2 + 4}
                  textAnchor="end"
                  className="tabular fill-ink text-xs font-semibold"
                >
                  {standing(slot)}
                </text>
              </g>
            );
          })}
        </svg>

        {hovered && (
          <ChartTooltip x={centre} y={rows.indexOf(hovered) * ROW + ROW / 2} width={width}>
            <p className="font-semibold text-ink">
              {hovered.label} · {hovered.entry?.player.name ?? 'empty'}
            </p>
            <TooltipRow value={formatValue(hovered.value)} label="win-now value" />
            <TooltipRow value={formatValue(hovered.leagueMedian)} label="league median here" />
            <TooltipRow value={standing(hovered)} label="in the league" />
            <p className="mt-0.5 text-subtle">{VERDICT_WORD[hovered.verdict]}</p>
          </ChartTooltip>
        )}
      </div>
    </ChartFigure>
  );
}
