import { iterCsvRows } from '../../src/lib/csv';
import {
  SKILL_POSITIONS,
  SNAP_COLUMNS,
  type SnapCountsFile,
  type SnapWeek,
} from '../../src/data/types';
import { num, requireColumns, round } from './columns';
import { IngestError } from './errors';
import {
  id,
  observe,
  tallyCandidates,
  type Candidate,
  type Crosswalk,
  type MatchStats,
} from './crosswalk';

const REQUIRED = [
  'season',
  'week',
  'game_type',
  'player',
  'pfr_player_id',
  'position',
  'team',
  'offense_snaps',
  'offense_pct',
] as const;

const SKILL = new Set<string>(SKILL_POSITIONS);

/**
 * Peak single-week snap share that counts as having a role.
 *
 * A quarter of a team's offensive snaps in at least one game is roughly the
 * line between a rotational contributor and a body. Below it, whether we
 * resolved the player's id has no bearing on any valuation.
 */
const RELEVANT_SNAP_PCT = 0.25;

/**
 * Snap counts carry Pro Football Reference *roster* positions, not fantasy
 * ones — the only nflverse file that does. So a running back can arrive as HB,
 * and did: Chase Brown and Samaje Perine were dropped from the shipped data
 * entirely until this map existed, because HB is not in SKILL_POSITIONS.
 */
const POSITION_ALIASES: Record<string, string> = { HB: 'RB' };

/**
 * Offensive positions knowingly skipped. Linemen take most of a team's snaps,
 * so they cannot be filtered by usage — they have to be named.
 */
const IGNORED_POSITIONS = new Set(['T', 'OT', 'LT', 'RT', 'G', 'OG', 'LG', 'RG', 'C', 'OL']);

/**
 * Players at one unrecognized position that turns a report into a build
 * failure. A handful is a converted receiver taking snaps at cornerback; a
 * hundred is a position code we stopped understanding.
 */
const UNKNOWN_POSITION_LIMIT = 10;

/**
 * Reduce nflverse snap counts to one entry per Sleeper-keyed skill player.
 *
 * Drops the ~85% of rows belonging to linemen and defenders, and keeps every
 * regular-season week rather than pre-aggregating. The season-to-date versus
 * last-four-weeks split the valuation wants is a windowing decision, and baking
 * one window in here would mean re-running the ingest to change it.
 */
export function reduceSnapCounts(
  csv: string,
  crosswalk: Crosswalk,
  meta: { season: number; source: string; generatedAt: string },
): { file: SnapCountsFile; stats: MatchStats; notes: string[] } {
  const players: SnapCountsFile['players'] = {};
  // Match accounting is deferred: whether a player has a role depends on his
  // best week, which is not known until every row has been read.
  const candidates = new Map<string, Candidate>();
  /** Peak snap share per player at a position we do not recognize. */
  const unknown = new Map<string, Map<string, number>>();
  /** Week the current `team` came from, so a mid-season trade lands the right way. */
  const teamAsOf = new Map<string, number>();
  let throughWeek = 0;
  let checked = false;

  for (const row of iterCsvRows(csv)) {
    if (!checked) {
      requireColumns('snap_counts', row, REQUIRED);
      checked = true;
    }

    if (row.game_type !== 'REG') continue;

    const position = POSITION_ALIASES[row.position] ?? row.position;
    const pfrId = id(row.pfr_player_id);
    const pct = num(row.offense_pct);

    if (!SKILL.has(position)) {
      if (!IGNORED_POSITIONS.has(position)) {
        const peaks = unknown.get(position) ?? new Map<string, number>();
        const key = pfrId ?? row.player;
        peaks.set(key, Math.max(peaks.get(key) ?? 0, pct ?? 0));
        unknown.set(position, peaks);
      }
      continue;
    }

    const sleeperId = pfrId ? crosswalk.byPfr.get(pfrId) : undefined;

    const week = num(row.week);
    const snaps = num(row.offense_snaps);

    // Accounted for before any guard below, so that a row we cannot use counts
    // as a player we failed to resolve rather than vanishing from the tally
    // altogether. Dropping it would let the match rate read 100% while coverage
    // quietly collapsed, which is the exact failure the gate exists to catch.
    observe(
      candidates,
      pfrId ?? `${row.player}|${position}`,
      { name: row.player, position, sleeperId },
      pct ?? 0,
    );

    if (!sleeperId || week === null || snaps === null || pct === null) continue;

    throughWeek = Math.max(throughWeek, week);

    const entry = (players[sleeperId] ??= { pos: position, team: row.team, weeks: [] });
    entry.weeks.push([week, snaps, round(pct, 3) ?? 0] satisfies SnapWeek);

    if (week >= (teamAsOf.get(sleeperId) ?? -1)) {
      entry.team = row.team;
      teamAsOf.set(sleeperId, week);
    }
  }

  if (!checked) requireColumns('snap_counts', undefined, REQUIRED);

  const notes = reportUnknownPositions(unknown);

  const stats = tallyCandidates(
    candidates.values(),
    RELEVANT_SNAP_PCT,
    (peak) => `peak ${Math.round(peak * 100)}% snaps`,
  );

  // Rows arrive game by game, which is close to week order but not guaranteed.
  for (const entry of Object.values(players)) {
    entry.weeks.sort((a, b) => a[0] - b[0]);
  }

  return {
    file: {
      generatedAt: meta.generatedAt,
      season: meta.season,
      throughWeek,
      source: meta.source,
      columns: SNAP_COLUMNS,
      players,
    },
    stats,
    notes,
  };
}

/**
 * Report position codes that took real offensive snaps and were not ingested.
 *
 * This is the check the match gate cannot make. Anything filtered out by
 * position never reaches the tally at all, so a code we stopped recognizing is
 * invisible to every rate: the players that remain still match fine, the row
 * count still clears its floor, and the build stays green having quietly
 * dropped a position. HB is exactly that — two running backs missing from the
 * shipped data with nothing anywhere to say so.
 *
 * Players with no offensive role are not counted, which is what keeps this
 * quiet: defenders appear on every snap report with zero offensive snaps.
 */
function reportUnknownPositions(unknown: Map<string, Map<string, number>>): string[] {
  const notes: string[] = [];

  for (const [position, peaks] of unknown) {
    const withRole = [...peaks.values()].filter((peak) => peak >= RELEVANT_SNAP_PCT).length;
    if (withRole === 0) continue;

    if (withRole >= UNKNOWN_POSITION_LIMIT) {
      throw new IngestError(
        'schema',
        `snap_counts: ${withRole} players listed at "${position}" took a real share of ` +
          `their team's offensive snaps, and "${position}" is not a position this ingests. ` +
          `That many means the source renamed a position rather than that a few players ` +
          `moved — add it to POSITION_ALIASES or IGNORED_POSITIONS in snapCounts.ts.`,
      );
    }

    notes.push(
      `${withRole} of ${peaks.size} players at "${position}" took real offensive snaps ` +
        `but are not an ingested position`,
    );
  }

  return notes;
}
