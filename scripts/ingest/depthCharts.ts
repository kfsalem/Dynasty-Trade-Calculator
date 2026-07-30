import { iterCsvRows } from '../../src/lib/csv';
import { SKILL_POSITIONS, type DepthChartsFile } from '../../src/data/types';
import { num, requireColumns } from './columns';
import { id, type Crosswalk, type MatchStats, newMatchStats, recordMatch } from './crosswalk';

const REQUIRED = [
  'dt',
  'team',
  'player_name',
  'gsis_id',
  'espn_id',
  'pos_grp',
  'pos_abb',
  'pos_rank',
] as const;

const SKILL = new Set<string>(SKILL_POSITIONS);

interface Snapshot {
  dt: string;
  rows: {
    gsis: string | null;
    espn: string | null;
    name: string;
    pos: string;
    rank: number;
  }[];
}

/**
 * Reduce the depth chart file to the current chart.
 *
 * This is the 53 MB file that forced the whole build-time ingest. Its size is
 * not depth — it is *history*: nflverse appends a fresh full-league chart every
 * few hours and never prunes, so the 2025 file holds 132 snapshots of the same
 * ~3,000 rows. Keeping only the newest turns 53 MB into about 1,400 players.
 *
 * The newest chart is resolved per team rather than globally. All 32 teams
 * happened to share one timestamp when this was checked, but a single team
 * republishing a minute later would otherwise silently drop the other 31.
 *
 * Rank comes from `pos_rank` within team and position, which is already a clean
 * 1..N depth ordering. `pos_slot` is not that — receivers cycle across three
 * alignment slots, so the WR3 on a chart sits at slot 8 with rank 3.
 */
export function reduceDepthCharts(
  csv: string,
  crosswalk: Crosswalk,
  meta: { season: number; source: string; generatedAt: string },
): { file: DepthChartsFile; stats: MatchStats } {
  const latest = new Map<string, Snapshot>();
  let checked = false;

  for (const row of iterCsvRows(csv)) {
    if (!checked) {
      requireColumns('depth_charts', row, REQUIRED);
      checked = true;
    }

    if (!SKILL.has(row.pos_abb)) continue;

    const rank = num(row.pos_rank);
    const gsis = id(row.gsis_id);
    const espn = id(row.espn_id);
    if (rank === null || !row.team || (!gsis && !espn)) continue;

    const current = latest.get(row.team);

    // Anything older than the newest chart seen for this team is history.
    if (current && row.dt < current.dt) continue;
    if (!current || row.dt > current.dt) {
      latest.set(row.team, { dt: row.dt, rows: [] });
    }

    latest.get(row.team)!.rows.push({
      gsis,
      espn,
      name: row.player_name,
      pos: row.pos_abb,
      rank,
    });
  }

  if (!checked) requireColumns('depth_charts', undefined, REQUIRED);

  const players: DepthChartsFile['players'] = {};
  const stats = newMatchStats();
  let asOf = '';

  for (const [team, snapshot] of latest) {
    if (snapshot.dt > asOf) asOf = snapshot.dt;

    for (const row of snapshot.rows) {
      // gsis first, then ESPN. A rookie who has not played an NFL snap yet has
      // no gsis id in the crosswalk but does have an ESPN one, and offseason
      // charts are mostly rookies — matching on gsis alone loses a quarter of
      // the chart every summer.
      const sleeperId =
        (row.gsis ? crosswalk.byGsis.get(row.gsis) : undefined) ??
        (row.espn ? crosswalk.byEspn.get(row.espn) : undefined);
      recordMatch(stats, row.pos, sleeperId, row.name);
      if (!sleeperId) continue;

      // A player listed at two positions keeps the higher spot on the chart.
      const existing = players[sleeperId];
      if (existing && existing.rank <= row.rank) continue;

      players[sleeperId] = { team, pos: row.pos, rank: row.rank };
    }
  }

  return {
    file: {
      generatedAt: meta.generatedAt,
      season: meta.season,
      throughWeek: null,
      source: meta.source,
      asOf,
      players,
    },
    stats,
  };
}
