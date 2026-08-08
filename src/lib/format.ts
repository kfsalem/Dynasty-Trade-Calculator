import type { InjuryStatus, Position } from '../types';

/**
 * A value, as a human reads it.
 *
 * Two things this does beyond rounding, both of them about the bottom of the
 * scale rather than the top.
 *
 * **A player worth something never renders as nothing.** The win-now scale
 * reaches far closer to zero than the dynasty one ever did — redraft prices
 * collapse below the top fifteen or so at a position, and the surplus curve then
 * squares that — so on a real league 25 players carry a positive value under 10
 * and four receivers rounded to a flat `0`. The engine is careful never to
 * return zero for a ranked player, and `docs/DESIGN.md` records why: rounding
 * "would put adjacent players back onto identical values, a smaller version of
 * the same collapse". Throwing that away in the last three characters before it
 * reaches the screen makes the display say something the model does not.
 *
 * `~0` is already this app's phrase for "ranked, and worth almost nothing" —
 * `UnvaluedCell` uses it for players past the end of the value universe — so it
 * carries the right meaning here without teaching a second idiom.
 *
 * **Negative zero is never shown.** `Math.round(-0.2)` is `-0`, which formats as
 * "-0" and reads as a bug in a trade delta.
 */
export const formatValue = (n: number): string => {
  const rounded = Math.round(n);
  if (rounded === 0) return n > 0 ? '~0' : '0';
  return rounded.toLocaleString('en-US');
};

export const formatAge = (age: number | null): string =>
  age === null ? '—' : `${age.toFixed(1)} yrs`;

/**
 * Tailwind classes per position, used for chips and the breakdown bars.
 *
 * `border` is the outlined counterpart of `bar`, for the second bar in the
 * scarcity panel: same hue, so the pair reads as one position, different weight,
 * so dynasty and win-now stay distinguishable without spending a second colour.
 * Written out in full rather than composed, because Tailwind scans source for
 * complete class names and an interpolated `border-${hue}-500` is not one.
 *
 * These are tokens, so dark mode is already handled — `--color-pos-*` steps
 * down one stop on a dark surface, where the light-mode values fall outside the
 * validator's lightness band.
 *
 * **QB is sky, not blue, and this is not a taste call.** The previous blue-500
 * sat dE 1.3 from TE's violet-500 under deuteranopia — indistinguishable for
 * red-green colourblind readers — and dE 12.0 for normal vision, below the hard
 * floor of 15. RB, WR and TE are unchanged; only QB moved, which was the
 * smallest edit that made the set pass. Re-run the validator before touching
 * any of them:
 *
 *   node scripts/validate_palette.js "#0ea5e9,#10b981,#f59e0b,#8b5cf6" \
 *     --mode light --pairs all --surface "#ffffff"
 *
 * from the dataviz skill. See docs/DESIGN-SYSTEM.md §4.2.
 *
 * The palette passes *conditionally*: in light mode these colours sit below 3:1
 * against the surface, which is legal only with a visible text label. That is
 * what `label` is for, and why a chip must never render as colour alone.
 */
export const POSITION_STYLES: Record<
  Position,
  { chip: string; bar: string; border: string; label: string }
> = {
  QB: {
    chip: 'bg-pos-qb-soft text-pos-qb',
    bar: 'bg-pos-qb',
    border: 'border-pos-qb',
    label: 'QB',
  },
  RB: {
    chip: 'bg-pos-rb-soft text-pos-rb',
    bar: 'bg-pos-rb',
    border: 'border-pos-rb',
    label: 'RB',
  },
  WR: {
    chip: 'bg-pos-wr-soft text-pos-wr',
    bar: 'bg-pos-wr',
    border: 'border-pos-wr',
    label: 'WR',
  },
  TE: {
    chip: 'bg-pos-te-soft text-pos-te',
    bar: 'bg-pos-te',
    border: 'border-pos-te',
    label: 'TE',
  },
  K: {
    chip: 'bg-pos-none-soft text-pos-none',
    bar: 'bg-pos-none',
    border: 'border-pos-none',
    label: 'K',
  },
  DEF: {
    chip: 'bg-pos-none-soft text-pos-none',
    bar: 'bg-pos-none',
    border: 'border-pos-none',
    label: 'DEF',
  },
};

export const POSITION_ORDER: Position[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

/** "SUPER_FLEX" -> "SF", "FLEX" -> "FLEX" — compact enough for a slot column. */
export const formatSlot = (slot: string): string =>
  slot === 'SUPER_FLEX' ? 'SF' : slot === 'REC_FLEX' ? 'WR/TE' : slot;

/**
 * Injury statuses render inline next to a player's name, where the full word
 * ("QUESTIONABLE") crowds out the name itself. These are the abbreviations
 * fantasy players already read on every platform.
 */
const INJURY_ABBREV: Record<string, string> = {
  questionable: 'Q',
  doubtful: 'D',
  out: 'O',
  ir: 'IR',
  pup: 'PUP',
  sus: 'SUS',
  dnr: 'DNR',
  na: 'NA',
};

/**
 * Takes the whole status rather than the word, so an unrecognised designation
 * can fall back to what the platform actually said. `unknown` means the mapper
 * did not recognise the text, and showing the text is strictly more useful than
 * showing "UNK" — the manager reading it may well know what it means.
 */
export const formatInjury = (injury: InjuryStatus): string =>
  INJURY_ABBREV[injury.status] ??
  (injury.description ?? injury.status).slice(0, 3).toUpperCase();
