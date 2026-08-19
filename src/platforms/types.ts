import type { League, Matchup, Player, SeasonPhase } from '../types';
import type { KnownDraftOrder, TradedPickRef } from '../engine/picks';

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
  /**
   * Everyone on an NFL team that nobody in this league rosters.
   *
   * A separate field rather than a widening of `players`, and the separation is
   * load-bearing. Replacement level is derived from the rostered universe —
   * `bestLineup` over `players`, then `startersByPosition` — and it sets every
   * value in the app. A free agent leaking into `players` would move it
   * silently, in the same quiet way the clamp bug did (`docs/DESIGN.md`), and
   * the model is most sensitive to exactly this: a change in *who is being
   * ranked*. Two fields make that leak impossible rather than merely unlikely.
   *
   * Filtered to players on an actual NFL team. The slimmed index carries
   * several thousand more who are retired or unsigned, and nobody picks those
   * up.
   */
  freeAgents: Map<string, Player>;
  /** Picks that have changed hands. Untraded picks stay with their original roster. */
  tradedPicks: TradedPickRef[];
  /** Current real-world season, for deciding which draft classes are tradeable. */
  currentSeason: string;
  /**
   * Current NFL week, or null if the platform does not say.
   *
   * Decides how much of the schedule is still to play. Null is not zero — a
   * consumer that cannot tell which week it is should decline to answer rather
   * than simulate a season that has already happened.
   */
  currentWeek: number | null;
  /**
   * Which part of the calendar `currentWeek` is counting.
   *
   * Without it the number is ambiguous in the one direction that costs
   * something: preseason weeks count from 1 exactly like regular-season ones,
   * so August looks like September. `unknown` from a platform that does not
   * say. See `SeasonPhase`.
   */
  seasonPhase: SeasonPhase;
  /**
   * Draft orders the platform publishes, which beat any projection. Empty when
   * no draft has been set up yet, which is the normal state for seasons past
   * the next one.
   */
  draftOrders: KnownDraftOrder[];
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
  /**
   * The regular season's fixtures, weeks 1 through `throughWeek`.
   *
   * Separate from `loadLeague` because only one feature needs it and it costs a
   * request per week — nothing else in the app should wait on a schedule to
   * render a roster.
   *
   * Optional on purpose. A platform that does not publish a schedule, or
   * publishes one this app cannot read, costs the playoff-odds feature and
   * nothing else; the alternative is a required method that some provider has
   * to satisfy by lying.
   */
  loadSchedule?(leagueId: string, throughWeek: number): Promise<Matchup[]>;
}
