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
 * Per-position match accounting, split by whether the player has a real role.
 *
 * A silent drop in match rate is how this rots: nflverse renames an id column or
 * DynastyProcess stops publishing a position, and the app quietly loses activity
 * data for a third of receivers while every build stays green.
 *
 * The split exists because the raw rate is close to meaningless as a signal. In
 * an offseason 90-man depth chart the misses are almost entirely camp bodies —
 * matching runs at 99% for the top of a depth chart and 35% at rank 11, giving
 * an overall 83% that no useful threshold can be set against. Measured against
 * players who actually have a role, the same data is 98%, and a threshold there
 * means something.
 */
export interface MatchCounts {
  matched: number;
  unmatched: number;
}

export interface Tally {
  total: MatchCounts;
  byPosition: Record<string, MatchCounts>;
}

export interface UnmatchedPlayer {
  name: string;
  position: string;
  /** What makes this one matter, e.g. "WR2" or "peak 73% snaps". */
  note: string;
  relevant: boolean;
}

export interface MatchStats {
  /** Everyone the source lists at a skill position. */
  all: Tally;
  /** Only players with a role worth valuing. What the build gate reads. */
  relevant: Tally;
  unmatched: UnmatchedPlayer[];
}

const newTally = (): Tally => ({ total: { matched: 0, unmatched: 0 }, byPosition: {} });

export function newMatchStats(): MatchStats {
  return { all: newTally(), relevant: newTally(), unmatched: [] };
}

function tally(into: Tally, position: string, matched: boolean): void {
  const bucket = (into.byPosition[position] ??= { matched: 0, unmatched: 0 });
  if (matched) {
    into.total.matched++;
    bucket.matched++;
  } else {
    into.total.unmatched++;
    bucket.unmatched++;
  }
}

export function recordMatch(
  stats: MatchStats,
  player: {
    position: string;
    sleeperId: string | undefined;
    name: string;
    /** Whether this player's data would reach a valuation at all. */
    relevant: boolean;
    note: string;
  },
): void {
  const matched = Boolean(player.sleeperId);

  tally(stats.all, player.position, matched);
  if (player.relevant) tally(stats.relevant, player.position, matched);

  if (!matched) {
    stats.unmatched.push({
      name: player.name,
      position: player.position,
      note: player.note,
      relevant: player.relevant,
    });
  }
}

export function matchRate(counts: MatchCounts): number {
  const total = counts.matched + counts.unmatched;
  return total === 0 ? 0 : counts.matched / total;
}

export const sampleSize = (counts: MatchCounts): number => counts.matched + counts.unmatched;

/** One rendering of an unmatched player, so the log and the exception agree. */
export const describeUnmatched = (player: UnmatchedPlayer): string =>
  `${player.name} (${player.position}, ${player.note})`;

/**
 * A player seen in a weekly source, held until his best week is known.
 *
 * Whether a player has a role depends on his peak week, and the last row read
 * can still change it — a starter eased in on 8% of snaps in week 1 must not be
 * written off before week 9 is read. So the weekly reducers accumulate here and
 * tally once at the end.
 */
export interface Candidate {
  name: string;
  position: string;
  sleeperId: string | undefined;
  peak: number;
}

export function observe(
  candidates: Map<string, Candidate>,
  key: string,
  player: Omit<Candidate, 'peak'>,
  peak: number,
): void {
  const candidate = candidates.get(key);
  if (candidate) {
    candidate.peak = Math.max(candidate.peak, peak);
    return;
  }
  candidates.set(key, { ...player, peak });
}

export function tallyCandidates(
  candidates: Iterable<Candidate>,
  relevantAt: number,
  note: (peak: number) => string,
): MatchStats {
  const stats = newMatchStats();

  for (const candidate of candidates) {
    recordMatch(stats, {
      position: candidate.position,
      sleeperId: candidate.sleeperId,
      name: candidate.name,
      relevant: candidate.peak >= relevantAt,
      note: note(candidate.peak),
    });
  }

  return stats;
}
