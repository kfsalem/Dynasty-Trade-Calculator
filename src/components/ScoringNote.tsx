import type { ScoringFidelity } from '../engine/scoringCheck';
import type { ScoringPremium } from '../engine/scoringPremium';
import { describeRules, joinWords, premiumSentence } from '../lib/scoringText';

interface Props {
  fidelity: ScoringFidelity | undefined;
  /** How the league's scoring moved each position against the market's. */
  premium?: ScoringPremium;
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
 * It reports the check *and*, now that something reads it, what the check
 * bought: the positions whose prices this league's scoring actually moved. The
 * two are kept as separate sentences because they are separate claims — one is
 * measured against Sleeper's own output, the other is a correction applied to
 * somebody else's prices.
 */
export function ScoringNote({ fidelity, premium }: Props) {
  if (!fidelity) return null;

  const { verdict, compared, exact, unreachable, unknown } = fidelity;
  const missing = describeRules([...unreachable, ...unknown]);
  // Only worth a sentence where it changed something. A league the market
  // already prices correctly gets no correction and no claim of one.
  const priced = premium?.measured ? premiumSentence(premium) : null;

  // Nothing has been played, and nothing is wrong. Saying "checked 0 of 0" or
  // claiming success would both be worse than staying silent — the header
  // badges already say what the league's rules are.
  if (verdict === 'unchecked' && missing.length === 0 && !priced) return null;

  const checked =
    compared > 0
      ? `${count(exact)} of ${count(compared)} player-weeks match Sleeper's own totals exactly`
      : null;

  // Nothing played, but rules this engine cannot express. The common state of
  // a dynasty league in August, and the one the copy below cannot describe: it
  // is built around a check that has not run, and saying "Scoring check" of a
  // check with no evidence behind it is the same overclaim in miniature.
  if (verdict === 'unchecked') {
    return (
      <p className="mt-3 rounded-lg border border-line bg-raised p-3 text-sm text-muted">
        {priced ? `${priced} ` : ''}No week has been played yet, so there is nothing to
        check that scoring against.{' '}
        {missing.length > 0 && (
          <>
            When there is, these will still not be counted: {joinWords(missing)} — nflverse
            publishes weekly totals, which cannot say how long a touchdown was.
          </>
        )}
      </p>
    );
  }

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
        <>
          Scoring check: this app reproduces your league's rules exactly — {checked}.
          {priced ? ` ${priced}` : ''}
        </>
      ) : (
        <>
          Scoring check: {checked}. Not counted: {joinWords(missing)} — nflverse
          publishes weekly totals, which cannot say how long a touchdown was.
          {priced ? ` ${priced}` : ''}
        </>
      )}
    </p>
  );
}
