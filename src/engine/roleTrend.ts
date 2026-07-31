import type { Player, PlayerValue } from '../types';
import type { RosterSummary } from './rosterValue';
import type { SnapShare } from './snapShare';
import type { Opportunity } from './opportunity';
import { roleShift, type ActivityAdjustment } from './activityFactor';

/**
 * Where the activity data is supposed to earn its keep.
 *
 * The market reprices a role change slowly — a back who took over a backfield
 * in October is still carrying his September price in November — so the gap
 * between what a player is worth and what his current role says he is worth is
 * a tradeable edge. Two lists fall out of it: players whose role has outgrown
 * their price, and players whose price has outlived their role.
 *
 * The ranking is in **value points, not percent**. A 3% move on a 6,000-point
 * starter is a bigger edge than a 20% move on a 300-point bench body, and a
 * list sorted by percentage puts the bench body on top — which is precisely
 * the trade nobody wants to make.
 */

/**
 * Games in the recent window below which a trend is not worth showing at all.
 *
 * A single game is not a role change, it is a game script. Two is a coin flip
 * that happens to have landed twice. `activityFactor` already discounts a thin
 * window through its confidence term, but discounting is not enough here:
 * these lists are read as *findings*, and a finding drawn from two games is
 * worse than no finding, because it costs the reader their attention and their
 * trust when it evaporates.
 */
export const MIN_GAMES = 3;

/**
 * Below this, the trend is shown but flagged as thin.
 *
 * The recent window is four weeks, so a player who missed one is at three and
 * genuinely has less behind him than a player who played all four — worth
 * saying out loud rather than silently ranking them as equals.
 */
export const THIN_GAMES = 4;

/**
 * Smallest move worth a row, as a share of value.
 *
 * Matches the rounding on the row marker: below half a percent the marker shows
 * nothing, and a list that disagreed with the column beside it would read as a
 * bug in one of the two.
 */
export const MIN_SHARE = 0.005;

export interface RoleTrend {
  player: Player;
  rosterId: number;
  /**
   * Value points the role change is worth, signed.
   *
   * Positive on the buy-low side, negative on the sell-high side. This is the
   * amount the multiplier moves — or would move — his value, which is the
   * number that decides whether the trade is worth making.
   */
  gap: number;
  /** Value before the role change is counted, so the two can be shown together. */
  base: number;
  factor: number;
  games: number;
  /** Metrics behind the move, most telling first. */
  reasons: ActivityAdjustment['reasons'];
  /** Set when the window is short enough that the reader should discount it. */
  thin: boolean;
}

export interface RoleTrends {
  /** Role has outgrown the price. Ranked by gap, largest first. */
  buyLow: RoleTrend[];
  /** Price has outlived the role. Ranked by gap, largest first. */
  sellHigh: RoleTrend[];
  /**
   * Whether these gaps are actually priced into `PlayerValue.value`.
   *
   * False through the offseason, where the trends are real but the multiplier
   * is deliberately not applied. The lists still compute — a role change last
   * November did happen, and refusing to say so would be a different lie from
   * the one the season gate exists to prevent — but a previewed gap must never
   * be read as money already in the value.
   */
  applied: boolean;
}

export interface RoleTrendInput {
  summaries: RosterSummary[];
  values: Map<string, PlayerValue>;
  snaps?: Map<string, SnapShare>;
  usage?: Map<string, Opportunity>;
  /**
   * Whether the activity data describes the season being played — i.e. whether
   * `valueLeague` applied these factors. Drives `applied`, and with it whether
   * a value has to be divided back out to recover the unadjusted base.
   */
  current: boolean;
  /** Entries per list. */
  limit?: number;
}

const EMPTY: RoleTrends = { buyLow: [], sellHigh: [], applied: false };

/**
 * Both lists, league-wide, ranked by the size of the gap.
 *
 * Runs over rostered players only. A free agent with a surging role is a real
 * signal but not a *trade*, and this feeds the suggestion engine.
 */
export function roleTrends({
  summaries,
  values,
  snaps,
  usage,
  current,
  limit = 8,
}: RoleTrendInput): RoleTrends {
  if (!snaps && !usage) return { ...EMPTY, applied: current };

  const buyLow: RoleTrend[] = [];
  const sellHigh: RoleTrend[] = [];

  for (const summary of summaries) {
    for (const entry of summary.players) {
      const id = entry.player.id;
      const shift = roleShift(entry.player, { snaps: snaps?.get(id), usage: usage?.get(id) });

      if (shift.factor === 1 || shift.games < MIN_GAMES) continue;
      if (Math.abs(shift.factor - 1) < MIN_SHARE) continue;

      // In season the multiplier is already inside `value`, so the unadjusted
      // base has to be divided back out or the gap would be counted twice. Out
      // of season nothing was applied and the value *is* the base.
      const value = values.get(id)?.value ?? entry.value;
      const base = current ? value / shift.factor : value;
      const gap = base * (shift.factor - 1);
      if (!Number.isFinite(gap) || gap === 0) continue;

      const trend: RoleTrend = {
        player: entry.player,
        rosterId: summary.rosterId,
        gap,
        base,
        factor: shift.factor,
        games: shift.games,
        reasons: shift.reasons,
        thin: shift.games < THIN_GAMES,
      };

      (gap > 0 ? buyLow : sellHigh).push(trend);
    }
  }

  // Both sorted by magnitude, so each list leads with its own biggest edge
  // rather than sell-high leading with its smallest.
  const byGap = (a: RoleTrend, b: RoleTrend) => Math.abs(b.gap) - Math.abs(a.gap);

  return {
    buyLow: buyLow.sort(byGap).slice(0, limit),
    sellHigh: sellHigh.sort(byGap).slice(0, limit),
    applied: current,
  };
}

/** The trends on one roster, for the team-level panels and the trade engine. */
export function trendsForRoster(
  trends: RoleTrends,
  rosterId: number,
): { buyLow: RoleTrend[]; sellHigh: RoleTrend[] } {
  return {
    buyLow: trends.buyLow.filter((t) => t.rosterId === rosterId),
    sellHigh: trends.sellHigh.filter((t) => t.rosterId === rosterId),
  };
}
