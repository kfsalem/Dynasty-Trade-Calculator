import { SCORING_COLUMNS, type ScoringWeek } from '../data/types';
import type { ScoringSettings } from '../types';

/**
 * Score a stat line under a league's own rules.
 *
 * The app read exactly one of the 148 scoring rules Sleeper publishes — `rec`,
 * to pick a PPR flavour for FantasyCalc — and threw the rest away. So a
 * TE-premium league with six-point passing touchdowns was valued as though it
 * were neither, and every tight end and quarterback in it was priced wrong by
 * the whole size of the bonus.
 *
 * Nobody has to be persuaded of a model here. These are published fields, and
 * this file multiplies them by the numbers the league published beside them.
 *
 * **It has an oracle.** Sleeper also publishes its own scoring output for every
 * rostered player, every week, so unlike everything else in the engine this can
 * be checked against the truth in the league it is running in — see
 * `scoringCheck.ts`. Measured against four hundred rosters' worth of it: 95.1%
 * of 2,579 player-weeks exact to the cent, and every residual bar one a
 * combination of the bonuses named in `UNREACHABLE` below.
 */

/** A stat line, read back from the positional row `scoring.json` ships. */
export type StatLine = Record<(typeof SCORING_COLUMNS)[number], number>;

/**
 * Widen a shipped row into named fields, filling the trimmed tail with zeros.
 *
 * Rows are written with trailing zeros dropped, so a short row is normal rather
 * than corrupt: a receiver's line ends before the kicking columns begin. The
 * padding has to happen somewhere, and doing it once here keeps every rule
 * below free to read a plain number.
 */
export function statLine(row: ScoringWeek): StatLine {
  const line = {} as StatLine;
  for (let i = 0; i < SCORING_COLUMNS.length; i++) {
    line[SCORING_COLUMNS[i]] = row[i] ?? 0;
  }
  return line;
}

/** A milestone bonus: worth its points once, if the threshold is reached at all. */
const atLeast = (value: number, threshold: number): number => (value >= threshold ? 1 : 0);

/** Bonus per reception, but only for players at one position. */
const perRecAt = (pos: string) => (s: StatLine, position: string) =>
  position === pos ? s.receptions : 0;

/** Bonus per first down, but only for players at one position. */
const perFirstDownAt = (pos: string) => (s: StatLine, position: string) =>
  position === pos ? s.passFirstDowns + s.rushFirstDowns + s.recFirstDowns : 0;

/**
 * Every Sleeper rule this engine can compute, and the stats it computes it from.
 *
 * A rule absent from this table is not scored, and — the part that matters —
 * `classifyRules` will say so out loud rather than letting it read as zero. A
 * league scoring something this cannot express deserves to be told which rule,
 * not handed a number that is quietly short.
 */
