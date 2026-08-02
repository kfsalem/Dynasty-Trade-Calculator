import type { LeagueSettings, Player, Position } from '../types';
import { bestLineup, byValue, type RosterSummary, type ValuedPlayer } from './rosterValue';

/**
 * Team analysis: strengths, weaknesses, surplus, and contention window.
 *
 * Everything here is measured **against the league**, not against the player
 * universe. Being "weak at TE" only matters relative to the eleven managers you
 * actually play, and a bench player is only a tradeable surplus if someone else
 * would start him.
 */

/** Positions with a real dynasty market. K and DEF are churned, never held. */
export const SKILL_POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE'];

/**
 * Age at which a position's dynasty value starts falling, and how fast it falls
 * afterwards. Published consensus ranges; deliberately coarse, since the
 * quadrant is computed from league-relative rank rather than absolute score.
 */
export const AGE_CLIFF: Record<Position, number> = {
  QB: 33,
  RB: 26,
  WR: 28,
  TE: 29,
  K: 32,
  DEF: 99,
};

export const ANNUAL_DECAY: Record<Position, number> = {
  QB: 0.1,
  RB: 0.28,
  WR: 0.18,
  TE: 0.16,
  K: 0.2,
  DEF: 0.2,
};

/** Years out that "future" means. Three is the usual dynasty planning horizon. */
export const HORIZON_YEARS = 3;

export interface PositionalStrength {
  position: Position;
  /**
   * This roster's win-now starting value at the position, including flex usage.
   *
   * A weakness is a hole in the lineup you field on Sunday, so it is measured
   * on the scale that decides who fills that lineup. A roster three deep in
   * expensive rookie receivers is weak at receiver this year, and saying so is
   * the point.
   */
  starterValue: number;
  leagueMedian: number;
  z: number;
  verdict: 'strength' | 'weakness' | 'neutral';
}

export interface SurplusAsset {
  player: Player;
  /**
   * Dynasty value — what he fetches. `wouldStartOn` is decided on the win-now
   * scale, because that is the question "would they start him" asks, but what
   * the trade is worth is an asset question and stays in asset units.
   */
  value: number;
  /** How many other rosters this player would immediately start for. */
  wouldStartOn: number;
}

export type Quadrant = 'juggernaut' | 'win_now' | 'rebuilding' | 'danger';

export interface ContentionProfile {
  /** Win-now lineup strength: how good this team is *this season*. */
  nowScore: number;
  /** Dynasty asset base three years out, after age decay. */
  futureScore: number;
  nowRank: number;
  futureRank: number;
  /**
   * Future asset base per point of present lineup strength. This, not the
   * absolute future score, is what places a team on the young/old axis.
   *
   * A ratio across the two scales, deliberately. Before R8 both halves were
   * dynasty and this really was a retained *share* — bounded by 1, and
   * measuring little more than the average age of a lineup. It could not
   * distinguish a rebuild from a bad team, because dynasty value counts a
   * roster of unplayable rookies as strong now.
   *
   * Numerator and denominator now answer the two questions the axis is
   * actually about: what will this roster be worth later, against what it can
   * field today. Trading a veteran for picks moves it up; trading picks for a
   * veteran moves it down; and a team of prospects finally reads as young
   * rather than as merely a lineup of players who happen not to be old. The two
   * scales share a normalizing constant (see `PlayerValue`), so the ratio is
   * between comparable quantities — and it is only ever read against the other
   * teams' ratios, never as an absolute.
   *
   * No longer bounded by 1: a full rebuild can hold more future than present.
   */
  retainedShare: number;
  teamCount: number;
  /**
   * Where this team sits on each axis, 0 (weakest / oldest) to 1.
   *
   * The quadrant is a median split, so exactly half the league is "weak now" by
   * construction — on a ten-team league that hands four teams the danger-zone
   * verdict every season, including one sitting sixth of ten and four percent
   * below the median. As a *label* that is only unkind. As an input it was
   * worse: `WINDOW_WEIGHTS` read the quadrant and nothing else, so a team a
   * hair below the median was scored on trades as though it had given up on the
   * season, while the team a hair above was scored as a contender.
   *
   * These carry the distance the label throws away, so a consumer can be
   * continuous where the label cannot. See `suggest.windowWeights`.
   */
  nowShare: number;
  youthShare: number;
  quadrant: Quadrant;
  label: string;
  advice: string;
}

