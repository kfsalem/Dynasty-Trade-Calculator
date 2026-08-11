import type { Position } from '../../types';
import { POSITION_STYLES } from '../../lib/format';
import { MARK, linear } from './scale';

/**
 * Where a player's role was, and where it is now.
 *
 * The panel already says "62% snaps, up from 21% over 5 games", and that
 * sentence is complete. What it cannot say is the *scale* — 21% and 62% are
 * both just numbers until you see them against the 0–100% a snap share lives
 * on, and the difference between a move from 21 to 62 and one from 71 to 88 is
 * invisible in prose and obvious here. This is the dumbbell, which is the form
 * for before-and-after on one item.
 *
 * ### Why this one has no table view
 *
 * Every other chart in `components/charts` is a `ChartFigure` and is obliged to
 * carry a table. This is the exception, and deliberately: the mark sits inside
 * a list row whose text already states both endpoints and the window they were
 * measured over. The prose *is* the accessible twin, so the mark is
 * `aria-hidden` and adding a disclosure table per row would make a screen
 * reader announce the same two numbers three times.
 *
 * A chart escapes the frame only when something else on the same row is already
 * saying every number it draws. That is the test to apply before writing
 * another one of these.
 */

interface Props {
  /** Share before the recent window, 0–1. */
  from: number;
  /** Share during it. */
  to: number;
  position: Position;
}

const WIDTH = 104;
const HEIGHT = 14;
const INSET = MARK.DOT + MARK.RING;

export function RoleMoveDumbbell({ from, to, position }: Props) {
  const style = POSITION_STYLES[position];
  // The full 0–100% a share lives on, always — never the extent of these two
  // points. A track that rescaled per player would draw every move the same
  // length and throw away the only thing this mark adds.
  const x = linear([0, 1], [INSET, WIDTH - INSET]);
  const mid = HEIGHT / 2;

  return (
    <svg
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      aria-hidden="true"
      className="shrink-0"
    >
      {/* The track: the whole range, so a move reads against it. */}
      <line
        x1={INSET}
        x2={WIDTH - INSET}
        y1={mid}
        y2={mid}
        className="stroke-line"
        strokeWidth={1}
      />
      {/* The move itself. */}
      <line
        x1={x(from)}
        x2={x(to)}
        y1={mid}
        y2={mid}
        className={style.stroke}
        strokeWidth={MARK.LINE}
        strokeLinecap="round"
      />
      {/*
        Where he was, in grey; where he is, in his position's hue. The dataviz
        default for a dumbbell is one hue in two shades, and this app has no
        second shade to spend: the `-soft` position tints are chip backgrounds
        and vanish as a dot on a white surface. Grey-to-hue says the same thing
        and matches how the rest of the app marks "current" against "context".
      */}
      <circle
        cx={x(from)}
        cy={mid}
        r={MARK.DOT - 1}
        className="fill-subtle stroke-surface"
        strokeWidth={MARK.RING}
      />
      <circle
        cx={x(to)}
        cy={mid}
        r={MARK.DOT}
        className={`${style.fill} stroke-surface`}
        strokeWidth={MARK.RING}
      />
    </svg>
  );
}
