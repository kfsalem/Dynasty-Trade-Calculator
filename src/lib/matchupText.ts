import type { MatchupOdds } from '../engine/matchup';
import { COIN_FLIP } from '../engine/projections';
import { formatChance, formatPoints } from './format';

/**
 * The matchup line, in words (#162).
 *
 * A verdict, one figure and a line of totals — the same order every tab uses.
 * `COIN_FLIP` is borrowed from the per-player calls on purpose: it is where
 * this app stops claiming to know, and a matchup that is 53% is no more of a
 * call than a start/sit that is.
 */
export interface MatchupText {
  headline: string;
  /** The win chance, or "Final" once the week is over. */
  figure: string;
  totals: string;
  /** About the opponent's lineup, when there is something to say. */
  note: string | null;
}

export function matchupText(
  odds: MatchupOdds,
  opponent: string,
  { bestBall = false }: { bestBall?: boolean } = {},
): MatchupText {
  const me = formatPoints(odds.me.expected);
  const them = formatPoints(odds.them.expected);

  if (odds.final) {
    const margin = odds.me.expected - odds.them.expected;
    return {
      headline:
        margin > 0
          ? `You beat ${opponent}`
          : margin < 0
            ? `${opponent} beat you`
            : `You tied ${opponent}`,
      figure: 'Final',
      totals: `${me} to ${them}.`,
      note: null,
    };
  }

  const headline =
    odds.chance >= COIN_FLIP
      ? `You're favoured against ${opponent}`
      : odds.chance <= 1 - COIN_FLIP
        ? `${opponent} is favoured`
        : `A coin flip against ${opponent}`;

  const totals = odds.underway
    ? `Expected ${me} to ${them}, with ${formatPoints(odds.me.scored)} and ${formatPoints(
        odds.them.scored,
      )} already final.`
    : `Projected ${me} to ${them}.`;

  /*
    Nothing about the opponent's lineup in best ball: the platform scores his
    best one whatever he sets, so a worse set lineup is not a weakness.
  */
  let note: string | null = null;
  if (!bestBall && odds.asSet) {
    const short = formatPoints(odds.them.expected - odds.asSet.expected);
    note = `${opponent}'s lineup as set projects ${formatPoints(odds.asSet.expected)}, ${short} short of their best. If they leave it, you win ${formatChance(odds.asSet.chance)} of the time.`;
  } else if (!bestBall && odds.themUnset) {
    note = `${opponent} has not set a lineup yet, so this assumes they set their best.`;
  }

  return { headline, figure: formatChance(odds.chance), totals, note };
}
