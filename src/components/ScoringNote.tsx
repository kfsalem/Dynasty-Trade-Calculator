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
        Values here are priced off market rankings, not this league's scoring.{' '}
        {checked ? `Only ${checked}, ` : ''}
        which is too far off to trust — so the app is using the ranking it can stand
        behind rather than a number it cannot.
      </p>
    );
  }

  return (
    <p className="mt-3 rounded-lg border border-line bg-raised p-3 text-sm text-muted">
      {verdict === 'exact' ? (
        <>Scored in your league's own rules — {checked}.</>
      ) : (
        <>
          Scored in your league's own rules
          {checked ? `, and ${checked}` : ''}. Not counted:{' '}
          {joinWords(missing)} — nflverse publishes weekly totals, which cannot say how
          long a touchdown was.
        </>
      )}
    </p>
  );
}