export interface TeamAnalysis {
  rosterId: number;
  positions: PositionalStrength[];
  strengths: PositionalStrength[];
  weaknesses: PositionalStrength[];
  surpluses: SurplusAsset[];
  contention: ContentionProfile;
  focus: string[];
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

/** Fraction of a player's value expected to survive `years` of aging. */
export function retention(position: Position, age: number | null, years: number): number {
  if (age === null) return 1;
  const yearsPastCliff = Math.max(0, age + years - (AGE_CLIFF[position] ?? 99));
  return (1 - (ANNUAL_DECAY[position] ?? 0.2)) ** yearsPastCliff;
}

/** Win-now starting value contributed by each position, counting flex usage. */
export function positionalStarterValue(
  summary: RosterSummary,
): Partial<Record<Position, number>> {
  const out: Partial<Record<Position, number>> = {};
  for (const slot of summary.lineup) {
    if (!slot.entry) continue;
    const position = slot.entry.player.position;
    out[position] = (out[position] ?? 0) + slot.entry.winNowValue;
  }
  return out;
}

/**
 * Project a roster forward and score the best lineup it could field then.
 *
 * The model only decays — it never invents growth for young players, which
 * would be speculation dressed as arithmetic. That understates ascending
 * players in absolute terms, but the quadrant reads *rank within the league*,
 * where a uniform understatement cancels out.
 *
 * Runs on the **dynasty** scale, and stays there after R8 moved everything else
 * to win-now. The reason is that a dynasty price is already a claim about the
 * future — the market has looked at a 22-year-old with no role and priced what
 * it thinks he becomes — so decaying it by age asks "what is left of this
 * roster's asset base in three years". Running the same decay on win-now value
 * would ask a strictly worse question: redraft value prices *this* season, so a
 * prospect enters at nothing, decays to nothing, and a team built entirely of
 * them would project to have no future at all. The one model that must never
 * say a rookie has no future is the one whose whole subject is the future.
 */
export function futureScore(summary: RosterSummary, settings: LeagueSettings): number {
  const projected: ValuedPlayer[] = summary.players.map((entry) => {
    // Decay the tiebreaker alongside the value it breaks ties for. Leaving
    // marketValue undecayed would rank a 35-year-old above a 24-year-old among
    // players who project to the same lineup contribution — backwards, in the
    // one calculation whose entire subject is aging.
    const factor = retention(entry.player.position, entry.player.age, HORIZON_YEARS);
    return {
      ...entry,
      value: Math.round(entry.value * factor),
      marketValue: Math.round(entry.marketValue * factor),
      winNowValue: Math.round(entry.winNowValue * factor),
    };
  });
  // `byValue` explicitly: this lineup is the asset projection, so it must be
  // picked on the scale it is summed on.
  return bestLineup(projected, settings.startingSlots, byValue).reduce(
    (sum, slot) => sum + (slot.entry?.value ?? 0),
    0,
  );
}

const QUADRANTS: Record<Quadrant, { label: string; advice: string }> = {
  juggernaut: {
    label: 'Juggernaut',
    advice:
      'Strong now and still young. Press the advantage — you can afford to trade future picks for the last piece.',
  },
  win_now: {
    label: 'Window closing',
    advice:
      'Strong now but aging. This is your year to go all in; that core will not hold its value much longer.',
  },
  rebuilding: {
    label: 'Rebuilding on schedule',
    advice:
      'Weak now but young. Let the core mature, and sell the veterans who will not be here for the next good team — while keeping enough starters to stay in games.',
  },
  danger: {
    label: 'Danger zone',
    advice:
      'Weak now and aging. Sell the veterans whose value is peaking, but spend what you get on players who can start for you next season. A full teardown costs two years and makes the league worse for everyone in it.',
  },
};

export function contentionProfile(
  summary: RosterSummary,
  all: RosterSummary[],
  settings: LeagueSettings,
): ContentionProfile {
  const nowScores = all.map((s) => s.starterValue);
  const futureScores = all.map((s) => futureScore(s, settings));

  const now = summary.starterValue;
  const future = futureScore(summary, settings);

  // The future axis has to measure the *shape* of a roster, not its quality a
  // second time. Decay is roughly proportional to value, so absolute future
  // score ranks teams in nearly the same order as now: verified on a real
  // 10-team league, where the two orderings matched at the median split and
  // every team came out either juggernaut or danger — win_now and rebuilding
  // never occurred at all.
  //
  // The ratio has no such problem. It is scale-free, so a weak young roster and
  // a strong young roster both read as young, which is the distinction the
  // quadrant exists to draw.
  const retained = (n: number, f: number) => f / (n || 1);
  const retainedShare = retained(now, future);

  const retainedShares = nowScores.map((n, i) => retained(n, futureScores[i]));

  const strongNow = now >= median(nowScores);
  const strongFuture = retainedShare >= median(retainedShares);

  const quadrant: Quadrant = strongNow
    ? strongFuture
      ? 'juggernaut'
      : 'win_now'
    : strongFuture
      ? 'rebuilding'
      : 'danger';

  // Fraction of the league this team is at or above. A single team is its own
  // whole league and sits in the middle of it rather than at an extreme.
  const share = (value: number, population: number[]) =>
    population.length <= 1
      ? 0.5
      : population.filter((v) => v < value).length / (population.length - 1);

  return {
    nowScore: now,
    futureScore: future,
    nowRank: nowScores.filter((v) => v > now).length + 1,
    futureRank: futureScores.filter((v) => v > future).length + 1,
    retainedShare,
    teamCount: all.length,
    nowShare: share(now, nowScores),
    youthShare: share(retainedShare, retainedShares),
    quadrant,
    ...QUADRANTS[quadrant],
  };
}

export function analyzeTeam(
  rosterId: number,
  all: RosterSummary[],
  settings: LeagueSettings,
): TeamAnalysis | null {
  const summary = all.find((s) => s.rosterId === rosterId);
  if (!summary) return null;

  const byRoster = all.map((s) => ({ summary: s, positional: positionalStarterValue(s) }));
  const mine = positionalStarterValue(summary);

  const positions: PositionalStrength[] = SKILL_POSITIONS.map((position) => {
    const league = byRoster.map((r) => r.positional[position] ?? 0);
    const leagueMedian = median(league);
    const mean = league.reduce((a, b) => a + b, 0) / (league.length || 1);
    const variance =
      league.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (league.length || 1);
    const stdDev = Math.sqrt(variance);
    const starterValue = mine[position] ?? 0;
    const z = stdDev > 0 ? (starterValue - mean) / stdDev : 0;

    return {
      position,
      starterValue,
      leagueMedian,
      z,
      verdict: z >= 0.75 ? 'strength' : z <= -0.75 ? 'weakness' : 'neutral',
    };
  });

  // For each position, the weakest player each roster currently starts there.
  // Beating it means a bench player would displace that starter — which is the
  // only definition of "surplus" that translates into a tradeable asset.
  //
  // Measured in win-now units on both sides of the comparison, because
  // displacing a starter is a lineup decision. On the dynasty scale the test
  // reported every expensive rookie as a surplus his owner should trade: he
  // out-priced somebody's worst starter, so the model said he would start
  // there, when in fact no manager in the league would have played him.
  const weakestStarter: Partial<Record<Position, number[]>> = {};
  for (const position of SKILL_POSITIONS) {
    weakestStarter[position] = byRoster.map(({ summary: s }) => {
      const atPosition = s.lineup
        .filter((slot) => slot.entry?.player.position === position)
        .map((slot) => slot.entry?.winNowValue ?? 0);
      // A roster with nobody starting at the position has a hole worth 0, so
      // anyone would be an upgrade there.
      return atPosition.length > 0 ? Math.min(...atPosition) : 0;
    });
  }

  const surpluses: SurplusAsset[] = summary.players
    .filter((entry) => !summary.starterIds.has(entry.player.id))
    .filter((entry) => SKILL_POSITIONS.includes(entry.player.position))
    // Dynasty value, not win-now: a player worth nothing this season is still a
    // tradeable asset, and this filter is only rejecting players worth nothing
    // at all.
    .filter((entry) => entry.value > 0)
    .map((entry) => ({
      player: entry.player,
      value: entry.value,
      wouldStartOn: (weakestStarter[entry.player.position] ?? []).filter(
        (weakest, i) =>
          byRoster[i].summary.rosterId !== rosterId && entry.winNowValue > weakest,
      ).length,
    }))
    // Surplus means someone else would actually start him. Measuring against
    // the league *median* starter instead sets the bar so high that deep
    // rosters report no surplus at all, which is never true in practice.
    .filter((surplus) => surplus.wouldStartOn > 0)
    .sort((a, b) => b.wouldStartOn - a.wouldStartOn || b.value - a.value)
    .slice(0, 6);

  const contention = contentionProfile(summary, all, settings);
  const strengths = positions.filter((p) => p.verdict === 'strength');
  const weaknesses = positions.filter((p) => p.verdict === 'weakness');

  const focus: string[] = [contention.advice];

  if (weaknesses.length > 0) {
    const worst = [...weaknesses].sort((a, b) => a.z - b.z)[0];
    focus.push(
      `Your weakest spot is ${worst.position}: ${Math.round(worst.starterValue).toLocaleString()} of starting value against a league median of ${Math.round(worst.leagueMedian).toLocaleString()}.`,
    );
  }

  if (surpluses.length > 0) {
    const best = surpluses[0];
    focus.push(
      `${best.player.name} is your most tradeable surplus — benched here, but would start for ${best.wouldStartOn} other ${best.wouldStartOn === 1 ? 'team' : 'teams'}.`,
    );
  }

  const agingStarters = summary.lineup
    .map((slot) => slot.entry)
    .filter(
      (entry): entry is ValuedPlayer =>
        entry !== null &&
        entry !== undefined &&
        entry.player.age !== null &&
        entry.player.age >= (AGE_CLIFF[entry.player.position] ?? 99),
    );

  if (agingStarters.length > 0) {
    focus.push(
      `${agingStarters.length} of your starters ${agingStarters.length === 1 ? 'is' : 'are'} past the age cliff: ${agingStarters
        .map((e) => `${e.player.name} (${e.player.position}, ${e.player.age})`)
        .join(', ')}. Sell before the market notices.`,
    );
  }

  return { rosterId, positions, strengths, weaknesses, surpluses, contention, focus };
}
