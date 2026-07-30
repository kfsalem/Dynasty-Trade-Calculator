import { SNAP_COLUMNS, type SnapCountsFile, type SnapPlayer } from '../data/types';

/** How many weeks "recent" covers. Four is a month of football. */
export const RECENT_WEEKS = 4;

/**
 * Snap share below which a delta is noise rather than a role change.
 *
 * Ten points is roughly a rotational back going from a third of the snaps to
 * half. Under that, week-to-week game script moves the number as much as usage
 * does, and flagging it would train people to ignore the flag.
 */
export const MATERIAL_DELTA = 0.1;

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

const mean = (values: number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * Season-to-date and last-four-week snap share for one player.
 *
 * Weeks he does not appear in are left out of the average rather than counted
 * as zero. A bye week, an inactive week and a week on injured reserve are not
 * a 0% role — they are no data — and averaging them in would quietly punish
 * every player who missed time, which is the opposite of what a role signal is
 * for. `games` carries the sample size so a thin one stays visible.
 *
 * The recent window is the last four weeks *of the season*, not his last four
 * appearances. That way a starter who has not played since Week 14 reads as
 * having no recent role, which is true, instead of borrowing his October form.
 */
export function snapShare(player: SnapPlayer, throughWeek: number): SnapShare | null {
  if (player.weeks.length === 0) return null;

  const all = player.weeks.map((week) => week[PCT]);
  const recentWeeks = player.weeks.filter((week) => week[WEEK] > throughWeek - RECENT_WEEKS);
  const recent = recentWeeks.length > 0 ? mean(recentWeeks.map((week) => week[PCT])) : null;
  const season = mean(all);

  return {
    season,
    recent,
    delta: recent === null ? null : recent - season,
    games: all.length,
    recentGames: recentWeeks.length,
  };
}

export function snapShares(file: SnapCountsFile): Map<string, SnapShare> {
  const shares = new Map<string, SnapShare>();

  for (const [sleeperId, player] of Object.entries(file.players)) {
    const share = snapShare(player, file.throughWeek ?? 0);
    if (share) shares.set(sleeperId, share);
  }

  return shares;
}