const RULES: Record<string, (s: StatLine, position: string) => number> = {
  // Passing
  pass_yd: (s) => s.passYards,
  pass_td: (s) => s.passTds,
  pass_int: (s) => s.passInts,
  pass_2pt: (s) => s.pass2pt,
  pass_cmp: (s) => s.completions,
  pass_att: (s) => s.attempts,
  pass_inc: (s) => s.attempts - s.completions,
  pass_fd: (s) => s.passFirstDowns,
  pass_sack: (s) => s.sacked,
  pass_cmp_40p: (s) => s.pass40,
  bonus_pass_yd_300: (s) => atLeast(s.passYards, 300),
  bonus_pass_yd_400: (s) => atLeast(s.passYards, 400),
  bonus_pass_cmp_25: (s) => atLeast(s.completions, 25),

  // Rushing
  rush_yd: (s) => s.rushYards,
  rush_td: (s) => s.rushTds,
  rush_2pt: (s) => s.rush2pt,
  rush_att: (s) => s.carries,
  rush_fd: (s) => s.rushFirstDowns,
  rush_40p: (s) => s.rush40,
  bonus_rush_yd_100: (s) => atLeast(s.rushYards, 100),
  bonus_rush_yd_200: (s) => atLeast(s.rushYards, 200),
  bonus_rush_att_20: (s) => atLeast(s.carries, 20),
  bonus_rush_td_qb: (s, position) => (position === 'QB' ? s.rushTds : 0),

  // Receiving
  rec: (s) => s.receptions,
  rec_yd: (s) => s.recYards,
  rec_td: (s) => s.recTds,
  rec_2pt: (s) => s.rec2pt,
  rec_fd: (s) => s.recFirstDowns,
  rec_40p: (s) => s.rec40,
  bonus_rec_yd_100: (s) => atLeast(s.recYards, 100),
  bonus_rec_yd_200: (s) => atLeast(s.recYards, 200),
  bonus_rec_te: perRecAt('TE'),
  bonus_rec_rb: perRecAt('RB'),
  bonus_rec_wr: perRecAt('WR'),
  bonus_fd_qb: perFirstDownAt('QB'),
  bonus_fd_rb: perFirstDownAt('RB'),
  bonus_fd_te: perFirstDownAt('TE'),
  bonus_fd_wr: perFirstDownAt('WR'),

  // Combined
  bonus_rush_rec_yd_100: (s) => atLeast(s.rushYards + s.recYards, 100),
  bonus_rush_rec_yd_200: (s) => atLeast(s.rushYards + s.recYards, 200),

  // Ball security and the odd touchdown
  fum: (s) => s.fumbles,
  fum_lost: (s) => s.fumblesLost,
  fum_rec_td: (s) => s.fumbleRecTds,
  st_td: (s) => s.specialTeamsTds,
  def_st_td: (s) => s.specialTeamsTds,
  kr_yd: (s) => s.kickReturnYards,
  pr_yd: (s) => s.puntReturnYards,

  // Kicking
  fgm: (s) => s.fgMade,
  fgm_0_19: (s) => s.fgMade0_19,
  fgm_20_29: (s) => s.fgMade20_29,
  fgm_30_39: (s) => s.fgMade30_39,
  fgm_40_49: (s) => s.fgMade40_49,
  // Sleeper's "50+" bucket is one rule; nflverse splits the same kicks in two.
  fgm_50p: (s) => s.fgMade50_59 + s.fgMade60,
  fgm_50_59: (s) => s.fgMade50_59,
  fgm_60p: (s) => s.fgMade60,
  fgmiss: (s) => s.fgMissed,
  xpm: (s) => s.patMade,
  xpmiss: (s) => s.patMissed,
};

/**
 * Rules that apply to the players this app values, and that a weekly aggregate
 * cannot express.
 *
 * All but one are about the *length* of a touchdown. `stats_player_week`
 * publishes plays of 40+ yards but not whether a **touchdown** was 40+ or 50+,
 * and `pass_int_td` needs to know an interception was returned for a score.
 * Both need play-by-play, which is a far larger file for bonuses worth one or
 * two points on a rare event — measured at 0.85% of a deliberately bonus-heavy
 * league's total points, against a TE premium the old behaviour missed
 * entirely.
 *
 * Named rather than silently zero. A league scoring these is scored slightly
 * short, and is told so.
 */
export const UNREACHABLE = new Set([
  'pass_td_40p',
  'pass_td_50p',
  'rush_td_40p',
  'rush_td_50p',
  'rec_td_40p',
  'rec_td_50p',
  'pass_int_td',
  // Reception-length buckets: nflverse publishes 40+ yard plays, not the
  // 0-4 / 5-9 / 10-19 / 20-29 / 30-39 bands Sleeper scores.
  'rec_0_4',
  'rec_5_9',
  'rec_10_19',
  'rec_20_29',
  'rec_30_39',
  // Field-goal distance totals, as opposed to made-kick counts by bucket.
  'fgm_yds',
  'fgm_yds_over_30',
]);

