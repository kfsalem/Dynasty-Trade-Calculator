import type { ByeWeeksFile } from '../data/types';

/**
 * Who is off this week.
 *
 * A bye is the cheapest lineup mistake there is and the easiest to miss: the
 * player is healthy, carries no designation, and scores nothing. Until this
 * existed the lineup panel would confidently recommend him — and disclaim the
 * omission three lines above the recommendation, which is not the same as
 * catching it.
 *
 * Everything here is a gate. The bye file is a fact about one season's
 * schedule, and applying it to any other season is worse than not applying it
 * at all: a wrong bye silently deletes a healthy starter from a lineup, which
 * is the exact failure the feature exists to prevent, inverted. So the answer
 * is null — no claim — unless every question below has an answer.
 */

/**
 * Teams on bye in `week` of `playedSeason`, as Sleeper team codes.
 *
 * **Null and empty are different answers, and the panel says different things
 * about them.** An empty set is a real result: 2026 has no byes at all in weeks
 * 1-4, 12, or 15-18, so "checked, nobody is off" is the correct answer for a
 * third of the season. Null is the absence of an answer.
 *
 * Collapsing the two was the first version of this, and it made the lineup
 * panel tell a manager in week 12 that bye weeks could not be loaded — a false
 * statement about working data, in the sentence whose whole job is to say what
 * the panel does and does not check.
 *
 * Null whenever the app cannot be sure, which is four distinct situations:
 *
 * - **No file.** The ingest failed and fell back, or the fetch was blocked.
 *   `load.ts` returns null rather than throwing, and this inherits that policy.
 * - **No week.** The platform does not know what week it is. Guessing one is
 *   how a lineup gets a bye from the wrong Sunday.
 * - **No season.** Same reasoning, one level up.
 * - **The file describes a different season.** The schedule is published in
 *   May, so through the spring this file is next year's while the app is still
 *   looking at last year's rosters — and byes move every season. This is the
 *   same check `useLeagueData` already makes before feeding snap shares into
 *   valuation, for the same reason: data from the wrong year is not stale, it
 *   is wrong.
 *
 * The caller decides whether a bye is even a sensible question. Out of season
 * there is no "this week" and `WeeklyLineup` does not ask.
 */
export function byeTeams(
  file: ByeWeeksFile | null | undefined,
  playedSeason: number | null,
  week: number | null,
): Set<string> | null {
  if (!file || week === null || playedSeason === null) return null;
  if (file.season !== playedSeason) return null;

  const off = new Set<string>();
  for (const [team, byeWeek] of Object.entries(file.teams)) {
    if (byeWeek === week) off.add(team);
  }
  return off;
}

/**
 * Is this player's team off this week?
 *
 * A player with no team — a free agent on somebody's bench, which the roster
 * lists like anyone else — is never on bye. He is not playing for a different
 * reason, and `canPlayThisWeek` is not the function that catches it either;
 * his value is simply zero. Saying "on bye" about him would be a false
 * sentence in the one place this app writes sentences about causes.
 */
export const onBye = (team: string | null, off: ReadonlySet<string>): boolean =>
  team !== null && off.has(team);
