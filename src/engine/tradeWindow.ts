import type { LeagueSettings } from '../types';
import type { SeasonOdds } from './analysis';

/**
 * Whether this league is still taking trades, and how long for.
 *
 * The app had no idea a deadline existed. After one passes, every suggestion
 * the engine produces is noise and every "press your advantage" is advice about
 * a move that cannot be made; before one, the urgency is real and was never
 * stated. Both are the same missing fact.
 *
 * Separate from `disable_trades`, which is a league that never trades at all.
 * The two want different sentences from the UI, so they stay different
 * questions here rather than collapsing into one boolean.
 */
export interface TradeWindow {
  /** Whether a trade can still be made today. */
  open: boolean;
  /**
   * The deadline week, when the league publishes one that can actually arrive.
   *
   * Null covers the league with no deadline and the league whose deadline is
   * past the end of the season — see `mapTradeDeadline`, which resolves both to
   * null so that nothing downstream has to know about Sleeper's `99`.
   */
  deadline: number | null;
  /**
   * The week trading is happening in, or null when that is not known.
   *
   * Derived from how much football has been played rather than from a calendar:
   * `weeksPlayed` counts regular-season weeks with a result behind them, so the
   * week now in progress is the one after them. That is exactly the quantity a
   * deadline is measured against, and it comes free with the season odds the
   * advice already rests on — no new plumbing, and no second source of truth
   * about what week it is.
   */
  week: number | null;
  /**
   * Regular-season weeks left before trading closes, when both ends are known.
   *
   * Counts the current week as one of them: a deadline at the end of this week
   * still leaves this week to act in.
   */
  weeksLeft: number | null;
}

const OPEN: TradeWindow = { open: true, deadline: null, week: null, weeksLeft: null };

/**
 * Read the trade window from the league's rules and the state of its season.
 *
 * The safe direction is *open*. A window wrongly reported closed hides the
 * app's main feature behind a claim the reader knows to be false; one wrongly
 * reported open shows suggestions to somebody who cannot act on them, which is
 * where this app already was. So an unknown week — the offseason, the
 * preseason, a league whose schedule never loaded — leaves the window open,
 * and only a deadline that has demonstrably passed closes it.
 */
export function tradeWindow(
  settings: LeagueSettings,
  season: SeasonOdds | undefined,
): TradeWindow {
  const { tradeDeadline } = settings;
  if (tradeDeadline === null) return OPEN;

  // No season being played is not a closed window: dynasty leagues do most of
  // their trading in the offseason, and a week-11 deadline says nothing about
  // June. `season` is absent outside the regular season for exactly this
  // reason, so there is no week to compare against and none is invented.
  if (!season) return { ...OPEN, deadline: tradeDeadline };

  const week = season.weeksPlayed + 1;
  const weeksLeft = tradeDeadline - week + 1;

  return {
    open: weeksLeft > 0,
    deadline: tradeDeadline,
    week,
    weeksLeft: weeksLeft > 0 ? weeksLeft : null,
  };
}

/**
 * The deadline as a sentence, or null when there is nothing worth saying.
 *
 * Silent when the league has no deadline and when one is far enough off to be
 * somebody else's problem: a banner that shows all season is furniture, and
 * furniture is what people stop reading. It starts speaking with four weeks to
 * go, which is about when a contender still has time to do something about it.
 */
export const DEADLINE_SPEAKS_AT = 4;

export function deadlineNotice(window: TradeWindow): string | null {
  if (window.deadline === null) return null;

  if (!window.open) {
    return `This league's trade deadline passed in week ${window.deadline}. Nothing below can be acted on this season.`;
  }

  const { weeksLeft } = window;
  if (weeksLeft === null || weeksLeft > DEADLINE_SPEAKS_AT) return null;

  return weeksLeft === 1
    ? `Trades close at the end of week ${window.deadline} — this is the last week to make one.`
    : `Trades close after week ${window.deadline}: ${weeksLeft} weeks left, this one included.`;
}
