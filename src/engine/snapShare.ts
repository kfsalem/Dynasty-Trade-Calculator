import { SNAP_COLUMNS, type SnapCountsFile, type SnapPlayer } from '../data/types';
import { summarize, type Sample } from './activity';

export { MATERIAL_DELTA, RECENT_WEEKS } from './activity';

/**
 * Season-to-date and last-four-week snap share, per player.
 *
 * The windowing rules — which weeks count, and why a missed week is not a zero
 * — live in `activity.ts`, because target share and carry share have to answer
 * them the same way or the two columns stop being comparable.
 */
export interface SnapShare {
  /** Mean offensive snap share across every week he appeared, 0-1. */
  season: number;
  /** Mean across the recent window, or null if he did not play in it. */
  recent: number | null;
  /** `recent - season`, in share points. Null when there is no recent window. */
  delta: number | null;
  /** Weeks he appeared in, all season. */
  games: number;
  /** Weeks he appeared in during the recent window. */
  recentGames: number;
}

const WEEK = SNAP_COLUMNS.indexOf('week');
const PCT = SNAP_COLUMNS.indexOf('offensePct');

export function snapShare(player: SnapPlayer, throughWeek: number): SnapShare | null {
  const samples: Sample[] = player.weeks.map((week) => ({
    week: week[WEEK],
    value: week[PCT],
  }));

  return summarize(samples, throughWeek);
}

export function snapShares(file: SnapCountsFile): Map<string, SnapShare> {
  const shares = new Map<string, SnapShare>();

  for (const [sleeperId, player] of Object.entries(file.players)) {
    const share = snapShare(player, file.throughWeek ?? 0);
    if (share) shares.set(sleeperId, share);
  }

  return shares;
}
