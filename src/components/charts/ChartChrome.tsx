import type { ReactNode } from 'react';
import type { Position } from '../../types';
import { POSITION_STYLES } from '../../lib/format';
import type { Scale } from './scale';

/**
 * Axes, gridlines and the tooltip — the parts of a chart that are not data.
 *
 * All of it is deliberately recessive. The register is "loud with type and
 * scale, disciplined with hue", and chrome is neither type nor data: hairline
 * rules in `--color-line`, labels in `--color-subtle`, and nothing dashed. A
 * dashed gridline reads as a threshold or a projection when it is only a grid.
 */

/** Half-pixel offset so a 1px rule lands on a device pixel instead of straddling two. */
const crisp = (v: number): number => Math.round(v) + 0.5;

interface AxisXProps {
  scale: Scale;
  ticks: number[];
  /** Pixel row the axis sits on — the bottom of the plot area. */
  y: number;
  format: (value: number) => string;
  label?: string;
}

export function AxisX({ scale, ticks, y, format, label }: AxisXProps) {
  const [x0, x1] = scale.range;

  return (
    <g aria-hidden="true">
      <line x1={x0} x2={x1} y1={crisp(y)} y2={crisp(y)} className="stroke-line" strokeWidth={1} />
      {ticks.map((tick) => (
        <text
          key={tick}
          x={scale(tick)}
          y={y + 16}
          textAnchor="middle"
          className="tabular fill-subtle text-[11px]"
        >
          {format(tick)}
        </text>
      ))}
      {label && (
        <text
          x={(x0 + x1) / 2}
          y={y + 34}
          textAnchor="middle"
          className="fill-muted text-[11px] font-semibold"
        >
          {label}
        </text>
      )}
    </g>
  );
}

interface AxisYProps {
  scale: Scale;
  ticks: number[];
  /** Left edge of the plot — where the labels sit. */
  x: number;
  /** Right edge, so the gridlines can span the plot. */
  width: number;
  format: (value: number) => string;
  label?: string;
  /** Gridlines are opt-out: a scatter wants them, a bar chart with direct labels does not. */
  grid?: boolean;
}

export function AxisY({ scale, ticks, x, width, format, label, grid = true }: AxisYProps) {
  return (
    <g aria-hidden="true">
      {ticks.map((tick) => (
        <g key={tick}>
          {grid && (
            <line
              x1={x}
              x2={width}
              y1={crisp(scale(tick))}
              y2={crisp(scale(tick))}
              className="stroke-line"
              strokeWidth={1}
            />
          )}
          <text
            x={x - 8}
            y={scale(tick) + 4}
            textAnchor="end"
            className="tabular fill-subtle text-[11px]"
          >
            {format(tick)}
          </text>
        </g>
      ))}
      {label && (
        <text
          transform={`translate(12 ${(scale.range[0] + scale.range[1]) / 2}) rotate(-90)`}
          textAnchor="middle"
          className="fill-muted text-[11px] font-semibold"
        >
          {label}
        </text>
      )}
    </g>
  );
}

/** Width and height of a position chip drawn inside a plot. */
export const CHIP = { width: 30, height: 18 } as const;

/**
 * The position chip, in SVG.
 *
 * The same mark as the HTML chip beside it in every list — a soft fill with the
 * letters in the position hue — redrawn here so a chart can align it to a bar's
 * baseline exactly. It is not decoration: in light mode the position colours
 * sit below 3:1 against the surface, and the design system permits them only
 * *because* the letters are there. A chart may never drop the chip and leave
 * colour alone to say which position a bar belongs to.
 */
export function PositionChip({ position, x, y }: { position: Position; x: number; y: number }) {
  const style = POSITION_STYLES[position];

  return (
    <g aria-hidden="true">
      <rect x={x} y={y} width={CHIP.width} height={CHIP.height} rx={4} className={style.fillSoft} />
      <text
        x={x + CHIP.width / 2}
        y={y + CHIP.height / 2 + 4}
        textAnchor="middle"
        className={`${style.fill} text-[11px] font-semibold`}
      >
        {style.label}
      </text>
    </g>
  );
}

interface TooltipProps {
  /** Anchor, in pixels within the chart container. */
  x: number;
  y: number;
  /** Container width, so the card can be kept inside it. */
  width: number;
  children: ReactNode;
}

/**
 * One tooltip, for every chart.
 *
 * `aria-hidden`, and that is not an oversight. Every mark carries the same
 * information in its own `aria-label` (see `markProps`) and the table view
 * carries all of it again; announcing the tooltip too would read every value
 * three times. The tooltip is a convenience for people using a pointer, and it
 * is drawn in HTML rather than SVG so the text renders at the weight and
 * hinting the rest of the app uses.
 */
export function ChartTooltip({ x, y, width, children }: TooltipProps) {
  // Half the card's max width, so a point near either edge does not push a
  // tooltip off the card and trigger a horizontal scrollbar.
  const margin = 90;
  const left = Math.max(margin, Math.min(width - margin, x));

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute z-10 max-w-44 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-raised px-2.5 py-1.5 text-xs shadow-sm"
      style={{ left, top: y - 10 }}
    >
      {children}
    </div>
  );
}

/**
 * A row inside the tooltip: **the value leads, the label follows.**
 *
 * The legend's hierarchy, inverted on purpose. A reader looking at a legend has
 * a colour and wants the name; a reader hovering a mark already knows which
 * mark they are pointing at and wants the number.
 */
export function TooltipRow({
  value,
  label,
  swatch,
}: {
  value: string;
  label: string;
  swatch?: string;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      {swatch && <span className={`h-0.5 w-3 shrink-0 rounded-full ${swatch}`} />}
      <span className="tabular font-semibold text-ink">{value}</span>
      <span className="text-subtle">{label}</span>
    </div>
  );
}
