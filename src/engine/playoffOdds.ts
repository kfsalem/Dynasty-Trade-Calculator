import type { League, Matchup } from '../types';
import type { RosterSummary } from './rosterValue';
import { learn, trust } from './learned';

/**
 * What a trade does to your chances of playing in January.
 *
 * Every other number this app produces is a valuation. This one is a
 * consequence: "even on value, and it moves you from 34% to 51%" is an argument
 * a manager can act on in a way that "+312 starting lineup" is not. It is also
 * the only place the *schedule* enters the model at all — two rosters can gain
 * the same lineup strength and be in completely different positions, because
 * one has played the league's best teams already and the other has not.
 *
 * The simulation is deliberately small and legible. It is not a projection
 * system: it does not know about bye weeks, injuries in week 12, or who is on
 * the waiver wire. It knows how good each lineup is now, who is left to play,
 * and how much a fantasy week bounces — and those three things dominate.
 */

// ---------------------------------------------------------------------------
// The scoring model
// ---------------------------------------------------------------------------

/**
 * How the simulation turns lineup strength into weekly points.
 *
 * Two numbers, and the ratio between them decides whether the model thinks
 * fantasy is a game of skill or a coin flip. They were hardcoded when this
 * feature shipped, which made them the one place in the app still reasoning
 * from generic assumptions rather than from the league in front of it — the
 * exact criticism the README levels at every other trade calculator. They are
 * now measured from the league's own completed weeks wherever there are enough
 * of them, and these values are the fallback.
 */
export interface ScoringModel {
  /** Points separating teams one SD apart in lineup strength. */
  pointsPerSD: number;
  /** Week-to-week spread of a single team's score. */
  weeklySD: number;
  /** A league-average weekly score. Sets the level; nothing depends on it. */
  baseline: number;
  /** Whether this was measured or assumed, so the UI can say which. */
  source: 'league' | 'default';
  /** Completed weeks behind the estimate. Zero when assumed. */
  weeks: number;
  /**
   * How much of this model is the league's own football, 0-1.
   *
   * The same quantity as `Learned.weight`, carried here because the three
   * numbers above are shrunk individually and there is no single `Learned` to
   * hand the UI. `source` says which side of the blend a reader is looking at;
   * this says how far along it — and without it, "blended while the sample is
   * thin" is the app declining to say how thin.
   */
  weight: number;
}

/**
 * What to assume before a league has played enough football to say.
 *
 * Across a season the gap between a league's best and worst starting lineups is
 * roughly 25-30 points a week — call it ±2 SD, so about 7 per SD. Weekly spread
 * near 28 is typical for PPR, and it is the single biggest reason favourites
 * lose: over a handful of remaining weeks, noise that large swamps any plausible
 * difference in roster quality.
 *
 * At 7 against 28 a team a full SD above average wins about 57% of the time,
 * which is the right order. Understating the noise would be the more dangerous
 * error, because it would make the odds look decisive.
 */
export const DEFAULT_MODEL: ScoringModel = {
  pointsPerSD: 7,
  weeklySD: 28,
  baseline: 110,
  source: 'default',
  weeks: 0,
  weight: 0,
};

/**
 * Weeks below which there is not enough football to measure anything.
 *
 * Three is close to the mathematical floor — a within-team standard deviation
 * needs two scores per team to exist at all — because the shrinkage below, not
 * a threshold, is what protects against a thin sample.
 */
const MIN_WEEKS = 3;

/**
 * Weeks at which a measurement carries half the weight, the assumption half.
 *
 * The half-life this signal owns. `engine/learned` deliberately has no default
 * for it — a shared one would be a constant picked by taste wearing the clothes
 * of arithmetic — and the measurement below is what this one rests on.
 *
 * A hard cutoff was the first design and it was wrong. Run against a synthetic
 * season with known parameters, the raw estimate of `pointsPerSD` swung between
 * 2.5 and 11.5 across four to six weeks against a true value of 9 — and 2.5
 * would report a strong roster as a coin flip, which is *worse* than the generic
 * assumption it replaced. Accepting an estimate wholesale at week four and
 * refusing it entirely at week three has both failures at once.
 *
 * Shrinking toward the default in proportion to the evidence fixes it, and the
 * improvement is not subtle. On the same synthetic season the blended estimate
 * lands at 8.8, 4.8, 9.6, 8.5 and 9.0 for four, six, eight, ten and thirteen
 * weeks, against a true 9 — better at every sample size than either the raw
 * measurement or the flat assumption, and it stops being a cliff.
 */
const SHRINK_HALF_LIFE = 6;

