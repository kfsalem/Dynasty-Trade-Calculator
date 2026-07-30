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

/**
 * Depth rank at or above which a chart entry counts as having a role.
 *
 * Three covers the QB1-3, the top of a backfield, the slot receiver and the
 * second tight end. Below it a chart is camp bodies: matching runs at 99% for
 * rank 1 and 35% by rank 11, so measuring the whole chart says nothing about
 * whether the crosswalk is healthy.
 */
const RELEVANT_DEPTH_RANK = 3;

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

/** One player's best spot on the current chart, after de-duplication. */
interface Listing {
  sleeperId: string | undefined;
  team: string;
  name: string;
  pos: string;
  rank: number;
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
    // A listing carrying no id at all is kept, and counts later as a player we
    // could not resolve. Dropping it here would hide a chart that stopped
    // publishing ids behind a match rate that still read 100%.
    if (rank === null || !row.team) continue;

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

  // Resolve and de-duplicate first, then tally. A player listed at two spots —
  // Pittsburgh carried one at RB4 and WR7 — is one player, and counting his
  // listings would put him in the gate's denominator twice while the output
  // holds him once.
  const resolved = new Map<string, Listing>();
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

      // Unresolved players still need a stable identity, or each of their
      // listings would count as a separate failure to match.
      const key = sleeperId ?? `src:${row.gsis ?? row.espn ?? `${row.name}|${team}`}`;

      // Whichever listing puts him higher on a chart is the one that counts.
      const existing = resolved.get(key);
      if (existing && existing.rank <= row.rank) continue;

      resolved.set(key, { sleeperId, team, name: row.name, pos: row.pos, rank: row.rank });
    }
  }

  const players: DepthChartsFile['players'] = {};
  const stats = newMatchStats();

  for (const listing of resolved.values()) {
    recordMatch(stats, {
      position: listing.pos,
      sleeperId: listing.sleeperId,
      name: listing.name,
      relevant: listing.rank <= RELEVANT_DEPTH_RANK,
      note: `${listing.pos}${listing.rank}`,
    });

    if (listing.sleeperId) {
      players[listing.sleeperId] = {
        team: listing.team,
        pos: listing.pos,
        rank: listing.rank,
      };
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
