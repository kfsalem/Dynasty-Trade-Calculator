import type { ValuedPlayer } from './rosterValue';
import { startSit, type StartSitInput, type StartSitPlan } from './startSit';

/**
 * This week's matchup, and the chance of winning it (#162).
 *
 * Both totals are each side's *best legal lineup* on this week's projections,
 * from the same `startSit` the lineup panel runs — so the manager is assumed to
 * take the panel's advice, and the opponent is assumed to set his lineup well.
 * When the opponent's lineup as it stands is worse than that, the line says so,
 * with the odds against it as set.
 *
 * ## Locked games
 *
 * Once a starter's game is over, what he scored is final and replaces his
 * projection. While it is still being played he counts the larger of the two:
 * his projection is the better guess early in a game, his points are a floor
 * he cannot fall below, and nothing the API publishes says how far through the
 * game he is.
 */

/**
 * How far a matchup's margin lands from its projected margin: the standard
 * deviation, in points, of a normal curve around it.
 *
 * Measured 2026-10-19 by replaying 280 real matchups of the two test leagues
 * (2024–25 regular seasons, every week), projecting each side with Sleeper's
 * weekly projection under that league's own scoring:
 *
 * ```
 *   residual sd of the margin     35.9   (2024 35.7, 2025 36.1; by league 34–37)
 *   probit fit on win/loss only   37.5 best lineups, 41.6 set lineups (95%: 26–60)
 *   actual margin per projected   0.76–0.87
 * ```
 *
 * The last line is why this is 40 rather than 36: projections spread teams
 * further apart than their games finish, so the fit to who actually *won* is
 * wider than the scatter of the margin. 40 is the round number at the cautious
 * end of both. It is in points, measured on leagues scoring about 150 a team;
 * a league that scores much less is told it is less sure than it is, which is
 * the safer way round to be wrong.
 *
 * By projected gap, on the lineups the managers set (280 matchups, so each
 * bin is 20–68 games and moves several points by chance):
 *
 * ```
 *   projected gap     0–5   5–10  10–15  15–20  20–30  30+
 *   favourite won     .52   .66   .65    .70    .66    .80
 *   this curve        .52   .57   .62    .66    .73    .84
 * ```
 */
export const MATCHUP_SPREAD = 40;

/**
 * Below this many points of difference, the opponent's set lineup is called
 * as good as his best. About one percentage point of win chance at
 * `MATCHUP_SPREAD`, which is the precision the line is printed at.
 */
export const SET_LINEUP_GAP = 1;

/** Standard normal CDF, by Abramowitz & Stegun 26.2.17 (error below 1e-7). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804 * Math.exp((-z * z) / 2);
  const tail =
    d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - tail : tail;
}

/**
 * The chance a side projected `margin` points ahead wins, with `uncertain` of
 * the week's projected points still to be played (1 before kickoff, 0 when
 * every game is over).
 *
 * The spread shrinks with the square root of what is left to play, which is
 * how a sum of independent players' variances shrinks as they finish. That
 * scaling is an assumption, not a measurement: the replay only saw whole weeks.
 */
export function winChance(margin: number, uncertain = 1): number {
  const spread = MATCHUP_SPREAD * Math.sqrt(Math.max(0, Math.min(1, uncertain)));
  if (spread === 0) return margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
  return normalCdf(margin / spread);
}

export interface MatchupSide {
  rosterId: number;
  /** Expected total of the best legal lineup: final points plus projections. */
  expected: number;
  /** Points already final, from starters whose game is over. */
  scored: number;
  /** The same lineup's projections before kickoff, for scaling the spread. */
  projectedBefore: number;
  /** …of which still to be played. */
  projectedLeft: number;
  plan: StartSitPlan;
}

export interface MatchupOdds {
  me: MatchupSide;
  them: MatchupSide;
  /** Chance of beating the opponent's best lineup. */
  chance: number;
  /**
   * The opponent's lineup as it stands, when it is worse than his best by at
   * least `SET_LINEUP_GAP`, with the chance against it. Null when it is as good,
   * or when he has set no lineup at all (`unset`).
   */
  asSet: { expected: number; chance: number } | null;
  /** True when the opponent has no lineup set, so only his best can be priced. */
  themUnset: boolean;
  /** True once any starter on either side has kicked off. */
  underway: boolean;
  /** True once every starter on both sides has finished: the result, not a chance. */
  final: boolean;
}

