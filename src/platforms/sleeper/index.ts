import type { Player } from '../../types';
import type { LeagueBundle, LeagueProvider } from '../types';
import { getLeague, getPlayers, getRosters, getUsers, parseLeagueId } from './client';
import { mapLeague, mapPlayer } from './mapper';

export const sleeperProvider: LeagueProvider = {
  id: 'sleeper',
  label: 'Sleeper',
  parseLeagueId,

  async loadLeague(leagueId: string): Promise<LeagueBundle> {
    // League, rosters and users are independent; the player index is usually a
    // warm cache hit. Fetch them together rather than waterfalling.
    const [rawLeague, rawRosters, rawUsers, playerIndex] = await Promise.all([
      getLeague(leagueId),
      getRosters(leagueId),
      getUsers(leagueId),
      getPlayers(),
    ]);

    const league = mapLeague(rawLeague, rawRosters, rawUsers);

    // Keep only players this league actually rosters.
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

    return { league, players };
  },
};
