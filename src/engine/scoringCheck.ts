import type { ScoringFile } from '../data/types';
import type { AwardedPoints } from '../platforms/types';
import type { ScoringSettings } from '../types';
import { classifyRules, scoreStatLine, statLine } from './scoring';

/**
 * Ask the league whether this app can score it.
 *
 * Nothing else in this engine can do this. Replacement level, contention,
 * playoff odds — every one of them is a model, and a model can only be measured
 * against its own intent. Scoring is arithmetic over published fields, and the
 * platform publishes *its own answer* for every rostered player in every played
 * week, so the app can check itself against the league it is actually running
 * in and report what it finds.
 *
 * That is the difference between "we support custom scoring" and "we reproduce
 * your scoring, here is the evidence". A league whose rules this engine cannot
 * reproduce is detectable at runtime rather than being quietly priced wrong,
 * which is the failure the whole issue is about.
 */

/** Within a cent. Sleeper publishes to two decimals, so this is equality. */
const EXACT = 0.02;

/**
 * Enough agreement to price a league in its own points.
 *
 * Two bars rather than one, because the two failures are different. A low exact
 * rate with a tiny aggregate error is a league full of long-touchdown bonuses:
 * many players a point or two short, no systematic bias, and perfectly usable
 * for ranking. A large aggregate error is a rule this engine is not applying at
 * all, and that *does* move players against each other.
 */
const MIN_EXACT = 0.9;
const MAX_ERROR = 0.02;

export type ScoringVerdict = 'exact' | 'close' | 'unreliable' | 'unchecked';

export interface ScoringFidelity {
  /** Player-weeks compared against the platform's own output. */
  compared: number;
  /** How many of them matched to the cent. */
  exact: number;
  /** Signed share of total points this engine is off by. Negative is short. */
  error: number;
  /**
   * Rules this league scores that the engine cannot compute from weekly
   * aggregates — the long-touchdown bonuses and pick-sixes. Named, because a
   * league scoring them is scored slightly short and deserves to know which.
   */
  unreachable: string[];
  /** Rules Sleeper published that this engine has never heard of at all. */
  unknown: string[];
  verdict: ScoringVerdict;
}

const UNCHECKED: ScoringFidelity = {
  compared: 0,
  exact: 0,
  error: 0,
  unreachable: [],
  unknown: [],
  verdict: 'unchecked',
};

/**
 * Compare this engine's arithmetic against what the platform actually paid.
 *
 * Only players present in both is the right population, and deliberately so:
 * the awarded table covers everyone rostered, including defenses and players
 * nflverse has no row for, and scoring those as zero would manufacture a
 * disagreement out of a player this engine was never asked to score.
 *
 * `unchecked` is a real answer, not a failure. In August no week has been
 * played, there is nothing to check against, and saying so is better than
 * either guessing or hiding the feature.
 */
export function checkScoring(
  shipped: ScoringFile | null | undefined,
  awarded: AwardedPoints | undefined,
  scoring: ScoringSettings,
): ScoringFidelity {
  const rules = classifyRules(scoring);
  const named = { unreachable: rules.unreachable, unknown: rules.unknown };

  if (!shipped || !awarded || awarded.size === 0) return { ...UNCHECKED, ...named };

  let compared = 0;
  let exact = 0;
  let mine = 0;
  let theirs = 0;

  for (const [week, paid] of awarded) {
    for (const [playerId, points] of paid) {
      const player = shipped.players[playerId];
      if (!player) continue;
      const row = player.weeks.find((entry) => entry[0] === week);
      // No row is not a zero week: the ingest ships a row only where something
      // scoreable happened, so a player who did not play has nothing to compare
      // and a bye week is not evidence about the scoring rules.
      if (!row) continue;

      const computed = scoreStatLine(statLine(row), player.pos, scoring);
      compared++;
      if (Math.abs(computed - points) < EXACT) exact++;
      mine += computed;
      theirs += points;
    }
  }

  if (compared === 0) return { ...UNCHECKED, ...named };

  const error = theirs === 0 ? 0 : (mine - theirs) / theirs;
  const rate = exact / compared;

  return {
    compared,
    exact,
    error,
    ...named,
    verdict:
      rate === 1 && named.unreachable.length === 0 && named.unknown.length === 0
        ? 'exact'
        : rate >= MIN_EXACT && Math.abs(error) <= MAX_ERROR
          ? 'close'
          : 'unreliable',
  };
}

/**
 * Whether the app should price this league in its own points.
 *
 * The degrade path the issue asks for: a league this engine cannot reproduce
 * falls back to the market ranking rather than shipping quietly wrong numbers.
 * `unchecked` counts as usable — an unplayed season is not evidence of a
 * problem, and refusing to use league scoring every August would mean the
 * feature never works when a dynasty league is at its busiest.
 */
export const scoringIsUsable = (fidelity: ScoringFidelity): boolean =>
  fidelity.verdict !== 'unreliable';
