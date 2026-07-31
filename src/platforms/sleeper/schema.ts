import { z } from 'zod';

/**
 * Zod schemas for the Sleeper API, written against live responses.
 *
 * Deliberately permissive: anything we don't read is left off (z.object strips
 * unknown keys), and anything Sleeper can omit is optional/nullable. Observed
 * quirks that drove decisions here:
 *   - `owner_id` is null for orphan teams
 *   - `players`/`starters`/`taxi`/`reserve` are null on a brand-new roster
 *   - `starters` contains the literal string "0" for an unfilled slot
 *   - user `metadata.team_name` is absent unless the manager set a custom name
 */

export const sleeperLeagueSchema = z.object({
  league_id: z.string(),
  name: z.string(),
  season: z.string(),
  status: z.string(),
  avatar: z.string().nullish(),
  total_rosters: z.number(),
  roster_positions: z.array(z.string()),
  settings: z
    .object({
      type: z.number().nullish(), // 0 redraft, 1 keeper, 2 dynasty
      num_teams: z.number().nullish(),
      taxi_slots: z.number().nullish(),
      reserve_slots: z.number().nullish(),
      draft_rounds: z.number().nullish(),
    })
    .nullish(),
  scoring_settings: z.record(z.string(), z.number()).nullish(),
});

export const sleeperRosterSchema = z.object({
  roster_id: z.number(),
  owner_id: z.string().nullish(),
  players: z.array(z.string()).nullish(),
  starters: z.array(z.string()).nullish(),
  taxi: z.array(z.string()).nullish(),
  reserve: z.array(z.string()).nullish(),
  settings: z
    .object({
      wins: z.number().nullish(),
      losses: z.number().nullish(),
      ties: z.number().nullish(),
      fpts: z.number().nullish(),
      fpts_decimal: z.number().nullish(),
    })
    .nullish(),
});

export const sleeperUserSchema = z.object({
  user_id: z.string(),
  display_name: z.string().nullish(),
  avatar: z.string().nullish(),
  metadata: z
    .object({
      team_name: z.string().nullish(),
    })
    .nullish(),
});

export const sleeperPlayerSchema = z.object({
  player_id: z.string().nullish(),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
  full_name: z.string().nullish(),
  position: z.string().nullish(),
  team: z.string().nullish(),
  age: z.number().nullish(),
  years_exp: z.number().nullish(),
  injury_status: z.string().nullish(),
  search_rank: z.number().nullish(),
});

/**
 * `roster_id` is the roster the pick ORIGINALLY belonged to; `owner_id` is the
 * roster holding it now. Picks absent from this feed are still held by their
 * original owner.
 */
export const sleeperTradedPickSchema = z.object({
  season: z.string(),
  round: z.number(),
  roster_id: z.number(),
  owner_id: z.number(),
  previous_owner_id: z.number().nullish(),
});

/**
 * A draft, as `/league/<id>/drafts` and `/draft/<id>` return it.
 *
 * `slot_to_roster_id` is the field worth having: it maps a draft slot straight
 * to a roster, so it survives an orphan team, which the user-keyed
 * `draft_order` does not. The list endpoint omits it, so it is optional here
 * and read from the per-draft endpoint.
 */
export const sleeperDraftSchema = z.object({
  draft_id: z.string(),
  season: z.string(),
  status: z.string(),
  /** "linear" or "snake" — snake reverses even rounds. */
  type: z.string(),
  slot_to_roster_id: z.record(z.string(), z.number().nullish()).nullish(),
  settings: z
    .object({
      rounds: z.number().nullish(),
      teams: z.number().nullish(),
    })
    .nullish(),
});

export const sleeperDraftsSchema = z.array(sleeperDraftSchema);

export const sleeperStateSchema = z.object({
  season: z.string(),
  season_type: z.string(),
  week: z.number().nullish(),
});

/**
 * `/user/<username>` answers 200 with a literal `null` body for an unknown
 * name rather than 404, so the schema has to accept null and the caller has to
 * translate it into a real "not found".
 */
export const sleeperAccountSchema = z
  .object({
    user_id: z.string(),
    username: z.string().nullish(),
    display_name: z.string().nullish(),
    avatar: z.string().nullish(),
  })
  .nullable();

export const sleeperRostersSchema = z.array(sleeperRosterSchema);
export const sleeperUsersSchema = z.array(sleeperUserSchema);
export const sleeperPlayersSchema = z.record(z.string(), sleeperPlayerSchema);
export const sleeperTradedPicksSchema = z.array(sleeperTradedPickSchema);

export type SleeperLeague = z.infer<typeof sleeperLeagueSchema>;
export type SleeperRoster = z.infer<typeof sleeperRosterSchema>;
export type SleeperUser = z.infer<typeof sleeperUserSchema>;
export type SleeperPlayer = z.infer<typeof sleeperPlayerSchema>;
export type SleeperTradedPick = z.infer<typeof sleeperTradedPickSchema>;
export type SleeperState = z.infer<typeof sleeperStateSchema>;
export type SleeperDraft = z.infer<typeof sleeperDraftSchema>;
export type SleeperAccount = NonNullable<z.infer<typeof sleeperAccountSchema>>;
