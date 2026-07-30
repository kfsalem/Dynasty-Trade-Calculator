import { iterCsvRows } from '../../src/lib/csv';
import { requireColumns, requireRows } from './columns';
import { CROSSWALK_URL, fetchText } from './sources';

/**
 * Sleeper ids, keyed by the ids nflverse actually publishes.
 *
 * Every nflverse dataset keys on a different id and none of them is Sleeper's:
 * snap counts use `pfr_player_id`, weekly stats use gsis `player_id`, depth
 * charts use `gsis_id`. The app runs on Sleeper ids end to end, so the mapping
 * happens once here and the shipped JSON is already Sleeper-keyed.
 */
export interface Crosswalk {
  byGsis: Map<string, string>;
  byPfr: Map<string, string>;
  /** Depth charts carry an ESPN id natively, and reach players gsis has not seen yet. */
  byEspn: Map<string, string>;
  /** Rows carrying a Sleeper id at all. */
  rows: number;
}

const REQUIRED = ['sleeper_id', 'gsis_id', 'pfr_id', 'espn_id'] as const;

/**
 * DynastyProcess writes the literal string `NA` for a missing id, not a blank.
 *
 * Worth being blunt about, because a truthiness check passes it: treating `NA`
 * as a real id silently collects every unmapped player into one bucket, and the
 * result is a single fictional player carrying a dozen others' weeks.
 */
export function id(value: string | undefined): string | null {
  return value && value !== 'NA' ? value : null;
}

export function parseCrosswalk(csv: string): Crosswalk {
  const byGsis = new Map<string, string>();
  const byPfr = new Map<string, string>();
  const byEspn = new Map<string, string>();
  let rows = 0;
  let checked = false;

  for (const row of iterCsvRows(csv)) {
    if (!checked) {
      requireColumns('db_playerids.csv', row, REQUIRED);
      checked = true;
    }

    const sleeper = id(row.sleeper_id);
    if (!sleeper) continue;
    rows++;

    // First row wins. The file carries a handful of duplicate source ids for
    // players who moved between id systems, and the later row is the stale one.
    const gsis = id(row.gsis_id);
    const pfr = id(row.pfr_id);
    const espn = id(row.espn_id);
    if (gsis && !byGsis.has(gsis)) byGsis.set(gsis, sleeper);
    if (pfr && !byPfr.has(pfr)) byPfr.set(pfr, sleeper);
    if (espn && !byEspn.has(espn)) byEspn.set(espn, sleeper);
  }

  // No rows at all never reached the column check above.
  if (!checked) requireColumns('db_playerids.csv', undefined, REQUIRED);
  return { byGsis, byPfr, byEspn, rows };
}

/** Half the crosswalk has no Sleeper id at all, so the floor is well under its row count. */
const MIN_CROSSWALK_PLAYERS = 4000;

export async function loadCrosswalk(): Promise<Crosswalk> {
  const crosswalk = parseCrosswalk(await fetchText(CROSSWALK_URL));
  requireRows('db_playerids.csv', crosswalk.rows, MIN_CROSSWALK_PLAYERS);
  return crosswalk;
}

/**
 * Per-position match accounting.
 *
 * A silent drop in match rate is how this rots: nflverse renames an id column or
 * DynastyProcess stops publishing a position, and the app quietly loses activity
 * data for a third of receivers while every build stays green.
 */
export interface MatchStats {
  matched: number;
  unmatched: number;
  byPosition: Record<string, { matched: number; unmatched: number }>;
  /** Names of unmatched players, so they can be eyeballed rather than guessed at. */
  unmatchedNames: string[];
}

export function newMatchStats(): MatchStats {
  return { matched: 0, unmatched: 0, byPosition: {}, unmatchedNames: [] };
}

export function recordMatch(
  stats: MatchStats,
  position: string,
  sleeperId: string | undefined,
  name: string,
): void {
  const bucket = (stats.byPosition[position] ??= { matched: 0, unmatched: 0 });

  if (sleeperId) {
    stats.matched++;
    bucket.matched++;
    return;
  }

  stats.unmatched++;
  bucket.unmatched++;
  stats.unmatchedNames.push(`${name} (${position})`);
}

export function matchRate(stats: { matched: number; unmatched: number }): number {
  const total = stats.matched + stats.unmatched;
  return total === 0 ? 0 : stats.matched / total;
}
