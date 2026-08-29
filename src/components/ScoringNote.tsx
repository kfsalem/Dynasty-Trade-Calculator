import type { ScoringFidelity } from '../engine/scoringCheck';
import { describeRules, joinWords } from '../lib/scoringText';

interface Props {
  fidelity: ScoringFidelity | undefined;
}

const count = (n: number) => n.toLocaleString('en-US');

/**
 * What this app can and cannot reproduce of the league's own scoring.
 *
 * Every other number in here is a model, and a model can only be argued for.
 * This one has an oracle: Sleeper publishes the points it actually paid, so the
 * app can check its own arithmetic against the league it is running in and show
 * the result. That is the difference between "supports custom scoring" and
 * "reproduces your scoring, and here is the evidence".
 *
 * It is deliberately quiet when there is nothing to report. A league this
 * engine scores exactly gets one short line; a league it cannot gets told which
 * rules, in words rather than in Sleeper's key names.
 *
 * **It reports the check, not the prices.** Nothing in the app values players
 * in league points yet — that is the follow-up this issue was split from — so a
 * note reading "scored in your league's own rules" would be describing a
 * capability as though it were a number on screen. When replacement level
 * starts reading `scoringIsUsable`, this copy gains a sentence about pricing
 * and not before.
 */
export function ScoringNote({ fidelity }: Props) {
  if (!fidelity) return null;

  const { verdict, compared, exact, unreachable, unknown } = fidelity;
  const missing = describeRules([...unreachable, ...unknown]);

  // Nothing has been played, and nothing is wrong. Saying "checked 0 of 0" or
  // claiming success would both be worse than staying silent — the header
  // badges already say what the league's rules are.
  if (verdict === 'unchecked' && missing.length === 0) return null;

  const checked =
    compared > 0
      ? `${count(exact)} of ${count(compared)} player-weeks match Sleeper's own totals exactly`
      : null;

  if (verdict === 'unreliable') {
    return (
      <p className="mt-3 rounded-lg border border-caution bg-caution-soft p-3 text-sm text-caution">
        Scoring check: this app reproduces {checked ?? 'none of your league'} — too far
        off to price anything on. Player values here come from market prices, which is
        what they would have done regardless.
      </p>
    );
  }

  return (
    <p className="mt-3 rounded-lg border border-line bg-raised p-3 text-sm text-muted">
      {verdict === 'exact' ? (
        <>Scoring check: this app reproduces your league's rules exactly — {checked}.</>
      ) : (
        <>
          Scoring check
          {checked ? `: ${checked}` : ' on your league’s rules'}. Not counted:{' '}
          {joinWords(missing)} — nflverse publishes weekly totals, which cannot say how
          long a touchdown was.
        </>
      )}
    </p>
  );
}
