/**
 * How often the lineup panel's calls come true (#164).
 *
 * Every "start X over Y" row states a chance, `outscoreChance` of the
 * projection gap. That curve was fitted on all startable pairs, and the rows
 * the panel prints are not a random sample of those: they are the slots where
 * the manager and the projection disagree, which is where calls are close. So
 * the weekly ingest replays the panel over every finished week of two real
 * leagues and grades each call against what Sleeper paid
 * (`scripts/ingest/trackRecord`). This is what the app does with the result.
 *
 * Built at ingest time across the test leagues rather than in the browser for
 * the reader's own league, because one league makes about a hundred calls a
 * season, too few to read most buckets.
 */

/**
 * The graded calls, one row each.
 *
 * - `chance`: what the panel stated, in thousandths.
 * - `hit`: 1 when the man it would start outscored the man it would sit.
 * - `decisive`: 1 when the panel states it as a change to make.
 * - `fact`: 1 when the man it would sit was on bye or projected for nothing.
 *   The curve prints a chance for those from the newcomer's projection alone,
 *   which is not the question it answers, so they are reported apart.
 */
export const TRACK_RECORD_COLUMNS = [
  'season',
  'week',
  'league',
  'position',
  'chance',
  'hit',
  'decisive',
  'fact',
] as const;

export type TrackRecordRow = [
  season: number,
  week: number,
  league: number,
  position: string,
  chance: number,
  hit: 0 | 1,
  decisive: 0 | 1,
  fact: 0 | 1,
];

export interface TrackRecordFile {
  generatedAt: string;
  columns: typeof TRACK_RECORD_COLUMNS;
  /** How many leagues were replayed. Their ids stay in the ingest. */
  leagues: number;
  /**
   * Every league-week already graded, as `leagueIndex:season:week`, including
   * weeks that produced no call. A finished week never changes, so the ingest
   * fetches only weeks missing from here.
   */
  graded: string[];
  rows: TrackRecordRow[];
}

export const TRACK_RECORD_FILE = 'track-record.json';

/** The ranges of stated chance the record is read in. */
export const BUCKETS = [0.5, 0.55, 0.6, 0.7, 0.8, 0.9, 1] as const;

/**
 * Below this a bucket is shown with its count and no rate. A 95% interval on
 * thirty calls is still about ±17 points, which is as wide as a reading can be
 * and still say anything.
 */
export const THIN = 30;

export interface Tally {
  calls: number;
  hits: number;
  /** The mean stated chance, 0–1. */
  stated: number;
  /** The share that came true, with a 95% Wilson interval. */
  rate: number;
  low: number;
  high: number;
}

export interface Bucket extends Tally {
  from: number;
  to: number;
}

export interface TrackRecordSummary {
  /** Calls that bench a man projected to play: the projection's opinion. */
  opinions: Tally;
  /** Those of them the panel states as a change to make. */
  decisive: Tally;
  /** Calls that bench a man on bye or projected for nothing. */
  facts: Tally;
  buckets: Bucket[];
  seasons: number[];
  weeks: number;
  leagues: number;
}

/**
 * A 95% Wilson interval, so a small sample says it is small. The normal
 * approximation would print eighteen hits in eighteen as certain.
 */
export function wilson(hits: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.96;
  const p = hits / n;
  const centre = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export function tally(rows: readonly TrackRecordRow[]): Tally {
  const calls = rows.length;
  const hits = rows.filter((row) => row[5] === 1).length;
  const stated = calls ? rows.reduce((sum, row) => sum + row[4], 0) / calls / 1000 : 0;
  const [low, high] = wilson(hits, calls);
  return { calls, hits, stated, rate: calls ? hits / calls : 0, low, high };
}

export function summarize(file: TrackRecordFile): TrackRecordSummary {
  const opinions = file.rows.filter((row) => row[7] === 0);
  const buckets: Bucket[] = [];
  for (let i = 0; i < BUCKETS.length - 1; i++) {
    const from = BUCKETS[i];
    const to = BUCKETS[i + 1];
    // The last bucket is closed, so a call stated at certainty has somewhere to go.
    const inside = opinions.filter((row) => {
      const chance = row[4] / 1000;
      return chance >= from && (chance < to || (to === 1 && chance <= to));
    });
    if (inside.length) buckets.push({ from, to, ...tally(inside) });
  }
  return {
    opinions: tally(opinions),
    decisive: tally(opinions.filter((row) => row[6] === 1)),
    facts: tally(file.rows.filter((row) => row[7] === 1)),
    buckets,
    seasons: [...new Set(file.graded.map((key) => Number(key.split(':')[1])))].sort(),
    weeks: file.graded.length,
    leagues: file.leagues,
  };
}
