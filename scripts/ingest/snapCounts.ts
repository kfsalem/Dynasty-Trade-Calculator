import { iterCsvRows } from '../../src/lib/csv';
import {
  SKILL_POSITIONS,
  SNAP_COLUMNS,
  type SnapCountsFile,
  type SnapWeek,
} from '../../src/data/types';
import { num, requireColumns, round } from './columns';
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
): { file: SnapCountsFile; stats: MatchStats } {
  const players: SnapCountsFile['players'] = {};
  // Match accounting is deferred: whether a player has a role depends on his
  // best week, which is not known until every row has been read.
  const candidates = new Map<string, Candidate>();
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
    if (!SKILL.has(row.position)) continue;

    const pfrId = id(row.pfr_player_id);
    const sleeperId = pfrId ? crosswalk.byPfr.get(pfrId) : undefined;

    const week = num(row.week);
    const snaps = num(row.offense_snaps);
    const pct = num(row.offense_pct);

    // Accounted for before any guard below, so that a row we cannot use counts
    // as a player we failed to resolve rather than vanishing from the tally
    // altogether. Dropping it would let the match rate read 100% while coverage
    // quietly collapsed, which is the exact failure the gate exists to catch.
    observe(
      candidates,
      pfrId ?? `${row.player}|${row.position}`,
      { name: row.player, position: row.position, sleeperId },
      pct ?? 0,
    );

    if (!sleeperId || week === null || snaps === null || pct === null) continue;

    throughWeek = Math.max(throughWeek, week);

    const entry = (players[sleeperId] ??= { pos: row.position, team: row.team, weeks: [] });
    entry.weeks.push([week, snaps, round(pct, 3) ?? 0] satisfies SnapWeek);

    if (week >= (teamAsOf.get(sleeperId) ?? -1)) {
      entry.team = row.team;
      teamAsOf.set(sleeperId, week);
    }
  }

  if (!checked) requireColumns('snap_counts', undefined, REQUIRED);

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
  };
}
