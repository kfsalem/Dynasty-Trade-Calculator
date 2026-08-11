/**
 * The arithmetic every chart in the app shares, kept out of the components so
 * it can be tested without a DOM.
 *
 * Deliberately about forty lines rather than a charting library. The app draws
 * four chart types over data it already holds in memory; a library would add a
 * dependency, a second styling vocabulary, and its own opinions about colour —
 * and `docs/DESIGN-SYSTEM.md` §4.4 has already settled colour.
 */

/** Maps a data domain onto a pixel range. */
export interface Scale {
  (value: number): number;
  readonly domain: readonly [number, number];
  readonly range: readonly [number, number];
}

/**
 * Linear map from data to pixels.
 *
 * Clamps to the range, which matters more than it sounds: an outlier drawn
 * outside the plot does not overflow into the next card, it pins to the edge.
 * A degenerate domain (every value identical — a league where all ten teams
 * score the same, or a single-team league) maps to the middle of the range
 * rather than dividing by zero.
 */
export function linear(
  domain: readonly [number, number],
  range: readonly [number, number],
): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;

  const scale = ((value: number): number => {
    if (span === 0) return (r0 + r1) / 2;
    const t = (value - d0) / span;
    const clamped = Math.max(0, Math.min(1, t));
    return r0 + clamped * (r1 - r0);
  }) as { (value: number): number; domain: typeof domain; range: typeof range };

  scale.domain = domain;
  scale.range = range;
  return scale as Scale;
}

/**
 * Axis ticks on round numbers — 0 / 1,000 / 2,000, never 0 / 1,037 / 2,074.
 *
 * The dataviz method asks for clean ticks because they carry the values that
 * are not directly labelled; a tick nobody can read at a glance carries
 * nothing.
 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];

  const [lo, hi] = min < max ? [min, max] : [max, min];
  const rawStep = (hi - lo) / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  // Snap to the 1 / 2 / 5 / 10 ladder people actually read numbers on. The
  // thresholds are geometric means rather than the round numbers they look like
  // they should be — sqrt(2), sqrt(10), sqrt(50) — so each raw step lands on the
  // *nearest* rung. Using 2 and 5 directly rounds a step of 200 up to 500 and
  // halves the tick count.
  const step =
    (normalized >= Math.SQRT2 * 5
      ? 10
      : normalized >= Math.sqrt(10)
        ? 5
        : normalized >= Math.SQRT2
          ? 2
          : 1) * magnitude;

  const out: number[] = [];
  const first = Math.ceil(lo / step) * step;
  // The epsilon is float drift insurance: 0.1 + 0.2 > 0.3 would otherwise drop
  // the last tick of a 0-0.3 axis.
  for (let tick = first; tick <= hi + step * 1e-9; tick += step) {
    // Re-round each tick rather than accumulating: 0.1 * 3 is 0.30000000000000004.
    out.push(Number((Math.round(tick / step) * step).toPrecision(12)));
  }
  return out;
}

/**
 * A horizontal bar rounded at the data end and square at the baseline.
 *
 * `<rect rx>` rounds all four corners, which softens the baseline too and makes
 * a row of bars look like it is floating rather than growing from a common
 * edge. The rounded end is the mark's *value*; the square end is where it is
 * measured from, and the difference should be visible.
 *
 * Degrades to a plain rectangle when the bar is shorter than its own radius —
 * a 2px bar with a 4px corner radius renders as a lens, or as nothing.
 */
export function barPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  end: 'right' | 'left',
): string {
  const w = Math.max(0, width);
  const r = Math.min(radius, w, height / 2);

  if (r <= 0) return `M${x} ${y}h${w}v${height}h${-w}Z`;

  return end === 'right'
    ? `M${x} ${y}h${w - r}a${r} ${r} 0 0 1 ${r} ${r}v${height - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${
        -(w - r)
      }Z`
    : `M${x + w} ${y}h${-(w - r)}a${r} ${r} 0 0 0 ${-r} ${r}v${height - 2 * r}a${r} ${r} 0 0 0 ${r} ${r}h${
        w - r
      }Z`;
}

/**
 * Mark specifications, fixed across every chart.
 *
 * These are the dataviz skill's numbers, named once here so a chart cannot
 * quietly disagree with the one beside it. The two that look like arbitrary
 * pixel counts are not:
 *
 * - `GAP` is the 2px of *surface colour* that separates touching marks. It is
 *   what makes the stacked bar legal — amber and emerald sit dE 7.9 apart in
 *   dark mode, which passes only with a secondary encoding, and the gap is that
 *   encoding. Never a border: a stroke adds ink that is not data.
 * - `HIT` is the minimum hit target for a mark. An 8px scatter dot is a
 *   pinpoint nobody lands on, so the transparent hit area is the mark's real
 *   size for pointer and focus purposes.
 */
export const MARK = {
  /** Bars never fill their band — the leftover is air. */
  BAR_MAX: 24,
  /** Rounded at the data end, square at the baseline. */
  BAR_RADIUS: 4,
  LINE: 2,
  /** Radius. Diameter therefore clears the 8px floor. */
  DOT: 4,
  /** Surface-coloured ring on a dot, so overlapping points stay countable. */
  RING: 2,
  GAP: 2,
  HIT: 24,
} as const;
