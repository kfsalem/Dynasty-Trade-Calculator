import type { ValueHistoryFile } from './valueHistory';

/**
 * How far a player's market price moved over a window you choose (#158).
 *
 * **The same figure FantasyCalc calls a trend, over more than one window.**
 * FantasyCalc publishes `trend30Day` with every value, and it is the price now
 * less the price about a month ago: on 2026-11-24 it correlated 0.983 (slope
 * 1.02) with this history's move from 10-27, across 390 1QB players. So the
 * history reproduces it, and can also say what happened over a week or since
 * the history began, which FantasyCalc cannot.
 *
 * **A record, not a forecast.** Over the spans the history held on 2026-11-24,
 * how far a player moved in one span said little about the next: the
 * correlation ran from −0.20 to +0.48 depending on the span and the price
 * floor, with no steady sign either way. A riser is not a sell and a faller is
 * not a buy, so nothing here is worded as advice.
 *
 * **Ranked by points, not by share.** Points are what a trade is priced in. A
 * share fills the list with cheap players, because a cheap player can double
 * on one good Sunday: in the superflex history for the four weeks to
 * 2026-11-24, even among players worth 1,000 at either end, all five top
 * risers by share started under 500. By points, the top five started at
 * 6,262, 1,979, 1,496, 128 and 72 — the starter whose price jumped leads, and a
 * breakout who became worth trading for still makes the list.
 *
 * **Only moves bigger than the typical one.** A quiet week still has a "top
 * five", and listing a 30-point drift as a riser would be true and useless. The
 * bar is the median absolute move of every player in the history over the same
 * window — in the superflex history to 2026-11-24, 76 points over a week and
 * 143 over four — so it grows with the window by itself and needs no constant
 * to tune.
 *
 * The market's raw price, at 10 teams and PPR for the league's QB setting, as
 * the history keeps it (`valueHistory`). Not the league-adjusted value shown
 * everywhere else, which depends on rosters on a day the history cannot replay.
 */

export type TrendWindowKey = 'week' | 'month' | 'all';

export interface TrendWindow {
  key: TrendWindowKey;
  /** The window's first and last points, as ISO dates and as indexes into `dates`. */
  start: string;
  end: string;
  startIndex: number;
  endIndex: number;
  /** Days between the two points: the span the figure actually covers. */
  days: number;
}

/** The windows a manager can pick, besides "since the history began". */
const NOMINAL: { key: Exclude<TrendWindowKey, 'all'>; days: number }[] = [
  { key: 'week', days: 7 },
  { key: 'month', days: 28 },
];

export const DEFAULT_TREND_WINDOW: TrendWindowKey = 'month';

const dayNumber = (date: string) => Date.parse(`${date}T12:00:00Z`) / 86_400_000;

/**
 * The windows the history can answer, newest point last in each.
 *
 * Each nominal window starts at the point nearest that many days before the
 * newest one, the older winning a tie so a window is never shorter than its
 * name by choice. In season the points are a week apart, so "1 week" and
 * "4 weeks" land exactly; out of season they are a month apart, so a window
 * that would have to stretch or shrink by more than a quarter of its length is
 * left out rather than mislabelled. A quarter lets a refresh a day early or
 * late still count as a week, and a calendar month count as four weeks. Two windows that start at the same point are
 * one window, and "since the history began" is added only when no other
 * window already starts there.
 */
export function trendWindows(dates: string[]): TrendWindow[] {
  if (dates.length < 2) return [];
  const endIndex = dates.length - 1;
  const end = dates[endIndex];
  const endDay = dayNumber(end);
  const span = (i: number) => endDay - dayNumber(dates[i]);
  const window = (key: TrendWindowKey, startIndex: number): TrendWindow => ({
    key,
    start: dates[startIndex],
    end,
    startIndex,
    endIndex,
    days: Math.round(span(startIndex)),
  });

  const out: TrendWindow[] = [];
  for (const { key, days } of NOMINAL) {
    let best = 0;
    for (let i = 1; i < endIndex; i++) {
      if (Math.abs(span(i) - days) < Math.abs(span(best) - days)) best = i;
    }
    if (Math.abs(span(best) - days) > days / 4) continue;
    if (out.some((w) => w.startIndex === best)) continue;
    out.push(window(key, best));
  }
  if (!out.some((w) => w.startIndex === 0)) out.push(window('all', 0));
  return out;
}

/**
 * The window to show for a preference: that one if the history has it, else
 * the default, else the longest there is. Null only for a history with fewer
 * than two points, which has no window at all.
 */
export function pickWindow(windows: TrendWindow[], key: TrendWindowKey): TrendWindow | null {
  return (
    windows.find((w) => w.key === key) ??
    windows.find((w) => w.key === DEFAULT_TREND_WINDOW) ??
    windows.at(-1) ??
    null
  );
}

export interface PriceMove {
  playerId: string;
  /** Dynasty value at the window's first and last points. */
  from: number;
  to: number;
  change: number;
  /** `change` as a share of `from`; null when he started at nothing. */
  share: number | null;
}

/**
 * One player's dynasty value at both ends of a window, or null when he was not
 * listed at either. A player FantasyCalc only started pricing inside the window
 * has no starting price, so he has no move to report — not a move from zero.
 */
export function priceMove(
  history: ValueHistoryFile,
  playerId: string,
  window: TrendWindow,
): PriceMove | null {
  const row = history.players[playerId];
  if (!row) return null;
  const from = row[1][window.startIndex];
  const to = row[1][window.endIndex];
  if (from == null || to == null) return null;
  const change = to - from;
  return { playerId, from, to, change, share: from > 0 ? change / from : null };
}

/**
 * The median absolute move over a window, across every player the history
 * priced at both ends: what "a typical player moved" means for that window.
 */
export function typicalMove(history: ValueHistoryFile, window: TrendWindow): number {
  const moves: number[] = [];
  for (const [, values] of Object.values(history.players)) {
    const from = values[window.startIndex];
    const to = values[window.endIndex];
    if (from != null && to != null) moves.push(Math.abs(to - from));
  }
  if (moves.length === 0) return 0;
  moves.sort((a, b) => a - b);
  const mid = moves.length >> 1;
  return moves.length % 2 ? moves[mid] : (moves[mid - 1] + moves[mid]) / 2;
}

export const MOVERS_SHOWN = 5;

export interface Movers {
  /** Largest gain first, every one bigger than `typical`. */
  rising: PriceMove[];
  /** Largest loss first, every one bigger than `typical`. */
  falling: PriceMove[];
  /** The bar a move had to clear, in market points. */
  typical: number;
  /** How many of the players asked about were priced at both ends. */
  priced: number;
}

/**
 * The biggest moves among some players — a roster, or a whole league — over a
 * window. Ties are broken by id, so the same history always lists the same
 * players in the same order.
 */
export function marketMovers(
  history: ValueHistoryFile,
  playerIds: Iterable<string>,
  window: TrendWindow,
  limit = MOVERS_SHOWN,
): Movers {
  const typical = typicalMove(history, window);
  const moves = [...new Set(playerIds)]
    .map((id) => priceMove(history, id, window))
    .filter((move): move is PriceMove => move !== null);
  const byId = (a: PriceMove, b: PriceMove) => a.playerId.localeCompare(b.playerId);

  return {
    rising: moves
      .filter((m) => m.change > typical)
      .sort((a, b) => b.change - a.change || byId(a, b))
      .slice(0, limit),
    falling: moves
      .filter((m) => m.change < -typical)
      .sort((a, b) => a.change - b.change || byId(a, b))
      .slice(0, limit),
    typical,
    priced: moves.length,
  };
}