/**
 * Bounds on a measured `pointsPerSD`, past which the estimate is not believed.
 *
 * The regression relates a roster's *current* best lineup to points it scored
 * with the lineups it actually started, weeks ago, with players it may since
 * have traded. That is a noisy pairing, and a small sample can produce a slope
 * implying either that roster quality is worth 40 points a week or that it runs
 * backwards. Zero is a real answer — it means no relationship was observed, and
 * the honest reading of that is coin flips.
 */
const MAX_POINTS_PER_SD = 20;

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

/**
 * mulberry32 — small, fast, and good enough for counting wins.
 *
 * Seeded on purpose. The same inputs must produce the same odds every time, or
 * the number moves when the user touches something unrelated and the whole
 * feature stops being trustworthy. `Math.random` would also make every test
 * here a flake.
 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Combine the run's seed with an iteration number into an independent seed.
 *
 * Not `seed + i`, which was the first attempt and is wrong in a way that is
 * easy to miss: seeds 1 and 2 then generate iteration seeds 1..N and 2..N+1,
 * sharing all but one stream. Two "different" seeds produced odds differing by
 * at most one iteration — often not at all. A test asserting that the seed
 * matters is what caught it.
 */
function mix(seed: number, iteration: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13) ^ iteration, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Box-Muller, returning one normal deviate per call.
 *
 * The second value the transform produces is discarded rather than cached. A
 * cache would make a draw depend on how many draws came before it, which is
 * exactly the kind of hidden state that makes a "deterministic" simulation
 * quietly stop being reproducible when the loop order changes.
 */
