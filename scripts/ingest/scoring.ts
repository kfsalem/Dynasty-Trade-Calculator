import { iterCsvRows } from '../../src/lib/csv';
import {
  SCORING_COLUMNS,
  SKILL_POSITIONS,
  type ScoringFile,
  type ScoringWeek,
} from '../../src/data/types';
import { num, requireColumns, round } from './columns';
import { id, observe, tallyCandidates, type Candidate, type Crosswalk, type MatchStats } from './crosswalk';

/**
 * The nflverse column behind each shipped column, in `SCORING_COLUMNS` order.
 *
 * The two vocabularies are kept apart on purpose. `SCORING_COLUMNS` is the
 * app's, and `engine/scoring` reads it; these are nflverse's, and only this
 * file does. A rename upstream then breaks the ingest — loudly, through
 * `requireColumns` — instead of quietly shipping a column of zeros that the
 * scoring engine would faithfully multiply by the league's own rules.
 */
const SOURCE: Record<string, string> = {
  receptions: 'receptions',
  recYards: 'receiving_yards',
  recTds: 'receiving_tds',
  rushYards: 'rushing_yards',
  rushTds: 'rushing_tds',
  passYards: 'passing_yards',
  passTds: 'passing_tds',
  passInts: 'passing_interceptions',
  rec40: 'receiving_40',
  rush40: 'rushing_40',
  pass40: 'passing_40',
  // `fumbles_lost_total`, not the sum of the rushing/receiving/sack buckets.
  // Trevor Etienne lost one on a punt return in 2025 week 3, which belongs to
  // none of those three and cost a real -2 the sum could not see.
  fumblesLost: 'fumbles_lost_total',
  completions: 'completions',
  attempts: 'attempts',
  carries: 'carries',
  sacked: 'sacks_suffered',
  fumbles: 'fumbles_total',
  passFirstDowns: 'passing_first_downs',
  rushFirstDowns: 'rushing_first_downs',
  recFirstDowns: 'receiving_first_downs',
  rec2pt: 'receiving_2pt_conversions',
  rush2pt: 'rushing_2pt_conversions',
  pass2pt: 'passing_2pt_conversions',
  fumbleRecTds: 'fumble_recovery_tds',
  specialTeamsTds: 'special_teams_tds',
  kickReturnYards: 'kickoff_return_yards',
  puntReturnYards: 'punt_return_yards',
  fgMade: 'fg_made',
  fgMade0_19: 'fg_made_0_19',
  fgMade20_29: 'fg_made_20_29',
  fgMade30_39: 'fg_made_30_39',
  fgMade40_49: 'fg_made_40_49',
  fgMade50_59: 'fg_made_50_59',
  fgMade60: 'fg_made_60_',
  fgMissed: 'fg_missed',
  patMade: 'pat_made',
  patMissed: 'pat_missed',
};

/** Every column after `week`, in the order the shipped rows use. */
const STATS = SCORING_COLUMNS.filter((column) => column !== 'week');

const REQUIRED = [
  'player_id',
  'player_display_name',
  'position',
  'season',
  'week',
  'season_type',
  'team',
  ...STATS.map((column) => SOURCE[column]),
] as const;

/**
 * Kickers, unlike everywhere else in the ingest.
 *
 * `SKILL_POSITIONS` exists because the rest of the app values offensive skill
 * players and nothing else. Scoring is the one place that has to be wider: a
 * league publishes `fgm_40_49` and `xpm` like any other rule, and an engine
 * that silently scored every kicker zero would be wrong in exactly the way this
 * whole issue is about. Team defenses stay out — they are not in this file at
 * all, and #10 settled that DEF goes unpriced.
 */
const SCORED = new Set<string>([...SKILL_POSITIONS, 'K']);

/**
 * Peak single-week involvement that counts as a role, for the match tally.
 *
 * Deliberately the same shape of gate as `weeklyStats`, and deliberately a
 * different quantity: what matters here is whether a player ever scored, not
 * whether the ball went to him. A kicker takes no targets and no carries.
 */
const RELEVANT_TOUCHES = 3;

/**
 * Reduce nflverse weekly stats to the columns a scoring rule can read.
 *
 * Separate from `reduceWeeklyStats` over the same source file, and the split is
 * the point: that one ships *rates* — target share, air yards share, WOPR — to
 * answer how much of a team's work a player gets. This one ships *counts*, to
 * answer what a league's own rulebook would pay him for it. They also cover
 * different players, since a kicker has a scoring line and no target share.
 *
 * Rows are written with trailing zeros trimmed. A receiver's line stops before
 * the kicking columns begin, which is most of what keeps the file inside a
 * budget every visitor pays: the same 37 columns padded measured 492 KB against
 * this shape's 301 KB.
 */
export function reduceScoring(
  csv: string,
  crosswalk: Crosswalk,
  meta: { season: number; source: string; generatedAt: string },
): { file: ScoringFile; stats: MatchStats } {
  const players: ScoringFile['players'] = {};
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
    if (!SCORED.has(row.position)) continue;

    const gsisId = id(row.player_id);
    const sleeperId = gsisId ? crosswalk.byGsis.get(gsisId) : undefined;
    const week = num(row.week);

    const line = STATS.map((column) => round(num(row[SOURCE[column]]), 2) ?? 0);
    // Everything the rulebook could pay for, in one number, purely to decide
    // whether this player-week is worth a row at all.
    const involvement =
      (num(row.attempts) ?? 0) + (num(row.carries) ?? 0) + (num(row.targets) ?? 0);

    observe(
      candidates,
      gsisId ?? `${row.player_display_name}|${row.position}`,
      { name: row.player_display_name, position: row.position, sleeperId },
      involvement,
    );

    if (!sleeperId || week === null) continue;

    // A week in which nothing scoreable happened is not shipped. It reads back
    // as a week with no row, which is what an absent week already means
    // everywhere else in `public/data` — and it is not the same as a zero,
    // because a player who did not appear and one who appeared and did nothing
    // are both worth zero points either way.
    if (line.every((value) => value === 0)) continue;

    throughWeek = Math.max(throughWeek, week);

    let end = line.length;
    while (end > 0 && line[end - 1] === 0) end--;

    const entry = (players[sleeperId] ??= { pos: row.position, team: row.team, weeks: [] });
    entry.weeks.push([week, ...line.slice(0, end)] satisfies ScoringWeek);

    if (week >= (teamAsOf.get(sleeperId) ?? -1)) {
      entry.team = row.team;
      teamAsOf.set(sleeperId, week);
    }
  }

  if (!checked) requireColumns('stats_player_week', undefined, REQUIRED);

  for (const entry of Object.values(players)) {
    entry.weeks.sort((a, b) => a[0] - b[0]);
  }

  const stats = tallyCandidates(
    candidates.values(),
    RELEVANT_TOUCHES,
    (peak) => `peak ${peak} touches`,
  );

  return {
    file: {
      generatedAt: meta.generatedAt,
      season: meta.season,
      throughWeek,
      source: meta.source,
      columns: SCORING_COLUMNS,
      players,
    },
    stats,
  };
}
