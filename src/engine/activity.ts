/**
 * Shared shape of every weekly activity signal.
 *
 * Snap share, target share, carry share and WOPR are all the same question
 * asked of a different column: what has this been all season, what has it been
 * lately, and is it moving. Keeping one implementation means a change to how
 * the window is drawn cannot apply to one metric and not the others.
 */

/** How many weeks "recent" covers. Four is a month of football. */
export const RECENT_WEEKS = 4;

/**
 * Last week of the regular season, and the one week that never counts.
 *
 * Week 18 does not measure a player's role — it measures playoff seeding. Teams
 * with a locked seed rest their starters and teams still alive do not, so the
 * same 25% of a four-week window means "his job is gone" for one player and
 * nothing at all for another.
 *
 * Left in, it is not a small bias, it is a wrong answer: run against the real
 * 2025 file, the sharpest declines in the league were Josh Allen at 75% snaps
 * from 92%, and the starting quarterbacks in Tennessee and Minnesota alongside
 * him. Every one of them rested a meaningless game, and every one was reported
 * as a collapsing role — which, on the sell-high list, is advice to trade the
 * best quarterback in football because he sat out Week 18.
 *
 * So the recent window ends at Week 17. The season average still counts Week 18,
 * where one game in seventeen cannot do any damage.
 */
export const FINAL_REGULAR_WEEK = 18;

/**
 * Movement below which a delta is noise rather than a role change.
 *
 * Ten points is roughly a rotational back going from a third of the work to
 * half. Under that, week-to-week game script moves the number as much as usage
 * does, and flagging it would train people to ignore the flag.
 */
export const MATERIAL_DELTA = 0.1;

export interface MetricWindow {
  /** Mean across every week with a value, 0-1 for shares. */
  season: number;
  /** Mean across the recent window, or null if he has no week in it. */
  recent: number | null;
  /** `recent - season`. Null when there is no recent window. */
  delta: number | null;
  /** Weeks with a value, all season. */
  games: number;
  /** Weeks with a value inside the recent window. */
  recentGames: number;
}

export interface Sample {
  week: number;
  /** Null where the source published no value for that week. */
  value: number | null;
}

const mean = (values: number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * Season-to-date and recent means over one weekly signal.
 *
 * Weeks with no value are left out of the average rather than counted as zero.
 * A bye, an inactive week and a stint on injured reserve are not a 0% role —
 * they are no data — and averaging them in would quietly punish every player
 * who missed time, which is the opposite of what a role signal is for.
 *
 * The recent window is the last four weeks *of the season*, not a player's last
 * four appearances. That way a starter who has not played since Week 14 reads
 * as having no recent role, which is true, instead of borrowing his October
 * form.
 *
 * It also stops short of Week 18 — see `FINAL_REGULAR_WEEK`. Mid-season this
 * changes nothing, because the window has not reached that far.
 */
export function summarize(samples: Sample[], throughWeek: number): MetricWindow | null {
  const played = samples.filter((sample) => sample.value !== null);
  if (played.length === 0) return null;

  const anchor = Math.min(throughWeek, FINAL_REGULAR_WEEK - 1);
  const recentPlayed = played.filter(
    (sample) => sample.week > anchor - RECENT_WEEKS && sample.week <= anchor,
  );
  const recent =
    recentPlayed.length > 0 ? mean(recentPlayed.map((sample) => sample.value as number)) : null;
  const season = mean(played.map((sample) => sample.value as number));

  return {
    season,
    recent,
    delta: recent === null ? null : recent - season,
    games: played.length,
    recentGames: recentPlayed.length,
  };
}
