import type { Player, PlayerValue, Position } from '../types';
import type { RosterSummary } from './rosterValue';
import type { SnapShare } from './snapShare';
import type { Opportunity } from './opportunity';
import { roleShift, type ActivityAdjustment } from './activityFactor';
import { MATERIAL_DELTA } from './activity';

/**
 * Where the activity data is supposed to earn its keep.
 *
 * The market reprices a role change slowly — a back who took over a backfield
 * in October is still carrying his September price in November — so the gap
 * between what a player is worth and what his current role says he is worth is
 * a tradeable edge. Two lists fall out of it: players whose role has outgrown
 * their price, and players whose price has outlived their role.
 *
 * A row needs **two** things to be true, and the second one is easy to forget:
 *
 * 1. His role moved (`roleShift`) — the market is slow to reprice a change.
 * 2. The role he moved to is not already in his price (`rolePricing`).
 *
 * Ranking on (1) alone is what put Jahmyr Gibbs at the top of a buy-low list.
 * His snaps really did go from 64% to 76%, and he really is the second-most
 * expensive asset in dynasty football; both facts are true and the conclusion
 * does not follow. Worse, (1) alone is *systematically* wrong in that
 * direction: the gap is in value points, so the most expensive players clear
 * any threshold on the smallest percentage move, and the list fills with
 * exactly the players whose roles are most thoroughly priced.
 *
 * The ranking is still in **value points, not percent**, because that is the
 * unit the decision is made in. A 3% move on a 6,000-point starter is a bigger
 * edge than a 20% move on a 300-point bench body, and a list sorted by
 * percentage puts the bench body on top. The headroom test in (2) is a gate on
 * that ranking rather than a replacement for it.
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

/**
 * How far a player's role must sit from his price before the gap is tradeable.
 *
 * Expressed in percentile points at his own position: 0.05 means his role has
 * to rank at least five points of the position clear of what his price ranks,
 * in the direction the trend claims.
 *
 * Small on purpose. This is a *sanity gate*, not a second ranking — its job is
 * to throw out rows where the role is plainly already in the price, not to
 * reorder the ones that survive.
 */
export const MIN_HEADROOM = 0.05;

/**
 * Where a player's role ranks against where his price ranks, at his position.
 *
 * The question the change signal on its own cannot answer: **is that role
 * already in the price?**
 *
 * `roleShift` compares a player only against himself. It sees that Jahmyr Gibbs
 * went from 64% of the snaps to 76% and calls it a role that has outgrown its
 * price — but Gibbs is the second-most-expensive asset in dynasty football, and
 * there is no reading of the market under which it has failed to notice that he
 * is a workhorse. A rising workload on a player already priced as a workhorse is
 * a *reason he is expensive*, not a discount.
 *
 * So a row has to clear a second test: his role must rank meaningfully clear of
 * his price. Gibbs ranks at the very top on both and is filtered out. A back
 * playing like the RB8 while priced like the RB25 is exactly what survives, and
 * is what "buy low" has always meant to a dynasty manager — a good player whose
 * *price* is depressed, not merely one whose usage ticked up.
 */
export interface RolePricing {
  /** Share of the position's pool this player out-plays, 0-1. */
  role: number;
  /** Share of the position's pool this player out-prices, 0-1. */
  price: number;
  /** `role - price`. Positive means he plays above what his price says. */
  headroom: number;
}

/**
 * Midrank percentiles over one list, ties sharing a rank.
 *
 * Ties have to share, and at quarterback they are the normal case: every healthy
 * starter sits at or near 100% of the snaps, so a rule that broke those ties
 * arbitrarily would rank one starting quarterback above another on nothing.
 */
function percentiles(entries: readonly (readonly [string, number])[]): Map<string, number> {
  const sorted = [...entries].sort((a, b) => a[1] - b[1]);
  const out = new Map<string, number>();
  const n = sorted.length;
  if (n === 0) return out;

  for (let i = 0; i < n; ) {
    let j = i;
    while (j + 1 < n && sorted[j + 1][1] === sorted[i][1]) j++;
    const share = n === 1 ? 1 : (i + j) / 2 / (n - 1);
    for (let k = i; k <= j; k++) out.set(sorted[k][0], share);
    i = j + 1;
  }

  return out;
}

