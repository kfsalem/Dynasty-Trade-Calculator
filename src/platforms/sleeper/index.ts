import type { Player } from '../../types';
import type { LeagueBundle, LeagueProvider } from '../types';
import type { TradedPickRef } from '../../engine/picks';
import {
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
    };
  },
};
