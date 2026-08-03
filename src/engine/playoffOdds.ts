import type { League, Matchup } from '../types';
import type { RosterSummary } from './rosterValue';

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
 * How many fantasy points separate teams one standard deviation apart in
 * lineup strength.
 *
 * This is the parameter that decides whether the model thinks fantasy is a game
 * of skill or a coin flip, so it is worth being explicit. Across a season, the
 * gap between a league's best and worst starting lineups is roughly 25-30
 * points a week — call it ±2 SD, so about 7 points per SD.
 *
 * The number matters less than its ratio to `WEEKLY_SD` below. At 7 against 28,
 * a team a full SD above average beats an average team about 57% of the time,
 * which is the right order: strong fantasy teams win comfortably more often
 * than they lose, and nothing like always.
 */
const POINTS_PER_SD = 7;

/**
 * Week-to-week spread of a single team's score.
 *
 * Fantasy scoring is extremely noisy — a starting lineup that averages 120 will
 * routinely post 90 and 150. Around 28 points is typical for a PPR league, and
 * it is the single biggest reason favourites lose: over a handful of remaining
 * weeks, noise this large swamps any plausible difference in roster quality.
 *
 * Understating it would be the more dangerous error. It would make the odds
 * look decisive, and a confident wrong number is worse than an honest vague
 * one.
 */
const WEEKLY_SD = 28;

/** A league-average weekly score. Sets the level; nothing depends on it. */
const BASELINE_POINTS = 110;

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
function expectedScores(teams: TeamState[]): Map<number, number> {
  const strengths = teams.map((t) => t.strength);
  const mean = strengths.reduce((sum, s) => sum + s, 0) / (strengths.length || 1);
  const variance =
    strengths.reduce((sum, s) => sum + (s - mean) ** 2, 0) / (strengths.length || 1);
  const sd = Math.sqrt(variance);

  const scores = new Map<number, number>();
  for (const team of teams) {
    const z = sd > 0 ? (team.strength - mean) / sd : 0;
    scores.set(team.rosterId, BASELINE_POINTS + z * POINTS_PER_SD);
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

  const scores = expectedScores(teams);
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
      const scoreA = (scores.get(a) ?? BASELINE_POINTS) + normal(next) * WEEKLY_SD;
      const scoreB = (scores.get(b) ?? BASELINE_POINTS) + normal(next) * WEEKLY_SD;

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