/**
 * Role and price percentiles for every player we can measure both for.
 *
 * The pool is *per position* and drawn from everyone with both a market value
 * and snap data — not just the rostered players. A receiver's role is only
 * meaningful against the other receivers in the league, and cutting the pool to
 * one league's rosters would make the same player rank differently in a 10-team
 * and a 14-team league for reasons that have nothing to do with him.
 *
 * Role is read from the recent window where there is one, because the question
 * is what he is doing *now*; the season average is the fallback for a player who
 * has not featured lately.
 */
export function rolePricing(
  values: Map<string, PlayerValue>,
  snaps: Map<string, SnapShare> | undefined,
): Map<string, RolePricing> {
  const out = new Map<string, RolePricing>();
  if (!snaps) return out;

  const pools = new Map<Position, { id: string; role: number; price: number }[]>();
  for (const [id, value] of values) {
    if (!value.position || value.marketValue <= 0) continue;
    const share = snaps.get(id);
    const role = share?.recent ?? share?.season ?? null;
    if (role === null || !Number.isFinite(role)) continue;

    const pool = pools.get(value.position) ?? [];
    pool.push({ id, role, price: value.marketValue });
    pools.set(value.position, pool);
  }

  for (const pool of pools.values()) {
    const byRole = percentiles(pool.map((p) => [p.id, p.role] as const));
    const byPrice = percentiles(pool.map((p) => [p.id, p.price] as const));

    for (const { id } of pool) {
      const role = byRole.get(id) ?? 0;
      const price = byPrice.get(id) ?? 0;
      out.set(id, { role, price, headroom: role - price });
    }
  }

  return out;
}

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
  /**
   * Where his role ranks against where his price ranks. Always present on a
   * listed trend — clearing the headroom gate is what put the row here.
   */
  pricing: RolePricing;
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
  const pricing = rolePricing(values, snaps);

  for (const summary of summaries) {
    for (const entry of summary.players) {
      const id = entry.player.id;
      const shift = roleShift(entry.player, { snaps: snaps?.get(id), usage: usage?.get(id) });

      if (shift.factor === 1 || shift.games < MIN_GAMES) continue;
      if (Math.abs(shift.factor - 1) < MIN_SHARE) continue;

      // At least one metric has to have moved by an amount that is a role
      // change rather than game script. `roleShift` *averages* snaps and usage
      // — right for pricing, since they are two views of one change — but that
      // average buries a real move in one column under a flat one beside it:
      // Jonathan Taylor's carry share went 73% to 85% on flat snaps and
      // averaged out to under six points.
      //
      // Reading the largest single move instead also settles a disagreement
      // between two things on the same screen. `MATERIAL_DELTA` is the bar the
      // roster snap column uses to draw its arrow at all, so without this the
      // panel listed Ja'Marr Chase as a sell-high on a five-point snap dip
      // while the column beside it showed no arrow for him — and the comment on
      // MIN_SHARE above already says a list that disagrees with its neighbour
      // reads as a bug in one of the two.
      const largest = Math.max(...shift.reasons.map((r) => Math.abs(r.to - r.from)), 0);
      if (largest < MATERIAL_DELTA) continue;

      // In season the multiplier is already inside `value`, so the unadjusted
      // base has to be divided back out or the gap would be counted twice. Out
      // of season nothing was applied and the value *is* the base.
      const value = values.get(id)?.value ?? entry.value;
      const base = current ? value / shift.factor : value;
      const gap = base * (shift.factor - 1);
      if (!Number.isFinite(gap) || gap === 0) continue;

      // The second test, and the reason these lists are worth reading. A move
      // is only tradeable if the resulting role is not already in the price —
      // otherwise the list leads with whoever is most expensive, since the
      // biggest names move the most value points on the smallest percentage.
      // Gibbs at 76% snaps is the case: a real rise, entirely priced.
      const seen = pricing.get(id);
      if (!seen) continue;
      const headroom = gap > 0 ? seen.headroom : -seen.headroom;
      if (headroom < MIN_HEADROOM) continue;

      const trend: RoleTrend = {
        player: entry.player,
        rosterId: summary.rosterId,
        gap,
        base,
        factor: shift.factor,
        games: shift.games,
        reasons: shift.reasons,
        thin: shift.games < THIN_GAMES,
        pricing: seen,
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
