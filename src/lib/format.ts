import type { Position } from '../types';

export const formatValue = (n: number): string => Math.round(n).toLocaleString('en-US');

export const formatAge = (age: number | null): string =>
  age === null ? '—' : `${age.toFixed(1)} yrs`;

/** Tailwind classes per position, used for chips and the breakdown bar. */
export const POSITION_STYLES: Record<Position, { chip: string; bar: string; label: string }> =
  {
    QB: { chip: 'bg-blue-100 text-blue-800', bar: 'bg-blue-500', label: 'QB' },
    RB: { chip: 'bg-emerald-100 text-emerald-800', bar: 'bg-emerald-500', label: 'RB' },
    WR: { chip: 'bg-amber-100 text-amber-800', bar: 'bg-amber-500', label: 'WR' },
    TE: { chip: 'bg-violet-100 text-violet-800', bar: 'bg-violet-500', label: 'TE' },
    K: { chip: 'bg-gray-100 text-gray-700', bar: 'bg-gray-400', label: 'K' },
    DEF: { chip: 'bg-gray-100 text-gray-700', bar: 'bg-gray-400', label: 'DEF' },
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
};

export const formatInjury = (status: string): string =>
  INJURY_ABBREV[status] ?? status.slice(0, 3).toUpperCase();
