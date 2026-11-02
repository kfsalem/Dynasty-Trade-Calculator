import { readFile, writeFile } from 'node:fs/promises';

import { loadAppLeague, type AppLeague } from '../appLeague';
import {
  simulate,
  STRENGTH_DRIFT,
  type OddsContext,
  type ScoringModel,
} from '../../src/engine/playoffOdds';
import {
  snapshotFile,
  snapshotSchema,
  valuesFromRows,
  variantFor,
} from '../../src/values/fantasycalcRows';
import type { ValueBundle } from '../../src/values/fantasycalc';
import type { LeagueSettings, Matchup, SeasonPhase } from '../../src/types';

/**
 * The playoff odds the app states each week, kept so they can be graded (#164).
 *
 * `npm run grade:odds` graded the simulation on six finished seasons and left
 * one question open: early in a season, strength predicted the rest of it more
 * weakly than the model assumes. That replay could not use the app's own
 * strength, because FantasyCalc publishes only today's values, so it stood in
 * a projected lineup, and the weakness may be the stand-in's. The only way to
 * know is to keep what the app actually said, week by week, and grade it after
 * the season. That is this file.
 *
 * **What a point holds.** Everything the simulation was given, not only what it
 * answered: each team's record, points for and strength, the scoring model and
 * the drift, beside the odds it stated. So a grader can test strength against
 * the points that followed, which is the open question, and run a later model
 * on the same inputs. The fixtures are not kept, because Sleeper keeps them.
 *
 * **When.** Only on the weekly refresh, which commits what it writes. A point
 * added on a deploy would ship once and vanish at the next one, so the refresh
 * sets `ODDS_RECORD=append` and nothing else does. The first point of a week is
 * the one kept, because it is the earliest: a second run that week, such as one
 * dispatched by hand after Thursday's game, adds nothing.
 *
 * **Which week Sleeper says it is on a Tuesday is not yet verified.** The app
 * takes the week from `/state/nfl`. If Sleeper has not moved on when the
 * refresh runs, the app is simulating a week already played. Each point keeps
 * `resultsThrough` beside `week` so that shows, and the run's log says so.
 *
 * Strength is priced on the value snapshot this same run wrote, the market the
 * app reads that day. If FantasyCalc did not answer, the snapshot is an old
 * copy, and no point is added rather than one priced on old values.
 *
 * Failure policy is the value history's: nothing here fails a build.
 */

/**
 * The leagues kept. The track record's live league, whose id is already
 * public. Its other league (1235622229488717824) has not renewed for 2026, and
 * a renewal would come with a new id, which would belong here.
 */
export const ODDS_RECORD_LEAGUES = ['1336802780030988288'] as const;

export const ODDS_RECORD_FILE = 'odds-record.json';

const SOURCE =
  'The playoff odds the app would state for each league-week, taken by the weekly refresh (#164). ' +
  'Each team is a row of `columns`; strength is RosterSummary.starterValue, priced on that ' +
  "day's FantasyCalc snapshot.";

export const ODDS_TEAM_COLUMNS = [
  'rosterId',
  'wins',
  'losses',
  'ties',
  'pointsFor',
  'strength',
  'odds',
] as const;

export type OddsTeamRow = [
  rosterId: number,
  wins: number,
  losses: number,
  ties: number,
  pointsFor: number,
  strength: number,
  odds: number,
];

export interface OddsPoint {
  league: string;
  season: number;
  /** The week the app treated as current, and so the first one it simulated. */
  week: number;
  /**
   * The last week whose every fixture had points when this was taken. One
   * below `week` is the normal case. Equal or above means the week simulated
   * from already had results: a week in progress, or Sleeper not yet moved on.
   */
  resultsThrough: number;
  takenAt: string;
  /** When the values that priced strength were fetched. */
  valuesAt: string;
  playoffTeams: number;
  playoffWeekStart: number;
  drift: number;
  model: ScoringModel;
  teams: OddsTeamRow[];
}

