import { iterCsvRows } from '../../src/lib/csv';
import type { ByeWeeksFile } from '../../src/data/types';
import { requireColumns } from './columns';
import { IngestError } from './errors';

/**
 * Bye weeks, derived from the schedule.
 *
 * Nobody publishes a bye-week table. What is published is one row per game, so
 * a bye is an *absence*: a team with no row in a regular-season week. That is
 * why this reduction counts games rather than reading a column, and why the
 * gate below is worth as much as the parse — a filter that quietly matched
 * nothing would produce "every team is on bye", which is a far worse output
 * than no file at all.
 *
 * The source is `nflverse/nfldata` rather than the `nflverse-data` releases the
 * other three datasets use. Both publish this file; the releases copy sends no
 * CORS header and this one does, which is irrelevant here at build time but
 * makes the choice free. See `BYES_URL`.
 */

const REQUIRED = ['season', 'game_type', 'week', 'home_team', 'away_team'] as const;

/** The NFL has played 32 teams since 2002, and a season with any other number is not one. */
const TEAM_COUNT = 32;

/**
 * nflverse team codes that Sleeper spells differently.
 *
 * Verified against both vocabularies on 2026-08-27: nflverse publishes 32 codes
 * for 2024+ and Sleeper's player blob carries 33, and the two agree on every
 * code but one. nflverse writes the Rams `LA`; Sleeper writes `LAR`.
 *
 * That single disagreement is the whole reason this map exists, and it is
 * exactly the kind of mismatch that does not announce itself — an unmapped `LA`
 * produces a file that looks complete, passes every count below, and then never
 * fires a bye for one team's worth of players because no `Player.team` in the
 * app is ever equal to it.
 *
 * Sleeper's extra code is `OAK`, which is not a live team — it is where retired
 * and inactive players who last played for the Raiders sit. It is deliberately
 * not mapped: those players are not on anyone's roster, and inventing a bye for
 * a franchise that has not existed since 2019 would be answering a question
 * nobody asked.
 */
const SLEEPER_TEAM: Record<string, string> = { LA: 'LAR' };

/**
 * Every Sleeper code the reduction is allowed to emit.
 *
 * The gate that makes `SLEEPER_TEAM` maintainable rather than a thing that
 * silently rots: a relocation or a rename upstream fails the build here, naming
 * the code it did not recognise, instead of shipping a bye nothing can match.
 */
const SLEEPER_TEAMS = new Set([
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET',
  'GB', 'HOU', 'IND', 'JAX', 'KC', 'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE',
  'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS',
]);

export interface ByeReduction {
  file: ByeWeeksFile;
  notes: string[];
}

/**
 * Reduce the full schedule to one bye week per team for the newest season.
 *
 * `games.csv` carries every season since 1999 in one file, so unlike the other
 * three datasets there is no per-season URL to resolve — the season is chosen
 * here, from the rows themselves. Newest wins: the schedule for a coming season
 * is published in May, months before week 1, and a bye week is the same fact in
 * May as it is in October.
 */
export function reduceByeWeeks(
  csv: string,
  meta: { source: string; generatedAt: string },
): ByeReduction {
  const rows = iterCsvRows(csv);
  const first = rows.next();
  requireColumns('byes', first.done ? undefined : first.value, REQUIRED);

  /**
   * Collected first, filtered second — because the file is 27 seasons deep and
   * only the newest is wanted.
   *
   * This was one pass until it met the real file. Validating team codes while
   * scanning for the newest season means validating 1999 as well, and in 1999
   * the Raiders were in Oakland, the Rams were in St. Louis and the Chargers
   * were in San Diego. The gate below is right to reject those codes; it simply
   * must never be shown them. Nothing about a franchise that moved twenty years
   * ago has any bearing on who is off this week.
   */
  const games: { season: number; week: number; teams: string[] }[] = [];

  for (const row of [first.value, ...rows]) {
    if (!row || row.game_type !== 'REG') continue;

    const season = Number(row.season);
    const week = Number(row.week);
    if (!Number.isFinite(season) || !Number.isFinite(week)) continue;

    const sides = [row.home_team, row.away_team].filter((team): team is string =>
      Boolean(team),
    );
    if (sides.length === 2) games.push({ season, week, teams: sides });
  }

  const season = games.reduce((newest, game) => Math.max(newest, game.season), 0);

  /** week → teams that played in it. A team absent from a week is on bye. */
  const played = new Map<number, Set<string>>();
  const teams = new Set<string>();

  for (const game of games) {
    if (game.season !== season) continue;

    for (const raw of game.teams) {
      const team = SLEEPER_TEAM[raw] ?? raw;
      if (!SLEEPER_TEAMS.has(team)) {
        throw new IngestError(
          'schema',
          `byes: unrecognised team code "${raw}" in the ${season} schedule. ` +
            `Either a team was renamed or relocated upstream, or nflverse changed ` +
            `its vocabulary — add it to SLEEPER_TEAM in scripts/ingest/byeWeeks.ts ` +
            `once you know which Sleeper code it corresponds to.`,
        );
      }
      teams.add(team);
      const inWeek = played.get(game.week) ?? new Set<string>();
      inWeek.add(team);
      played.set(game.week, inWeek);
    }
  }

  if (season === 0) {
    throw new IngestError(
      'schema',
      'byes: no regular-season rows found. The source parsed but every row was ' +
        'filtered out — check the game_type value, which this reads as "REG".',
    );
  }

  if (teams.size !== TEAM_COUNT) {
    throw new IngestError(
      'schema',
      `byes: the ${season} schedule names ${teams.size} teams, expected ${TEAM_COUNT}. ` +
        `A partial schedule cannot be reduced to byes — every week has to be present ` +
        `before an absence means anything.`,
    );
  }

  const weeks = [...played.keys()].sort((a, b) => a - b);
  const byes: Record<string, number> = {};

  for (const week of weeks) {
    const inWeek = played.get(week) ?? new Set<string>();
    for (const team of teams) {
      if (!inWeek.has(team)) byes[team] = week;
    }
  }

  /**
   * Exactly one bye each, which is the correctness check.
   *
   * Every failure mode this reduction has produces a wrong count here: a
   * partially-published schedule gives a team several byes, a season-type
   * filter that matched too much gives it none. Neither is recoverable and
   * both look fine on a spot check, so the count is the gate.
   */
  const wrong = [...teams].filter(
    (team) => [...weeks].filter((week) => !(played.get(week) ?? new Set()).has(team)).length !== 1,
  );
  if (wrong.length > 0) {
    throw new IngestError(
      'schema',
      `byes: ${wrong.length} of ${TEAM_COUNT} teams do not have exactly one bye in ` +
        `${season} (${wrong.slice(0, 6).join(', ')}${wrong.length > 6 ? ', …' : ''}). ` +
        `The schedule is incomplete or the week range is wrong — reduced ${weeks.length} weeks.`,
    );
  }

  const byeWeeks = [...new Set(Object.values(byes))].sort((a, b) => a - b);

  return {
    file: {
      generatedAt: meta.generatedAt,
      season,
      // The last week any team is off, so the UI can date this the way it dates
      // the weekly datasets. Not a "through" in the sense the others mean it —
      // the schedule is complete or it failed the gate above.
      throughWeek: Math.max(...weeks),
      source: meta.source,
      teams: byes,
    },
    notes: [
      `${season}: ${weeks.length} regular-season weeks, byes in ` +
        `${byeWeeks.join(', ')}`,
    ],
  };
}
