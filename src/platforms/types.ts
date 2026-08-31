import type { League, LineupSlot, Matchup, Player, Position, SeasonPhase } from '../types';
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
 * What each platform says it paid each player, by week and then by player id.
 *
 * The oracle for `engine/scoring`. Every other number this app produces is a
 * model that can only be checked against its own intent; this one can be
 * checked against the league it is running in, because the platform publishes
 * the answer it actually used.
 *
 * Empty before a game has been played, which is the normal state of a league in
 * August — an absent week is "not yet", never "nobody scored".
 */
export type AwardedPoints = Map<number, Map<string, number>>;

/**
 * A season's fixtures, plus what the platform paid in them.
 *
 * One shape rather than two calls because they arrive in one response. Keeping
 * them apart would mean either fetching every week twice or inventing a cache
 * to avoid it.
 */
export interface Schedule {
  matchups: Matchup[];
  awarded: AwardedPoints;
}

/**
 * One roster's week, as the platform recorded it at the time.
 *
 * The past tense is the point. A roster feed knows one lineup — the last one
 * set — and one set of players: the ones there now. Everything a manager did
 * before this week is gone from it. This is the same facts per week, which is
 * the only form in which a season can be re-read.
 */
export interface WeekLineup {
  week: number;
  rosterId: number;
  /**
   * The lineup he set, positional and aligned to that season's starting slots.
   * `null` is a slot left empty; an empty array is a week that cannot be
   * aligned to the slots at all. See `mapSetLineup`.
   */
  starterIds: (string | null)[];
  /**
   * Everyone on the roster that week — IR and taxi included, deliberately.
   *
   * This is the pool the platform's own "potential points" is computed over,
   * measured: matching it is what lets `engine/benchPoints` check itself
   * against Sleeper's figure instead of asking to be believed. It is also the
   * only pool the API supports, since no endpoint publishes who was parked in
   * a given week — see `docs/ROADMAP.md`.
   */
  playerIds: string[];
  /** What each of them was paid that week, under the league's own rules. */
  points: Map<string, number>;
}

/**
 * One season of a league, as its own league.
 *
 * A dynasty league is a chain of them — every season is a separate league id on
 * Sleeper, joined by `previous_league_id`. They are not interchangeable:
 * starting slots, scoring and even the manager list move between seasons, so
 * every figure derived here has to be computed against the season it came from
 * rather than against the league as it stands today.
 */
export interface SeasonHistory {
  leagueId: string;
  season: string;
  /** That season's starting slots. They really do change year to year. */
  startingSlots: LineupSlot[];
  /**
   * Who owned each roster that season, keyed by the roster id of *that* season.
   *
   * `userId` is the identity that survives across seasons; `rosterId` is not,
   * and a history keyed on it attributes one manager's season to another the
   * first time a league reshuffles. Null for an orphan team, which is a real
   * state — one of the test leagues carries one through a whole season.
   */
  managers: Map<number, SeasonManager>;
  /** Every played week. An unplayed one is absent rather than zeroed. */
  weeks: WeekLineup[];
  /**
   * What the platform says each roster scored and could have scored, for the
   * season. Sleeper's own answer to the question `engine/benchPoints` asks.
   */
  claimed: Map<number, ClaimedTotals>;
}

export interface SeasonManager {
  userId: string | null;
  /** Display name, or a stand-in when the team had no owner. */
  name: string;
  teamName: string;
}

/** As much of a player as reading the past requires. */
export interface HistoryPlayer {
  position: Position;
  name: string;
}

/** A platform's own season totals: what it paid, and its own best lineup. */
export interface ClaimedTotals {
  scored: number;
  potential: number;
}

/**
 * Every season a league can reach, newest first, plus the positions to read it with.
 *
 * The positions ride along rather than being looked up by the caller, and that
 * is load-bearing: a history spans players who have since retired, been cut, or
 * left for another league, and none of them are in the roster-derived player
 * map. Resolving them here — out of the player index the adapter already holds
 * — keeps them out of `LeagueBundle.players`, where an extra body would move
 * replacement level for the whole app. See `LeagueBundle.freeAgents` for the
 * same argument made once already.
 */
export interface LeagueHistory {
  seasons: SeasonHistory[];
  /**
   * Position and name for everyone the history mentions.
   *
   * Deliberately not a `Player`. A history spans men who have retired, been
   * cut, or been traded away, and the two facts a bench comparison needs of
   * them — what slot they could fill, and what to call them on screen — are the
   * two that do not go stale. Anything richer would invite this map to be
   * merged into the app's real one, which is the leak `freeAgents` exists to
   * prevent.
   */
  players: Map<string, HistoryPlayer>;
  /**
   * Seasons the walk could not reach, and why.
   *
   * A chain can stop early: a league deleted, a season that predates the
   * platform, an id that answers 404. The count is carried so the UI can say
   * "three seasons" rather than implying it read them all.
   */
  truncated: boolean;
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
  loadSchedule?(leagueId: string, throughWeek: number): Promise<Schedule>;
  /**
   * Every season this league can reach, walked backwards from today.
   *
   * The most expensive call in the app — a request per week per season, some
   * seventy of them for a four-year league — and the most skippable. Nothing
   * renders on it, nothing is priced by it, and a platform that has no history
   * to give costs one panel.
   *
   * Optional for the same reason `loadSchedule` is: a provider that cannot
   * supply this should say so by not implementing it, not by returning
   * something empty that reads as "this league has never played a game".
   */
  loadHistory?(leagueId: string): Promise<LeagueHistory>;
}
