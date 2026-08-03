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
 */
export const POSITION_STYLES: Record<
  Position,
  { chip: string; bar: string; border: string; label: string }
> = {
  QB: {
    chip: 'bg-blue-100 text-blue-800',
    bar: 'bg-blue-500',
    border: 'border-blue-500',
    label: 'QB',
  },
  RB: {
    chip: 'bg-emerald-100 text-emerald-800',
    bar: 'bg-emerald-500',
    border: 'border-emerald-500',
    label: 'RB',
  },
  WR: {
    chip: 'bg-amber-100 text-amber-800',
    bar: 'bg-amber-500',
    border: 'border-amber-500',
    label: 'WR',
  },
  TE: {
    chip: 'bg-violet-100 text-violet-800',
    bar: 'bg-violet-500',
    border: 'border-violet-500',
    label: 'TE',
  },
  K: {
    chip: 'bg-gray-100 text-gray-700',
    bar: 'bg-gray-400',
    border: 'border-gray-400',
    label: 'K',
  },
  DEF: {
    chip: 'bg-gray-100 text-gray-700',
    bar: 'bg-gray-400',
    border: 'border-gray-400',
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
