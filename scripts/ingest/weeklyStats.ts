import { iterCsvRows } from '../../src/lib/csv';
import {
  OPPORTUNITY_COLUMNS,
  SKILL_POSITIONS,
  type OpportunityFile,
  type OpportunityWeek,
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
  'player_id',
  'player_display_name',
  'position',
  'season',
  'week',
  'season_type',
  'team',
  'attempts',
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
 * Peak single-week plays the ball went to or through, that counts as a role.
 *
 * Three is low on purpose. This is not a fantasy-relevance bar, it is the line
 * below which whether we resolved a player's id cannot affect any number the
 * app produces.
 *
 * Pass attempts count, and have to. A pocket quarterback takes almost no
 * targets and carries, so a targets-plus-carries bar left real starters outside
 * the gate's denominator — eight of them in 2025, the worst with a 35-attempt,
 * 17-point game. `fantasy_points_ppr` ships in this file and a quarterback's
 * points come from passing, so ignoring attempts contradicts the whole premise
 * that below this line a missing id changes nothing.
 */
const RELEVANT_OPPORTUNITIES = 3;

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
    const sleeperId = gsisId ? crosswalk.byGsis.get(gsisId) : undefined;

    const week = num(row.week);
    const targets = num(row.targets) ?? 0;
    const carries = num(row.carries) ?? 0;
    const attempts = num(row.attempts) ?? 0;

    // Before the guards below, so a row we cannot use counts as a player we
    // failed to resolve rather than leaving the tally entirely.
    observe(
      candidates,
      gsisId ?? `${row.player_display_name}|${row.position}`,
      { name: row.player_display_name, position: row.position, sleeperId },
      targets + carries + attempts,
    );

    if (!sleeperId || week === null) continue;

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

  const stats = tallyCandidates(
    candidates.values(),
    RELEVANT_OPPORTUNITIES,
    (peak) => `peak ${peak} opportunities`,
  );

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
