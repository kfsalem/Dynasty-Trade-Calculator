import type { Player } from '../types';
import type { SnapShare } from './snapShare';
import type { Opportunity } from './opportunity';

/**
 * How much a player's current role should move his dynasty value.
 *
 * The market prices a player's *expected future role*. It already knows a
 * starter starts. What it is slow at is a role that has just changed — a back
 * whose snap share went from a third to two thirds over a month is a different
 * asset than his price says, and will stay mispriced for weeks. So the signal
 * here is deliberately the **change** in role, not its level: the level is
 * already in the price, and charging for it again would be double-counting the
 * single largest thing dynasty value is made of.
 *
 * Everything below is shaped by the clamp bug written up in `docs/DESIGN.md`.
 * This multiplier feeds `bestLineup`, which sets the starter counts, which set
 * replacement level, which sets value — so anything that collapses players onto
 * a shared number here would restart exactly that feedback loop. Hence tanh
 * rather than a clamp: it saturates smoothly and never actually reaches its
 * bound, so two players with different activity always get different factors,
 * however extreme either is.
 */

/**
 * Most the factor can ever move a value, in either direction.
 *
 * Activity refines a dynasty price; it does not replace it. A rookie receiver
 * on 20% of snaps in Week 3 is not worth a quarter of his dynasty value, and a
 * multiplier free to say so would be worse than no multiplier at all.
 */
export const MAX_SWING = 0.25;

/**
 * Share-point change that counts as a large move.
 *
 * At fifteen points tanh returns 0.76, so a back going from a third of the
 * snaps to half gets most of the available adjustment; thirty points gets 0.96.
 * Beyond that the curve flattens without ever going flat.
 */
const SIGNAL_SCALE = 0.15;

/** Recent games at which the signal is trusted to ~0.8 of its face value. */
const CONFIDENCE_GAMES = 1;

/**
 * How much a player's current role should say about his dynasty value, by age.
 *
 * A 22-year-old's price is mostly a bet on years three through eight, which
 * this season's snap share barely speaks to. A 29-year-old's price is very
 * nearly a statement about his current role, so a change in that role is close
 * to the whole story. Weighting them identically would let four good games
 * reprice a rookie on the strength of evidence that says almost nothing about
 * the thing being priced.
 */
const AGE_ANCHORS: readonly (readonly [age: number, weight: number])[] = [
  [22, 0.35],
  [26, 0.7],
  [30, 1],
];

/** Used when a player's age is unknown: the middle of the curve, not an extreme. */
const DEFAULT_AGE_WEIGHT = 0.7;

export function ageWeight(age: number | null): number {
  if (age === null || !Number.isFinite(age)) return DEFAULT_AGE_WEIGHT;

  const first = AGE_ANCHORS[0];
  const last = AGE_ANCHORS[AGE_ANCHORS.length - 1];
  if (age <= first[0]) return first[1];
  if (age >= last[0]) return last[1];

  for (let i = 1; i < AGE_ANCHORS.length; i++) {
    const [prevAge, prevWeight] = AGE_ANCHORS[i - 1];
    const [nextAge, nextWeight] = AGE_ANCHORS[i];
    if (age > nextAge) continue;
    return prevWeight + ((age - prevAge) / (nextAge - prevAge)) * (nextWeight - prevWeight);
  }
  return last[1];
}

export interface ActivityInputs {
  snaps?: SnapShare;
  usage?: Opportunity;
  /**
   * Whether the activity data describes the season currently being played.
   *
   * False through the entire offseason, and it has to be. By July the market
   * has had months to absorb last season's usage, so re-applying it is not new
   * information — it is the same information twice. The factor degrades to
   * exactly 1.0 rather than to zero.
   */
  current: boolean;
}

export interface ActivityAdjustment {
  /** Bounded strictly inside (1 - MAX_SWING, 1 + MAX_SWING). Exactly 1 with no signal. */
  factor: number;
  /** Combined share-point move behind the factor, for explaining it. */
  signal: number;
  /**
   * Games in the recent window behind the move.
   *
   * Carried out of here rather than recomputed downstream, because the number
   * that decides whether a trend is worth showing has to be the same one that
   * decided how far to trust it. A two-game trend is noise, and a consumer
   * working that out from a different column would eventually disagree.
   */
  games: number;
  /** Metrics that contributed, most telling first, for explaining it. */
  reasons: { label: string; from: number; to: number }[];
}

const NEUTRAL: ActivityAdjustment = { factor: 1, signal: 0, games: 0, reasons: [] };

/**
 * A player's activity multiplier, as valuation consumes it.
 *
 * The season gate lives here rather than in `roleShift` because it is a
 * statement about *pricing*, not about evidence: a role really did change last
 * November, and saying otherwise would be false. What is not true in July is
 * that the change is news the market has yet to absorb, and only pricing
 * depends on that. R7 reads `roleShift` directly for exactly this reason.
 */
export function activityFactor(player: Player, activity: ActivityInputs): ActivityAdjustment {
  if (!activity.current) return NEUTRAL;
  return roleShift(player, activity);
}

/**
 * The same computation with no season gate: what this player's role did.
 *
 * Pure, and total: every path returns a finite number, because this multiplies
 * a value that decides lineups. A NaN here would not throw, it would silently
 * sort a roster wrong.
 */
export function roleShift(
  player: Player,
  activity: Omit<ActivityInputs, 'current'>,
): ActivityAdjustment {
  const moves: { label: string; delta: number; from: number; to: number }[] = [];
  let games = 0;

  const snaps = activity.snaps;
  if (snaps && snaps.recent !== null && snaps.delta !== null && Number.isFinite(snaps.delta)) {
    moves.push({ label: 'snaps', delta: snaps.delta, from: snaps.season, to: snaps.recent });
    games = Math.max(games, snaps.recentGames);
  }

  // Position-appropriate by construction: R4 already decided that a back is
  // measured on carries and a receiver on targets, so whatever leads his list
  // is the right thing to read here.
  const headline = activity.usage?.headline;
  if (
    headline &&
    headline.kind === 'share' &&
    headline.window.recent !== null &&
    headline.window.delta !== null &&
    Number.isFinite(headline.window.delta)
  ) {
    moves.push({
      label: headline.label.toLowerCase(),
      delta: headline.window.delta,
      from: headline.window.season,
      to: headline.window.recent,
    });
    games = Math.max(games, headline.window.recentGames);
  }

  if (moves.length === 0 || games === 0) return NEUTRAL;

  // Snap share and usage share are two views of one role change, so they are
  // averaged rather than added — a back who gained snaps *and* carries has not
  // changed twice over.
  const signal = moves.reduce((sum, move) => sum + move.delta, 0) / moves.length;
  if (!Number.isFinite(signal)) return NEUTRAL;

  const confidence = games / (games + CONFIDENCE_GAMES);
  const strength = Math.tanh(signal / SIGNAL_SCALE);
  const factor = 1 + MAX_SWING * strength * confidence * ageWeight(player.age);

  return {
    factor,
    signal,
    games,
    reasons: moves
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .map(({ label, from, to }) => ({ label, from, to })),
  };
}
