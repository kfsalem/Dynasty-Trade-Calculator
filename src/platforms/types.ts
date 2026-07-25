import type { League, Player } from '../types';

/**
 * Everything a loaded league needs, already in canonical form.
 *
 * Providers resolve their own player universe and hand back only the players
 * actually referenced by rosters, so callers never deal with a platform's
 * full player database or its id conventions.
 */
export interface LeagueBundle {
  league: League;
  players: Map<string, Player>;
}

/**
 * The seam that makes this multi-platform.
 *
 * Adding MyFantasyLeague or Fleaflicker means writing one more implementation
 * of this interface. No UI, hook, or engine code changes — nothing downstream
 * knows which platform a league came from.
 */
export interface LeagueProvider {
  id: League['platform'];
  label: string;
  /** Accept a raw id or a pasted league URL. Returns null if unrecognizable. */
  parseLeagueId(input: string): string | null;
  loadLeague(leagueId: string): Promise<LeagueBundle>;
}