function normal(next: () => number): number {
  // `1 - next()` because Math.log(0) is -Infinity and next() can return 0.
  const u = 1 - next();
  const v = next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------------------------------------------------------------------------
// Inputs and outputs
// ---------------------------------------------------------------------------

export interface TeamState {
  rosterId: number;
  wins: number;
  losses: number;
  ties: number;
  /** Points scored so far. The tiebreaker, so it has to be carried forward. */
  pointsFor: number;
  /**
   * Best-lineup strength on the win-now scale — `RosterSummary.starterValue`.
   *
   * Win-now and not dynasty, which is the whole reason this feature became
   * possible: a season simulation run off asset values would be asking which
   * roster is worth the most in 2029 and reporting the answer as this year's
   * playoff odds.
   */
  strength: number;
}

export interface OddsInput {
  teams: TeamState[];
  /** Fixtures still to be played. Anything already played must not be here. */
  remaining: Matchup[];
  playoffTeams: number;
  /** Measured from the league where possible; assumed where not. */
  model?: ScoringModel;
  /** Defaults to 10,000 — see `simulate` for why that is the right order. */
  iterations?: number;
  seed?: number;
}

export interface TeamOdds {
  rosterId: number;
  /** Probability of finishing inside the playoff cut, 0-1. */
  odds: number;
}

const DEFAULT_ITERATIONS = 10000;
const DEFAULT_SEED = 0x5eed;

/**
 * Turn lineup strengths into an expected weekly score for each team.
 *
 * Standardised across the league rather than mapped from an absolute scale:
 * `starterValue` is a sum of league-adjusted values whose units depend on the
 * value source and the league's settings, and pretending it converts to fantasy
 * points would be inventing a exchange rate. What is meaningful is a team's
 * position *relative to its own league*, which is what a z-score is.
 *
 * A league where every lineup is identical produces zero spread and therefore
 * pure coin flips, which is the correct answer to "who is better" when nobody
 * is.
 */
function expectedScores(teams: TeamState[], model: ScoringModel): Map<number, number> {
  const strengths = teams.map((t) => t.strength);
  const average = strengths.reduce((sum, s) => sum + s, 0) / (strengths.length || 1);
  const variance =
    strengths.reduce((sum, s) => sum + (s - average) ** 2, 0) / (strengths.length || 1);
  const sd = Math.sqrt(variance);

  const scores = new Map<number, number>();
  for (const team of teams) {
    const z = sd > 0 ? (team.strength - average) / sd : 0;
    scores.set(team.rosterId, model.baseline + z * model.pointsPerSD);
  }
  return scores;
}

/**
 * Playoff odds for every team, by simulating the rest of the regular season.
 *
 * 10,000 iterations puts the standard error on a 50% team at about 0.5 points,
 * which is comfortably finer than the number is displayed to and far finer than
 * the model itself is accurate. More would be false precision bought with the
 * user's battery.
 *
 * Seeding is per-iteration rather than one stream across the whole run, so the
 * result cannot depend on the order teams or fixtures happen to be visited in.
 */
export function simulate(input: OddsInput): TeamOdds[] {
  const { teams, remaining, playoffTeams } = input;
  const iterations = input.iterations ?? DEFAULT_ITERATIONS;
  const seed = input.seed ?? DEFAULT_SEED;

  if (teams.length === 0) return [];

  const model = input.model ?? DEFAULT_MODEL;
  const scores = expectedScores(teams, model);
  const madePlayoffs = new Map<number, number>(teams.map((t) => [t.rosterId, 0]));
  const cut = Math.min(Math.max(playoffTeams, 0), teams.length);

  for (let i = 0; i < iterations; i++) {
    const next = rng(mix(seed, i));

    const wins = new Map<number, number>();
    const points = new Map<number, number>();
    for (const team of teams) {
      // A tie is half a win for seeding, which is how every platform sorts it.
      wins.set(team.rosterId, team.wins + team.ties * 0.5);
      points.set(team.rosterId, team.pointsFor);
    }

    for (const fixture of remaining) {
      const [a, b] = fixture.rosterIds;
      const scoreA = (scores.get(a) ?? model.baseline) + normal(next) * model.weeklySD;
      const scoreB = (scores.get(b) ?? model.baseline) + normal(next) * model.weeklySD;

      points.set(a, (points.get(a) ?? 0) + scoreA);
      points.set(b, (points.get(b) ?? 0) + scoreB);

      // An exact tie is a measure-zero event with continuous scores, so the
      // winner is simply whoever scored more.
      if (scoreA > scoreB) wins.set(a, (wins.get(a) ?? 0) + 1);
      else wins.set(b, (wins.get(b) ?? 0) + 1);
    }

    // Wins, then points for. That is the default nearly everywhere, and it is
    // why `pointsFor` has to be simulated rather than left at its current value
    // — a team that plays the rest of the season still scores.
    const standings = [...teams].sort((x, y) => {
      const byWins = (wins.get(y.rosterId) ?? 0) - (wins.get(x.rosterId) ?? 0);
      if (byWins !== 0) return byWins;
      return (points.get(y.rosterId) ?? 0) - (points.get(x.rosterId) ?? 0);
    });

    for (let rank = 0; rank < cut; rank++) {
      const id = standings[rank].rosterId;
      madePlayoffs.set(id, (madePlayoffs.get(id) ?? 0) + 1);
    }
  }

  return teams.map((team) => ({
    rosterId: team.rosterId,
    odds: (madePlayoffs.get(team.rosterId) ?? 0) / iterations,
  }));
}

const mean = (xs: number[]): number => xs.reduce((sum, x) => sum + x, 0) / xs.length;

/**
 * Measure the scoring model from weeks this league has actually played.
 *
 * `weeklySD` is pooled across teams: each roster's own variance about its own
 * average, averaged. Pooling matters — the spread of *all* scores in the league
 * mixes together how much a team bounces week to week with how much teams differ
 * from each other, and only the first is the noise the simulation needs.
 *
 * `pointsPerSD` is the slope of average points against lineup strength, in
 * standard units. Because strength is standardised, the slope is just the mean
 * of `z × points`, and it answers exactly the question the constant asks: when a
 * roster is one SD better, how many more points does it put up?
 *
 * The pairing is imperfect and worth being honest about. Strength is the best
 * lineup a roster could field *today*; the points are what it scored weeks ago
 * with whatever it started, possibly with players it has since traded away. The
 * estimate is noisy for that reason, which is what `MIN_WEEKS` and the clamp are
 * for. It is still this league's own football rather than a number picked off a
 * blog.
 */
export function calibrate(teams: TeamState[], played: Matchup[]): ScoringModel {
  const scores = new Map<number, number[]>(teams.map((t) => [t.rosterId, []]));

  let weeks = 0;
  const seen = new Set<number>();
  for (const fixture of played) {
    if (!fixture.points) continue;
    if (!seen.has(fixture.week)) {
      seen.add(fixture.week);
      weeks++;
    }
    fixture.rosterIds.forEach((rosterId, i) => {
      scores.get(rosterId)?.push(fixture.points![i]);
    });
  }

  if (weeks < MIN_WEEKS) return DEFAULT_MODEL;

  // Every team needs two scores for a variance, and one needs a mean.
  const perTeam = teams.map((team) => scores.get(team.rosterId) ?? []);
  if (perTeam.some((s) => s.length < 2)) return DEFAULT_MODEL;

  const variances = perTeam.map((s) => {
    const m = mean(s);
    return mean(s.map((x) => (x - m) ** 2));
  });
  const weeklySD = Math.sqrt(mean(variances));
  const averages = perTeam.map(mean);
  const baseline = mean(averages);

  // A league where nobody scores, or where every week is identical, has nothing
  // to teach the simulation.
  if (!(weeklySD > 0) || !(baseline > 0)) return DEFAULT_MODEL;

  const strengths = teams.map((t) => t.strength);
  const strengthMean = mean(strengths);
  const strengthSD = Math.sqrt(mean(strengths.map((s) => (s - strengthMean) ** 2)));

  /**
   * A league whose rosters are all equally strong has no slope to find, and
   * that is not a reason to throw away the two numbers that *were* measured.
   * Zero is also the right value: with no spread in strength every team is
   * league-average by construction, so the slope multiplies nothing.
   */
  const slope =
    strengthSD > 0
      ? mean(
          teams.map(
            (team, i) => ((team.strength - strengthMean) / strengthSD) * averages[i],
          ),
        )
      : 0;

  // A negative slope means the stronger rosters scored less, which over a
  // handful of weeks is noise rather than a discovery. Zero is the honest
  // reading: no relationship observed, so the rest of the season is coin flips.
  const measured = Math.min(Math.max(slope, 0), MAX_POINTS_PER_SD);

  // How much the league's own football is believed, against the assumption.
  // The arithmetic lives in `engine/learned` now; this was where its shape was
  // first worked out, and #75 lifted it out rather than letting a fourth
  // consumer write it again.
  const believed = (own: number, assumed: number) =>
    learn(own, assumed, weeks, SHRINK_HALF_LIFE).value;

  return {
    pointsPerSD: believed(measured, DEFAULT_MODEL.pointsPerSD),
    weeklySD: believed(weeklySD, DEFAULT_MODEL.weeklySD),
    // The baseline sets the level and nothing depends on it, so it is taken as
    // measured — there is no wrong answer to shrink away from.
    baseline,
    source: 'league',
    weeks,
    weight: trust(weeks, SHRINK_HALF_LIFE),
  };
}

/**
 * Everything the simulation needs about a league, gathered in one place.
 *
 * Held as a unit because the three travel together and are meaningless apart:
 * odds without a schedule are a guess, and a schedule without the standings is
 * a fixture list.
 */
export interface OddsContext {
  teams: TeamState[];
  remaining: Matchup[];
  playoffTeams: number;
  model: ScoringModel;
}

/**
 * Current standings and lineup strength, per roster.
 *
 * A roster with no summary is dropped rather than defaulted. Every roster in a
 * loaded league has one, so its absence means something has gone wrong
 * upstream, and a team entered at zero strength would be a free win for
 * whoever plays it.
 */
export function teamStates(league: League, summaries: RosterSummary[]): TeamState[] {
  const strengthOf = new Map(summaries.map((s) => [s.rosterId, s.starterValue]));

  return league.rosters
    .filter((roster) => strengthOf.has(roster.rosterId))
    .map((roster) => ({
      rosterId: roster.rosterId,
      wins: roster.wins,
      losses: roster.losses,
      ties: roster.ties,
      pointsFor: roster.pointsFor,
      strength: strengthOf.get(roster.rosterId) as number,
    }));
}

/**
 * The same league, with some lineups replaced — a proposed trade, simulated.
 *
 * Only strength changes. Records and points already banked are facts about a
 * season that has been played, and a trade does not reach back into them.
 */
export function withStrengths(
  teams: TeamState[],
  replacements: Map<number, number>,
): TeamState[] {
  return teams.map((team) =>
    replacements.has(team.rosterId)
      ? { ...team, strength: replacements.get(team.rosterId) as number }
      : team,
  );
}

/**
 * Only the fixtures still to be played.
 *
 * `currentWeek` is the week being played now, and it counts as remaining: a
 * trade agreed on Tuesday is in the lineup on Sunday. Passing a null week means
 * the caller does not know what week it is, and the honest answer to "how much
 * season is left" is then nothing rather than a guess.
 */
export function remainingFixtures(
  schedule: Matchup[],
  currentWeek: number | null,
  playoffWeekStart: number,
): Matchup[] {
  if (currentWeek === null) return [];
  return schedule.filter(
    (fixture) => fixture.week >= currentWeek && fixture.week < playoffWeekStart,
  );
}

/**
 * The fixtures with a result, which are the ones worth learning from.
 *
 * Filtered on `points` rather than on the week number: a week can be in the past
 * and still have no result, and the schedule is the only thing that knows which.
 */
export const playedFixtures = (schedule: Matchup[]): Matchup[] =>
  schedule.filter((fixture) => fixture.points !== null);