/**
 * Rules that score a team defense or an individual defensive player.
 *
 * Not a gap in this engine: the app does not value DEF or IDP at all — #10
 * settled that K and DEF stay unpriced — so a league scoring them is not being
 * short-changed by anything here. They are separated from `UNREACHABLE` so the
 * self-check can say "this engine cannot express your league's rules" without
 * counting fifty defensive rules it was never asked to express.
 */
function isDefensive(rule: string): boolean {
  return (
    rule.startsWith('idp_') ||
    rule.startsWith('def_') ||
    rule.startsWith('pts_allow') ||
    rule.startsWith('yds_allow') ||
    rule.startsWith('tkl') ||
    rule.startsWith('st_') ||
    rule.startsWith('blk_kick') ||
    rule.startsWith('int_ret') ||
    rule.startsWith('fum_ret') ||
    rule.startsWith('sack') ||
    rule.startsWith('qb_hit') ||
    rule.startsWith('bonus_def') ||
    rule.startsWith('bonus_sack') ||
    rule.startsWith('bonus_tkl') ||
    rule === 'int' ||
    rule === 'ff' ||
    rule === 'fum_rec' ||
    rule === 'safe'
  );
}

export interface RuleCoverage {
  /** Non-zero rules this engine scores. */
  supported: string[];
  /** Non-zero rules that matter to skill players and cannot be computed. */
  unreachable: string[];
  /** Non-zero rules for defenses, which this app does not value either way. */
  defensive: string[];
  /** Non-zero rules Sleeper publishes that this engine has never heard of. */
  unknown: string[];
}

/**
 * Sort a league's live rules into what this engine can and cannot do.
 *
 * Only non-zero rules are classified: a league that publishes `bonus_rec_wr: 0`
 * has not asked for a WR premium, and reporting it as an unsupported feature
 * would be noise about a rule nobody is using. Sleeper publishes all 148 keys
 * for every league, most of them zero, so this distinction is the difference
 * between a short honest list and a wall of text.
 */
export function classifyRules(scoring: ScoringSettings): RuleCoverage {
  const coverage: RuleCoverage = {
    supported: [],
    unreachable: [],
    defensive: [],
    unknown: [],
  };

  for (const [rule, value] of Object.entries(scoring)) {
    if (!value) continue;
    if (rule in RULES) coverage.supported.push(rule);
    else if (UNREACHABLE.has(rule)) coverage.unreachable.push(rule);
    else if (isDefensive(rule)) coverage.defensive.push(rule);
    else coverage.unknown.push(rule);
  }

  for (const list of Object.values(coverage)) list.sort();
  return coverage;
}

/**
 * Points for one player-week under one league's rules.
 *
 * `position` is nflverse's, because that is what ships in `scoring.json` and
 * what the positional bonuses key on. A rule the engine cannot express
 * contributes nothing rather than guessing — the guess would be invisible, and
 * `classifyRules` exists so the absence is not.
 */
export function scoreStatLine(
  line: StatLine,
  position: string,
  scoring: ScoringSettings,
): number {
  let points = 0;

  for (const [rule, value] of Object.entries(scoring)) {
    if (!value) continue;
    const stat = RULES[rule];
    if (stat) points += value * stat(line, position);
  }

  // Sleeper reports its own points to two decimals, and a per-yard rule of 0.04
  // makes floating point visible immediately: 219 x 0.04 lands at
  // 8.760000000000001, and a self-check comparing to the cent would call that a
  // mismatch against Sleeper's own 8.76.
  return Math.round(points * 100) / 100;
}

/** Points across a run of shipped rows, for a whole season or any slice of one. */
export function scoreWeeks(
  weeks: readonly ScoringWeek[],
  position: string,
  scoring: ScoringSettings,
): number {
  const total = weeks.reduce(
    (sum, row) => sum + scoreStatLine(statLine(row), position, scoring),
    0,
  );
  return Math.round(total * 100) / 100;
}
