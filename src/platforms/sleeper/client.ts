import { fetchJson, ApiError } from '../../lib/http';
import { cached, TTL } from '../../lib/cache';
import {
  sleeperLeagueSchema,
  sleeperRostersSchema,
  sleeperUsersSchema,
  sleeperPlayersSchema,
  sleeperTradedPicksSchema,
  type SleeperLeague,
  type SleeperRoster,
  type SleeperUser,
  type SleeperTradedPick,
} from './schema';

const BASE = 'https://api.sleeper.app/v1';

/** The subset of Sleeper's player blob we actually keep. */
export interface SlimPlayer {
  id: string;
  name: string;
  position: string;
  team: string | null;
  age: number | null;
  yearsExp: number | null;
  injuryStatus: string | null;
}

export type PlayerIndex = Record<string, SlimPlayer>;

/** Positions we care about. Sleeper also ships every IDP and practice-squad body. */
const KEPT_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);

/**
 * Accepts a bare league ID or any Sleeper URL containing one.
 *
 * Users copy the address bar far more often than they dig out the raw ID, and
 * the public brief says a stranger should be able to get in on the first try.
 */
export function parseLeagueId(input: string): string | null {
  const trimmed = input.trim();
  if (/^\d{6,}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/(?:leagues?|draft)\/(\d{6,})/i) ?? trimmed.match(/(\d{15,})/);
  return match ? match[1] : null;
}

export function getLeague(leagueId: string): Promise<SleeperLeague> {
  return fetchJson(`${BASE}/league/${leagueId}`, sleeperLeagueSchema);
}

export function getRosters(leagueId: string): Promise<SleeperRoster[]> {
  return fetchJson(`${BASE}/league/${leagueId}/rosters`, sleeperRostersSchema);
}

export function getUsers(leagueId: string): Promise<SleeperUser[]> {
  return fetchJson(`${BASE}/league/${leagueId}/users`, sleeperUsersSchema);
}

export function getTradedPicks(leagueId: string): Promise<SleeperTradedPick[]> {
  return fetchJson(`${BASE}/league/${leagueId}/traded_picks`, sleeperTradedPicksSchema);
}

/**
 * The full player index (~5 MB, ~11k entries).
 *
 * Sleeper's docs explicitly ask callers to pull this no more than once a day,
 * so it is cached for 24h — and slimmed to offensive positions and the seven
 * fields we use before caching, which cuts it by well over an order of
 * magnitude and keeps rehydration fast.
 */
export function getPlayers(): Promise<PlayerIndex> {
  return cached('sleeper:players:v1', TTL.PLAYERS, async () => {
    const raw = await fetchJson(`${BASE}/players/nfl`, sleeperPlayersSchema);

    const index: PlayerIndex = {};
    for (const [id, p] of Object.entries(raw)) {
      const position = p.position ?? '';
      if (!KEPT_POSITIONS.has(position)) continue;

      const name =
        p.full_name ?? [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
      if (!name) continue;

      index[id] = {
        id,
        name,
        position,
        team: p.team ?? null,
        age: p.age ?? null,
        yearsExp: p.years_exp ?? null,
        injuryStatus: p.injury_status ?? null,
      };
    }

    if (Object.keys(index).length === 0) {
      throw new ApiError('Sleeper returned no usable players.');
    }
    return index;
  });
}