export interface OddsRecordFile {
  generatedAt: string;
  source: string;
  columns: typeof ODDS_TEAM_COLUMNS;
  points: OddsPoint[];
}

export const emptyOddsRecord = (): OddsRecordFile => ({
  generatedAt: '',
  source: SOURCE,
  columns: ODDS_TEAM_COLUMNS,
  points: [],
});

/** What a point is made from, narrowed from `AppLeague` so it can be built by hand in a test. */
export interface OddsSource {
  leagueId: string;
  /** The season the league plays. */
  leagueSeason: string;
  /** The season the NFL is in, by Sleeper's `/state/nfl`. */
  currentSeason: string;
  phase: SeasonPhase;
  week: number | null;
  weeksTotal: number;
  playoffWeekStart: number;
  odds: OddsContext | undefined;
  matchups: readonly Matchup[];
  /** Epoch milliseconds. */
  valuesAt: number;
}

export const oddsSource = (leagueId: string, app: AppLeague): OddsSource => ({
  leagueId,
  leagueSeason: app.bundle.league.season,
  currentSeason: app.bundle.currentSeason,
  phase: app.bundle.seasonPhase,
  week: app.week,
  weeksTotal: app.weeksTotal,
  playoffWeekStart: app.bundle.league.settings.playoffWeekStart,
  odds: app.odds,
  matchups: app.schedule?.matchups ?? [],
  valuesAt: app.values.fetchedAt,
});

const round = (n: number, places: number): number => {
  const scale = 10 ** places;
  return Math.round(n * scale) / scale;
};

/**
 * The last week of an unbroken run from week 1 in which every fixture has
 * points. A week with any points counts, so in the middle of a week this
 * includes the week in progress; on a Tuesday it is the week just finished.
 */
export function resultsThrough(matchups: readonly Matchup[], weeksTotal: number): number {
  let through = 0;
  for (let week = 1; week <= weeksTotal; week++) {
    const games = matchups.filter((m) => m.week === week);
    if (games.length === 0 || games.some((g) => g.points === null)) break;
    through = week;
  }
  return through;
}

export type Stated = { point: OddsPoint } | { skip: string };

/**
 * The odds the app would state for this league now, and what they were stated
 * on, or why it would state none. The app shows odds only in the regular
 * season; these are the same odds, from the same input, by the same `simulate`.
 */
export function statedOdds(source: OddsSource, takenAt: string): Stated {
  const { odds, week } = source;
  if (source.leagueSeason !== source.currentSeason) {
    return { skip: `the league plays ${source.leagueSeason}, not ${source.currentSeason}` };
  }
  if (source.phase !== 'regular') return { skip: `no regular season under way (${source.phase})` };
  if (week === null) return { skip: 'Sleeper did not say what week it is' };
  if (week > source.weeksTotal) {
    return { skip: `the regular season ended with week ${source.weeksTotal}` };
  }
  if (!odds || odds.remaining.length === 0) return { skip: 'no fixtures left to simulate' };

  const stated = new Map(simulate(odds).map((o) => [o.rosterId, o.odds]));
  const teams: OddsTeamRow[] = [...odds.teams]
    .sort((a, b) => a.rosterId - b.rosterId)
    .map((t) => [
      t.rosterId,
      t.wins,
      t.losses,
      t.ties,
      round(t.pointsFor, 2),
      round(t.strength, 1),
      round(stated.get(t.rosterId) ?? 0, 4),
    ]);
  const { model } = odds;

  return {
    point: {
      league: source.leagueId,
      season: Number(source.leagueSeason),
      week,
      resultsThrough: resultsThrough(source.matchups, source.weeksTotal),
      takenAt,
      valuesAt: new Date(source.valuesAt).toISOString(),
      playoffTeams: odds.playoffTeams,
      playoffWeekStart: source.playoffWeekStart,
      drift: STRENGTH_DRIFT,
      model: {
        ...model,
        pointsPerSD: round(model.pointsPerSD, 3),
        weeklySD: round(model.weeklySD, 3),
        baseline: round(model.baseline, 3),
        weight: round(model.weight, 3),
      },
      teams,
    },
  };
}

