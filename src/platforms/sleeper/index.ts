import type { Player } from '../../types';
import type { LeagueBundle, LeagueProvider } from '../types';
import type { KnownDraftOrder, TradedPickRef } from '../../engine/picks';
import {
  getDraft,
  getDrafts,
  getLeague,
  getPlayers,
  getRosters,
  getState,
  getTradedPicks,
  getUsers,
  parseLeagueId,
} from './client';
import { mapLeague, mapPlayer } from './mapper';

export const sleeperProvider: LeagueProvider = {
  id: 'sleeper',
  label: 'Sleeper',
  parseLeagueId,

  async loadLeague(leagueId: string): Promise<LeagueBundle> {
    // All independent; the player index is usually a warm cache hit. Fetch
    // together rather than waterfalling.
    const [rawLeague, rawRosters, rawUsers, playerIndex, rawTradedPicks, state] =
      await Promise.all([
        getLeague(leagueId),
        getRosters(leagueId),
        getUsers(leagueId),
        getPlayers(),
        // A league with no trades yet returns an empty array, not an error, but
        // don't let a pick-feed hiccup block the whole league from loading.
        getTradedPicks(leagueId).catch(() => []),
        getState().catch(() => null),
      ]);

    // Never blocks the league: without it picks fall back to a projected slot,
    // which is what every build before this one used for all of them.
    const draftOrders = await loadDraftOrders(leagueId).catch(() => []);

    const league = mapLeague(rawLeague, rawRosters, rawUsers);

    const players = new Map<string, Player>();
    for (const roster of league.rosters) {
      for (const id of roster.playerIds) {
        if (players.has(id)) continue;
        const slim = playerIndex[id];
        if (!slim) continue;
        const player = mapPlayer(slim);
        if (player) players.set(id, player);
      }
    }

    const tradedPicks: TradedPickRef[] = rawTradedPicks.map((p) => ({
      season: p.season,
      round: p.round,
      originalRosterId: p.roster_id,
      ownerRosterId: p.owner_id,
    }));

    return {
      league,
      players,
      tradedPicks,
      // Fall back to the league's own season if /state is unavailable.
      currentSeason: state?.season ?? league.season,
      draftOrders,
    };
  },
};

/**
 * The real draft order per season, where Sleeper has one.
 *
 * The list endpoint leaves out `slot_to_roster_id`, so each draft has to be
 * fetched in full. Dynasty leagues carry one or two, so this is a couple of
 * small requests rather than a fan-out worth worrying about.
 */
async function loadDraftOrders(leagueId: string): Promise<KnownDraftOrder[]> {
  const drafts = await getDrafts(leagueId);

  const detailed = await Promise.all(
    drafts.map((draft) => getDraft(draft.draft_id).catch(() => null)),
  );

  const orders: KnownDraftOrder[] = [];
  for (const draft of detailed) {
    if (!draft) continue;

    const slots = new Map<number, number>();
    for (const [slot, rosterId] of Object.entries(draft.slot_to_roster_id ?? {})) {
      const position = Number(slot);
      if (rosterId != null && Number.isFinite(position)) slots.set(rosterId, position);
    }

    // A draft with no order set yet is not an order.
    if (slots.size === 0) continue;
    orders.push({ season: draft.season, slots, snake: draft.type === 'snake' });
  }

  return orders;
}
