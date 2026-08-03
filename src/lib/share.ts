import type { DraftPick, League } from '../types';

/**
 * A trade, in a URL.
 *
 * The growth loop, and close to free: a proposed trade is already nothing but a
 * league, two roster ids and four lists of asset ids, so the only real work is
 * choosing a shape that survives being pasted into a league group chat and
 * opened a week later by someone who has never used the app.
 *
 * Seven query parameters rather than one opaque blob:
 *
 * | param | meaning                        |
 * |-------|--------------------------------|
 * | `l`   | league id                      |
 * | `a`   | roster id of the left side     |
 * | `b`   | roster id of the right side    |
 * | `ap`  | players the left side sends    |
 * | `ak`  | picks the left side sends      |
 * | `bp`  | players the right side sends   |
 * | `bk`  | picks the right side sends     |
 *
 * Base64 of a JSON object would be shorter to write and worse to own. This is
 * legible in the address bar, diffable when someone reports that a link "opened
 * the wrong trade", and it cannot silently mean something else after a refactor
 * renames a field. Lists join on `_` because it is one of the five characters
 * `URLSearchParams` leaves alone — a comma comes back as `%2C` and turns a
 * shareable link into an eyesore.
 *
 * Players and picks are kept in separate parameters rather than one list split
 * by shape on the way out. Telling them apart by pattern works today, since a
 * pick id carries hyphens and a player id does not, but it makes the format
 * depend on a coincidence of two id schemes this app does not own.
 */
export interface TradeSelection {
  teamA: number;
  teamB: number;
  givesA: { playerIds: string[]; pickIds: string[] };
  givesB: { playerIds: string[]; pickIds: string[] };
}

export interface SharedTrade extends TradeSelection {
  leagueId: string;
}

const joinIds = (ids: string[]): string => [...ids].sort().join('_');

/**
 * Ids are sorted, so the same trade always produces the same link.
 *
 * Not cosmetic: the address bar is rewritten on every edit, and an unstable
 * ordering would make the URL churn while the trade sat unchanged — which
 * matters most in the case this feature exists for, where two people compare
 * links to check they are looking at the same offer.
 */
export function encodeTrade(trade: SharedTrade): string {
  const params = new URLSearchParams();
  params.set('l', trade.leagueId);
  params.set('a', String(trade.teamA));
  params.set('b', String(trade.teamB));

  const put = (key: string, ids: string[]) => {
    if (ids.length > 0) params.set(key, joinIds(ids));
  };
  put('ap', trade.givesA.playerIds);
  put('ak', trade.givesA.pickIds);
  put('bp', trade.givesB.playerIds);
  put('bk', trade.givesB.pickIds);

  return `?${params.toString()}`;
}

const rosterId = (raw: string | null): number | null => {
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
};

const splitIds = (raw: string | null): string[] =>
  raw ? raw.split('_').filter((id) => id.length > 0) : [];

/**
 * Read a shared trade out of a query string, or `null` if there isn't one.
 *
 * Every failure is the same failure — a link somebody edited, truncated, or
 * had mangled by a chat client that stopped the URL at a punctuation mark — and
 * the answer to all of them is to ignore the trade and open the app normally.
 * Nothing here throws, because a malformed link must not be able to take down a
 * page that would otherwise work perfectly.
 *
 * A link naming the same roster twice is rejected rather than repaired. The
 * builder cannot show a team trading with itself, so "repairing" it would mean
 * inventing an opponent, and a trade nobody proposed is worse than no trade.
 */
export function decodeTrade(search: string): SharedTrade | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }

  const leagueId = params.get('l');
  const teamA = rosterId(params.get('a'));
  const teamB = rosterId(params.get('b'));

  if (!leagueId || teamA === null || teamB === null || teamA === teamB) return null;

  const trade: SharedTrade = {
    leagueId,
    teamA,
    teamB,
    givesA: { playerIds: splitIds(params.get('ap')), pickIds: splitIds(params.get('ak')) },
    givesB: { playerIds: splitIds(params.get('bp')), pickIds: splitIds(params.get('bk')) },
  };

  const assets =
    trade.givesA.playerIds.length +
    trade.givesA.pickIds.length +
    trade.givesB.playerIds.length +
    trade.givesB.pickIds.length;

  // A link naming two teams and no assets is not a trade. Treating it as one
  // would land the recipient on an empty calculator with two dropdowns set,
  // which reads as the app having lost their link.
  return assets > 0 ? trade : null;
}

export interface ResolvedShare {
  trade: TradeSelection;
  /**
   * Assets in the link that the sending roster no longer holds.
   *
   * Rosters move. A link shared on Tuesday and opened after a waiver claim
   * describes a trade that no longer exists, and `evaluateTrade` would quietly
   * drop the missing ids and price whatever was left — showing a different
   * offer under the same URL, with nothing on the page to say so.
   */
  dropped: number;
}

/**
 * Check a shared trade against the league it claims to describe.
 *
 * Returns `null` when either roster id is not in this league, which is the one
 * failure that must be caught rather than tolerated: `buildSide` throws on an
 * unknown roster, so a hand-edited `?a=99` would take the render down with it.
 *
 * Membership is checked per side, not merely globally, because the asset picker
 * only ever shows a roster its own players. An id belonging to some *other*
 * team would price into the trade totals while appearing nowhere in the two
 * columns above them.
 */
export function resolveShare(
  shared: SharedTrade,
  league: League,
  picks: DraftPick[],
): ResolvedShare | null {
  const rosterOf = (id: number) => league.rosters.find((r) => r.rosterId === id);
  const rosterA = rosterOf(shared.teamA);
  const rosterB = rosterOf(shared.teamB);
  if (!rosterA || !rosterB) return null;

  let dropped = 0;
  const keep = <T>(ids: string[], held: (id: string) => T | undefined | boolean): string[] => {
    const kept = ids.filter((id) => Boolean(held(id)));
    dropped += ids.length - kept.length;
    return kept;
  };

  const side = (
    roster: typeof rosterA,
    gives: { playerIds: string[]; pickIds: string[] },
  ) => {
    const owned = new Set(roster.playerIds);
    return {
      playerIds: keep(gives.playerIds, (id) => owned.has(id)),
      pickIds: keep(gives.pickIds, (id) =>
        picks.some((p) => p.id === id && p.ownerRosterId === roster.rosterId),
      ),
    };
  };

  return {
    trade: {
      teamA: shared.teamA,
      teamB: shared.teamB,
      givesA: side(rosterA, shared.givesA),
      givesB: side(rosterB, shared.givesB),
    },
    dropped,
  };
}
