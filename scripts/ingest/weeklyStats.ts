import { iterCsvRows } from '../../src/lib/csv';
import {
  OPPORTUNITY_COLUMNS,
  SKILL_POSITIONS,
  type OpportunityFile,
  type OpportunityWeek,
} from '../../src/data/types';
import { num, requireColumns, round } from './columns';
import { id, type Crosswalk, type MatchStats, newMatchStats, recordMatch } from './crosswalk';

const REQUIRED = [
  'player_id',
  'player_display_name',
  'position',
  'season',
  'week',
  'season_type',
  'team',
  'targets',
  'target_share',
  'air_yards_share',
  'wopr',
  'carries',
  'receptions',
  'fantasy_points_ppr',
] as const;

const SKILL = new Set<string>(SKILL_POSITIONS);

/**
 * Peak single-week targets plus carries that counts as having a role.
 *
 * Three is low on purpose. This is not a fantasy-relevance bar, it is the line
 * below which whether we resolved a player's id cannot affect any number the
 * app produces.
 */
const RELEVANT_OPPORTUNITIES = 3;

interface Candidate {
  name: string;
  position: string;
  sleeperId: string | undefined;
  peak: number;
}

/**
 * Reduce nflverse weekly player stats to the opportunity columns.
 *
 * Of the 130-odd columns in the source, thirteen matter here. Target share, air
 * yards share and WOPR are already computed upstream — WOPR in particular is
 * `1.5 × target_share + 0.7 × air_yards_share`, and recomputing it from a
 * reduced file would only introduce a way to get it wrong.
 *
 * Volume columns come along because opportunity is the point: a back's carries
 * and a receiver's targets are what the valuation reads, and fantasy points are
 * kept as the production side to compare them against.
 */
export function reduceWeeklyStats(
  csv: string,
  crosswalk: Crosswalk,
  meta: { season: number; source: string; generatedAt: string },
): { file: OpportunityFile; stats: MatchStats } {
  const players: OpportunityFile['players'] = {};
  // Deferred for the same reason as the snap counts: whether a player has a
  // role depends on his best week, which the last row can still change.
  const candidates = new Map<string, Candidate>();
  const teamAsOf = new Map<string, number>();
  let throughWeek = 0;
  let checked = false;

  for (const row of iterCsvRows(csv)) {
    if (!checked) {
      requireColumns('stats_player_week', row, REQUIRED);
      checked = true;
    }

    if (row.season_type !== 'REG') continue;
    if (!SKILL.has(row.position)) continue;

    const gsisId = id(row.player_id);
    if (!gsisId) continue;

    const sleeperId = crosswalk.byGsis.get(gsisId);

    const week = num(row.week);
    if (week === null) continue;

    const targets = num(row.targets) ?? 0;
    const carries = num(row.carries) ?? 0;

    let candidate = candidates.get(gsisId);
    if (!candidate) {
      candidate = {
        name: row.player_display_name,
        position: row.position,
        sleeperId,
        peak: 0,
      };
      candidates.set(gsisId, candidate);
    }
    candidate.peak = Math.max(candidate.peak, targets + carries);

    if (!sleeperId) continue;

    throughWeek = Math.max(throughWeek, week);

    const entry = (players[sleeperId] ??= { pos: row.position, team: row.team, weeks: [] });
    entry.weeks.push([
      week,
      targets,
      round(num(row.target_share), 4),
      round(num(row.air_yards_share), 4),
      round(num(row.wopr), 4),
      carries,
      num(row.receptions) ?? 0,
      round(num(row.fantasy_points_ppr), 2) ?? 0,
    ] satisfies OpportunityWeek);

    if (week >= (teamAsOf.get(sleeperId) ?? -1)) {
      entry.team = row.team;
      teamAsOf.set(sleeperId, week);
    }
  }

  if (!checked) requireColumns('stats_player_week', undefined, REQUIRED);

  const stats = newMatchStats();
  for (const candidate of candidates.values()) {
    recordMatch(stats, {
      position: candidate.position,
      sleeperId: candidate.sleeperId,
      name: candidate.name,
      relevant: candidate.peak >= RELEVANT_OPPORTUNITIES,
      note: `peak ${candidate.peak} targets+carries`,
    });
  }

  for (const entry of Object.values(players)) {
    entry.weeks.sort((a, b) => a[0] - b[0]);
  }

  return {
    file: {
      generatedAt: meta.generatedAt,
      season: meta.season,
      throughWeek,
      source: meta.source,
      columns: OPPORTUNITY_COLUMNS,
      players,
    },
    stats,
  };
}
