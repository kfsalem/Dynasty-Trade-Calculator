import { iterCsvRows } from '../../src/lib/csv';
import {
  SKILL_POSITIONS,
  SNAP_COLUMNS,
  type SnapCountsFile,
  type SnapWeek,
} from '../../src/data/types';
import { num, requireColumns, round } from './columns';
import { id, type Crosswalk, type MatchStats, newMatchStats, recordMatch } from './crosswalk';

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
  const stats = newMatchStats();
  const seen = new Set<string>();
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
    if (!pfrId) continue;

    const sleeperId = crosswalk.byPfr.get(pfrId);

    // Count each player once, not once per week he appears.
    if (!seen.has(pfrId)) {
      seen.add(pfrId);
      recordMatch(stats, row.position, sleeperId, row.player);
    }
    if (!sleeperId) continue;

    const week = num(row.week);
    const snaps = num(row.offense_snaps);
    const pct = num(row.offense_pct);
    if (week === null || snaps === null || pct === null) continue;

    throughWeek = Math.max(throughWeek, week);

    const entry = (players[sleeperId] ??= { pos: row.position, team: row.team, weeks: [] });
    entry.weeks.push([week, snaps, round(pct, 3) ?? 0] satisfies SnapWeek);

    if (week >= (teamAsOf.get(sleeperId) ?? -1)) {
      entry.team = row.team;
      teamAsOf.set(sleeperId, week);
    }
  }

  if (!checked) requireColumns('snap_counts', undefined, REQUIRED);

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