const pointKey = (p: Pick<OddsPoint, 'league' | 'season' | 'week'>): string =>
  `${p.league}:${p.season}:${p.week}`;

/**
 * Add a point unless its league-week is already kept. Returns a new file; the
 * one passed in is not changed. Points are kept in league, season, week order.
 */
export function addPoint(
  file: OddsRecordFile,
  point: OddsPoint,
  generatedAt: string,
): { file: OddsRecordFile; added: boolean } {
  const key = pointKey(point);
  if (file.points.some((p) => pointKey(p) === key)) return { file, added: false };
  const points = [...file.points, point].sort(
    (a, b) => a.league.localeCompare(b.league) || a.season - b.season || a.week - b.week,
  );
  return { file: { ...file, generatedAt, points }, added: true };
}

/** The value snapshot this run wrote for the league's format, refused if it is older than the run. */
async function freshSnapshot(
  outDir: string,
  settings: LeagueSettings,
  generatedAt: string,
): Promise<ValueBundle> {
  const name = snapshotFile(variantFor(settings));
  const file = snapshotSchema.parse(JSON.parse(await readFile(`${outDir}${name}`, 'utf8')));
  if (file.generatedAt !== generatedAt) {
    throw new Error(`${name} is from ${file.generatedAt}, not this run, so strength would be priced on old values`);
  }
  return { bySleeperId: valuesFromRows(file), rawMax: file.rawMax, fetchedAt: Date.parse(file.generatedAt) };
}

const fromSnapshot = async (
  leagueId: string,
  outDir: string,
  generatedAt: string,
): Promise<OddsSource> =>
  oddsSource(
    leagueId,
    await loadAppLeague(leagueId, {
      dataDir: outDir,
      values: (settings) => freshSnapshot(outDir, settings, generatedAt),
    }),
  );

/** The committed record, a new one if there is none, or null if it is there and unreadable. */
async function readRecord(path: string): Promise<OddsRecordFile | null> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return emptyOddsRecord();
  }
  try {
    return JSON.parse(text) as OddsRecordFile;
  } catch {
    return null;
  }
}

export async function appendOddsRecord(
  outDir: string,
  generatedAt: string,
  load: (leagueId: string) => Promise<OddsSource> = (leagueId) =>
    fromSnapshot(leagueId, outDir, generatedAt),
): Promise<void> {
  if (process.env.ODDS_RECORD !== 'append') {
    console.log('  odds  left as committed (ODDS_RECORD is not "append")');
    return;
  }
  const path = `${outDir}${ODDS_RECORD_FILE}`;
  let record = await readRecord(path);
  if (!record) {
    // Starting again from nothing would throw away every week already kept.
    console.warn(`  odds  ${ODDS_RECORD_FILE} does not parse — keeping the committed file`);
    return;
  }

  let added = 0;
  for (const leagueId of ODDS_RECORD_LEAGUES) {
    try {
      const stated = statedOdds(await load(leagueId), generatedAt);
      if ('skip' in stated) {
        console.log(`  odds  ${leagueId}: nothing kept, ${stated.skip}`);
        continue;
      }
      const { point } = stated;
      const next = addPoint(record, point, generatedAt);
      const already =
        point.resultsThrough >= point.week
          ? `; week ${point.week} already has points in, so the app simulated a week under way or over`
          : '';
      console.log(
        `  odds  ${leagueId}: ${point.season} week ${point.week} ` +
          `${next.added ? 'kept' : 'already kept'}, results through week ${point.resultsThrough}${already}`,
      );
      if (next.added) {
        record = next.file;
        added++;
      }
    } catch (err) {
      console.warn(
        `  odds  ${leagueId}: ${err instanceof Error ? err.message : String(err)} — nothing kept`,
      );
    }
  }
  if (added === 0) return;

  const text = `${JSON.stringify(record)}\n`;
  await writeFile(path, text);
  console.log(
    `  odds  ${record.points.length} league-weeks kept, ${(text.length / 1024).toFixed(1)} KB`,
  );
}