/** One roster's inputs to `startSit`, minus what the week supplies. */
export type MatchupRoster = Pick<StartSitInput, 'entries' | 'setLineup'> & { rosterId: number };

export interface MatchupInput {
  me: MatchupRoster;
  them: MatchupRoster;
  startingSlots: StartSitInput['startingSlots'];
  byeTeams?: StartSitInput['byeTeams'];
  /** This week's projected points in the league's scoring. */
  projected: ReadonlyMap<string, number>;
  /** Teams whose game has kicked off. */
  started?: ReadonlySet<string> | null;
  /** Teams whose game is over. A subset of `started`. */
  finished?: ReadonlySet<string> | null;
  /** Points each player has scored this week so far. */
  live?: ReadonlyMap<string, number> | null;
}

export function matchupOdds(input: MatchupInput): MatchupOdds {
  const started = input.started ?? new Set<string>();
  const finished = input.finished ?? new Set<string>();
  const live = input.live ?? new Map<string, number>();
  const teamOf = new Map<string, string | null>(
    [...input.me.entries, ...input.them.entries].map((e) => [e.player.id, e.player.team]),
  );

  const isFinal = (id: string) => {
    const team = teamOf.get(id);
    return Boolean(team && finished.has(team));
  };

  /*
    What each player is expected to finish with, given what has happened. Passed
    to `startSit` as its projection, so the lineup it picks and the totals it
    adds up already have the finished games in them.
  */
  const expected = new Map(input.projected);
  for (const [id, team] of teamOf) {
    if (!team || !started.has(team)) continue;
    const points = live.get(id) ?? 0;
    expected.set(id, finished.has(team) ? points : Math.max(points, input.projected.get(id) ?? 0));
  }

  const side = (roster: MatchupRoster): MatchupSide => {
    const plan = startSit({
      entries: roster.entries,
      startingSlots: input.startingSlots,
      setLineup: roster.setLineup,
      byeTeams: input.byeTeams,
      projected: expected,
      locked: started,
    });
    const starters = plan.lineup
      .map((assignment) => assignment.entry)
      .filter((entry): entry is ValuedPlayer => entry !== null);
    const before = (entry: ValuedPlayer) => input.projected.get(entry.player.id) ?? 0;
    return {
      rosterId: roster.rosterId,
      expected: plan.recommendedValue,
      scored: starters
        .filter((entry) => isFinal(entry.player.id))
        .reduce((sum, entry) => sum + entry.winNowValue, 0),
      projectedBefore: starters.reduce((sum, entry) => sum + before(entry), 0),
      projectedLeft: starters
        .filter((entry) => !isFinal(entry.player.id))
        .reduce((sum, entry) => sum + before(entry), 0),
      plan,
    };
  };

  const me = side(input.me);
  const them = side(input.them);

  const before = me.projectedBefore + them.projectedBefore;
  const uncertain = before > 0 ? (me.projectedLeft + them.projectedLeft) / before : 1;

  const themUnset = them.plan.unset;
  const shortfall = them.expected - them.plan.setValue;
  const asSet =
    !themUnset && shortfall >= SET_LINEUP_GAP
      ? {
          expected: them.plan.setValue,
          chance: winChance(me.expected - them.plan.setValue, uncertain),
        }
      : null;

  const starting = [...me.plan.lineup, ...them.plan.lineup]
    .map((assignment) => assignment.entry)
    .filter((entry): entry is ValuedPlayer => entry !== null);
  const underway = starting.some((entry) => entry.player.team && started.has(entry.player.team));
  // By starter rather than by projected points left, so a starter projected
  // for nothing whose game is still to come keeps the week open.
  const final = underway && starting.every((entry) => isFinal(entry.player.id));

  return {
    me,
    them,
    chance: winChance(me.expected - them.expected, final ? 0 : uncertain),
    asSet,
    themUnset,
    underway,
    final,
  };
}

/** The fixture `rosterId` plays this week, as the opponent's roster id. */
export function opponentOf(
  fixtures: readonly { rosterIds: [number, number] }[],
  rosterId: number,
): number | null {
  for (const { rosterIds } of fixtures) {
    if (rosterIds[0] === rosterId) return rosterIds[1];
    if (rosterIds[1] === rosterId) return rosterIds[0];
  }
  return null;
}
