import type { Learned } from '../engine/learned';

/**
 * How a league-learned number says how much it knows.
 *
 * One phrasing, shared, because the alternative is ten surfaces inventing ten
 * of them — and the sentence is not decoration. A learned figure shown without
 * its sample size is exactly the confident-and-wrong the transaction data is
 * capable of producing, and #48 is the standing lesson about calibrating on a
 * source nobody checked.
 *
 * The rule this enforces: **every league-learned number is displayed with the
 * evidence behind it.**
 *
 *     Your league pays about 18% over market for running backs
 *     — from 47 trades since 2023. Low confidence.
 *
 * The claim is the caller's; the clause after the dash is this module's, so it
 * reads the same wherever it appears.
 */

/**
 * The two fields of a `Learned` this module reads.
 *
 * A structural subset rather than the whole envelope, so that a figure carrying
 * its evidence in its own domain words can be described in the shared phrasing
 * without being repackaged — `ScoringModel` counts `weeks`, and shrinks three
 * numbers rather than one, so there is no single `Learned` to hand over. It
 * cannot reach a value either way, which keeps the guard intact: this module
 * writes sentences about evidence and never about the estimate.
 */
export type Evidence = Pick<Learned<unknown>, 'observations' | 'weight'>;

/** Singular and plural, because "from 1 trades" is how a tool loses trust. */
export interface Countable {
  one: string;
  many: string;
}

/**
 * The three words, cut at the thirds of the blend.
 *
 * Not tuned constants: below a third, the prior still supplies more than
 * two-thirds of the answer, and above two-thirds the league's own record does.
 * The cut points are properties of the arithmetic rather than opinions about
 * it.
 *
 * And they change only the *word*. The value itself moves continuously at every
 * sample size, so nothing an app does jumps as a league crosses one of these —
 * which is the whole distinction between describing confidence and thresholding
 * on it.
 */
export function describeConfidence(weight: number): string {
  if (weight < 1 / 3) return 'low confidence';
  if (weight < 2 / 3) return 'moderate confidence';
  return 'high confidence';
}

/** "47 trades", "1 trade", "no trades". */
export function countPhrase(n: number, noun: Countable): string {
  if (n <= 0) return `no ${noun.many}`;
  return `${n.toLocaleString('en-US')} ${n === 1 ? noun.one : noun.many}`;
}

/**
 * The evidence clause: what was seen, over what span, and how much it is worth.
 *
 * Returns the sentence a caller appends to its own claim. At zero observations
 * it says so plainly rather than reporting "low confidence" about a number that
 * contains no league at all — the value there *is* the prior, and a reader told
 * "low confidence" would reasonably think the league had said something quiet
 * rather than nothing.
 */
export function evidenceNote(
  learned: Evidence,
  noun: Countable,
  since?: string,
): string {
  const span = since ? ` since ${since}` : '';

  if (learned.observations <= 0) {
    return `No ${noun.many}${span} yet, so this is the starting assumption rather than your league's own record.`;
  }

  return `From ${countPhrase(learned.observations, noun)}${span} — ${describeConfidence(
    learned.weight,
  )}.`;
}
