/**
 * Anything this app learns from one league's own record, with the confidence
 * that record supports.
 *
 * Every league-learned number shares a problem: it is strong in a league with
 * four seasons behind it and meaningless in one created last week. The obvious
 * fix — `if (observations < 20) return null` — is a cliff. It is invisible, it
 * puts two leagues one trade apart on opposite sides of a completely different
 * answer, and it is how the contention quadrant's median split happened.
 *
 * The shape instead:
 *
 * ```
 *   value  = (1 - w) * prior + w * estimate
 *   w      = observations / (observations + half)
 * ```
 *
 * `w` rises smoothly from zero, so a league with no history gets the prior
 * exactly, a league with a little history gets a little of its own, and nothing
 * ever jumps. This is a shrunk mean and deliberately nothing more.
 *
 * **The app has reached for this three times before this module existed**, which
 * is what makes it worth naming rather than writing a fourth time:
 *
 * - `playoffOdds.calibrate` shrinks a league's measured scoring model toward the
 *   generic assumption, with a half-life measured against a synthetic season —
 *   the same arithmetic as below, written by hand.
 * - `analysis.seasonOutlook` weights the standings against the roster
 *   projection by how much of the season has been played. A different weight
 *   function for a good reason; see `blend`.
 * - `suggest.windowWeights` interpolates the quadrant table bilinearly. Not this
 *   shape at all, and it stays where it is; see the note on it there.
 *
 * **Choosing `half` is the consumer's job, not this module's.** It is the
 * sample size at which a league's own record is trusted as much as the prior,
 * and it is different for every signal — a noisy ratio over 500 asset
 * observations and a count that means something at twenty do not converge at
 * the same rate. There is no default here on purpose: a shared default would be
 * a threshold picked by taste, wearing the clothes of arithmetic.
 */

/**
 * A number learned from a league, carrying how much league is behind it.
 *
 * Note what is absent: the raw estimate. Consumers read `value`, which is
 * already shrunk, and cannot reach past it to the unshrunk figure — the guard
 * is the type rather than a convention, so forgetting to shrink is a compile
 * error instead of a quiet bias. `observations` and `weight` are here for the
 * UI, which has to be able to say how much is known; see `lib/learnedText`.
 *
 * Generic in `T` so a consumer can carry a learned structure — a price index
 * per position, say — through the same envelope. The arithmetic below produces
 * `Learned<number>`, which is the only thing a shrunk mean can be.
 */
export interface Learned<T> {
  /** Already blended. The only figure a consumer should act on. */
  value: T;
  /** What it falls back to, and what it *is* at zero observations. */
  prior: T;
  /** How much of this league's own record is behind it. */
  observations: number;
  /** Where between prior and estimate `value` sits, 0-1. */
  weight: number;
}

/**
 * How far a sample of this size is believed: `n / (n + half)`.
 *
 * Zero at no evidence, half at `half`, and approaching but never reaching one.
 * Never reaching one is the point — a league's own record is always evidence
 * about a league rather than the last word on it, and a curve that saturates
 * would be a threshold again, just further along.
 */
export function trust(observations: number, half: number): number {
  if (!(observations > 0)) return 0;
  if (!(half > 0)) return 1;
  return observations / (observations + half);
}

/**
 * Blend an estimate toward a prior at a weight computed elsewhere.
 *
 * The escape hatch for evidence that is a *proportion of a known total* rather
 * than a count. The season is the standing example: fourteen weeks exist, six
 * have been played, and 6/14 is a better statement of how much football has
 * happened than any `n / (n + k)` curve could be — the denominator is known, so
 * there is nothing to estimate about it.
 *
 * `observations` is still carried, because the UI's sentence needs it whichever
 * way the weight was arrived at.
 */
export function blend(
  estimate: number,
  prior: number,
  weight: number,
  observations: number,
): Learned<number> {
  const w = Math.min(Math.max(weight, 0), 1);
  return {
    value: (1 - w) * prior + w * estimate,
    prior,
    observations,
    weight: w,
  };
}

/**
 * The standard form: shrink an estimate toward a prior by how much was seen.
 *
 * ```ts
 * const paid = learn(measuredFromTrades, marketPrice, trades, 40);
 * paid.value        // what to act on
 * paid.observations // what to tell the reader
 * ```
 *
 * A league with nothing to say gets the prior back, exactly and by
 * construction, rather than approximately.
 */
export function learn(
  estimate: number,
  prior: number,
  observations: number,
  half: number,
): Learned<number> {
  return blend(estimate, prior, trust(observations, half), observations);
}

/**
 * A prior nobody has any evidence about yet.
 *
 * For the branch where a consumer cannot even form an estimate — no completed
 * weeks, no trades, no season. Distinct from `learn(prior, prior, 0, k)` only
 * in intent, and worth having so that "we measured nothing" is written the same
 * way everywhere it happens.
 */
export const unlearned = <T>(prior: T): Learned<T> => ({
  value: prior,
  prior,
  observations: 0,
  weight: 0,
});
