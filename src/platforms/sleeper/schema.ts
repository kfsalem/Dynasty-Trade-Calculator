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
  /**
   * The same league, one season earlier. The whole of a dynasty league's
   * history hangs off this one field.
   *
   * Two shapes for "there is no earlier season", both seen live: absent, and
   * the string `"0"`. The second is the one that bites — it is a perfectly
   * good league id as far as any type is concerned, and following it answers
   * 404. Every walk over this field has to stop on both.
   */
  previous_league_id: z.string().nullish(),
  name: z.string(),
  season: z.string(),
  status: z.string(),
  avatar: z.string().nullish(),
  total_rosters: z.number(),
  roster_positions: z.array(z.string()),
  /**
   * The league's rules.
   *
   * The count moves between leagues and between seasons of one league: 48 to 52
   * keys across four seasons of one real league, 47 to 51 across another. Sleeper
   * adds keys over time and without notice, which is the whole reason this object
   * strips what it does not name instead of failing on it.
   *
   * Every key below is `nullish` for the same reason in the other direction.
   * `waiver_bid_min` is the one to look at: published in every season of one of
   * those leagues and absent from every season of the other. Neither "always
   * there" nor "never there" would have survived contact with the second league.
   */
  settings: z
    .object({
      type: z.number().nullish(), // 0 redraft, 1 keeper, 2 dynasty
      num_teams: z.number().nullish(),
      taxi_slots: z.number().nullish(),
      taxi_years: z.number().nullish(),
      taxi_allow_vets: z.number().nullish(),
      reserve_slots: z.number().nullish(),
      reserve_allow_out: z.number().nullish(),
      reserve_allow_doubtful: z.number().nullish(),
      reserve_allow_na: z.number().nullish(),
      reserve_allow_sus: z.number().nullish(),
      reserve_allow_dnr: z.number().nullish(),
      reserve_allow_cov: z.number().nullish(),
      draft_rounds: z.number().nullish(),
      /** First playoff week — the regular season is everything before it. */
      playoff_week_start: z.number().nullish(),
      playoff_teams: z.number().nullish(),
      playoff_type: z.number().nullish(),
      playoff_round_type: z.number().nullish(),
      playoff_seed_type: z.number().nullish(),
      /** 0 disables pick trading. Every pick-balanced offer is illegal then. */
      pick_trading: z.number().nullish(),
      disable_trades: z.number().nullish(),
      /** Week trades close. `99` is Sleeper's "no deadline". */
      trade_deadline: z.number().nullish(),
      best_ball: z.number().nullish(),
      /** Teams also play the league median each week. */
      league_average_match: z.number().nullish(),
      waiver_type: z.number().nullish(),
      waiver_budget: z.number().nullish(),
      waiver_bid_min: z.number().nullish(),
    })
    .nullish(),
  scoring_settings: z.record(z.string(), z.number()).nullish(),
});

/**
 * One roster's entry in a week's matchups.
 *
 * Sleeper does not publish a schedule as such. It publishes, per week, a row
 * per roster carrying a `matchup_id`, and two rows sharing one is what a
 * fixture *is* — so the schedule has to be reassembled by grouping.
 *
 * `matchup_id` is null for a roster with no fixture that week, which happens in
 * leagues with an odd number of teams and in weeks Sleeper has not scheduled.
 */
export const sleeperMatchupSchema = z.object({
  roster_id: z.number(),
  matchup_id: z.number().nullish(),
  points: z.number().nullish(),
  /**
   * What Sleeper actually paid each rostered player that week, under this
   * league's own rules.
   *
   * The single most useful field the API publishes and the app ignored: it is
   * an *oracle* for `engine/scoring`, in every league, for every played week.
   * It rides along in a response the schedule already fetches, so reading it
   * costs nothing — see `loadSchedule`.
   */
  players_points: z.record(z.string(), z.number()).nullish(),
  /**
   * The lineup this manager actually set that week, in slot order.
   *
   * Positional exactly like the roster's own `starters`, `"0"` and all — see
   * `mapSetLineup`. This is the one on the *week*, which is the only place the
   * past is recorded: the roster endpoint knows one lineup, the last one set,
   * and by January that is a week-17 lineup standing in front of seventeen
   * others nobody can see any more.
   */
  starters: z.array(z.string()).nullish(),
  /**
   * Everyone on the roster that week, IR and taxi included.
   *
   * The roster *as it was*, which is why bench arithmetic reads this and not
   * the roster endpoint: a man traded away in October is on this list in
   * September, where he belongs, and gone from the roster feed entirely.
   */
  players: z.array(z.string()).nullish(),
});

export const sleeperMatchupsSchema = z.array(sleeperMatchupSchema);

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
      /**
       * Sleeper's own season total for the best lineup this roster could have
       * fielded — its "potential points".
       *
       * The oracle for `engine/benchPoints`, and the second one this API has
       * turned out to publish: `players_points` lets the scoring engine check
       * itself, and this lets the lineup arithmetic built on top of it do the
       * same. It rides along in a response the history walk already makes.
       *
       * Split across two keys with the decimals as an integer, the same way
       * `fpts` is — `ppts: 2385, ppts_decimal: 22` is 2385.22.
       */
      ppts: z.number().nullish(),
      ppts_decimal: z.number().nullish(),
    })
    .nullish(),
});

/**
 * One roster move: a trade, a waiver claim, a free-agent pickup, or a
 * commissioner's correction.
 *
 * Written against 3,264 live transactions across seven league-seasons of two
 * real leagues. Every key below is present on every row Sleeper returns — it
 * emits the whole shape and fills the irrelevant halves with `null`, which is
 * why so much of this is nullable rather than optional.
 *
 * The counts, for what each field is worth:
 * `free_agent` 1,902 · `waiver` 1,155 · `trade` 163 · `commissioner` 44.
 */
export const sleeperTransactionSchema = z.object({
  transaction_id: z.string(),
  type: z.string(),
  /** `complete` or `failed`. Only waivers ever fail — 461 of them. */
  status: z.string(),
  /** The week, and it always matches the week asked for. Checked on all 3,264. */
  leg: z.number().nullish(),
  /** Milliseconds. The only reliable ordering across a season. */
  created: z.number().nullish(),
  /** Rosters involved. Two for a trade — except the one three-way seen live. */
  roster_ids: z.array(z.number()).nullish(),
  /** Player id to the roster that received him. Null on a drop-only move. */
  adds: z.record(z.string(), z.number()).nullish(),
  /** Player id to the roster that gave him up. Null 1,273 times of 3,264. */
  drops: z.record(z.string(), z.number()).nullish(),
  /** The user who initiated it, for a trade's proposing side. */
  creator: z.string().nullish(),
  /** Rosters that agreed. Null on every commissioner move. */
  consenter_ids: z.array(z.number()).nullish(),
  /**
   * Picks changing hands in a trade — 135 of the 163 trades carry one.
   *
   * `roster_id` is the roster the pick originally belonged to, `owner_id` the
   * roster taking it and `previous_owner_id` the one giving it up. The same
   * convention as `traded_picks`, which the app already reads.
   */
  draft_picks: z
    .array(
      z.object({
        season: z.string(),
        round: z.number(),
        roster_id: z.number().nullish(),
        owner_id: z.number().nullish(),
        previous_owner_id: z.number().nullish(),
      }),
    )
    .nullish(),
  /** FAAB moved as part of a trade. Seen on 17 of them. */
  waiver_budget: z
    .array(
      z.object({
        amount: z.number(),
        sender: z.number(),
        receiver: z.number(),
      }),
    )
    .nullish(),
  settings: z
    .object({
      /**
       * What was bid on a waiver claim, winning or losing.
       *
       * The field #50 was written to verify and could not, because the test
       * league had no history at the time. It is real: 1,038 of the 1,155
       * waiver rows carry one, only waivers ever do, and the values run 0 to
       * 120 with a median of 1.
       *
       * **Zero is a real bid.** A claim at $0 and a league that does not run
       * FAAB both have to survive this schema distinguishably, which is why
       * this is nullish rather than defaulted.
       */
      waiver_bid: z.number().nullish(),
      /** Priority within one waiver run. */
      seq: z.number().nullish(),
      /** 1 when the trade was a counter-offer. Seen 14 times. */
      is_counter: z.number().nullish(),
    })
    .nullish(),
});

export const sleeperTransactionsSchema = z.array(sleeperTransactionSchema);

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
export type SleeperMatchup = z.infer<typeof sleeperMatchupSchema>;
export type SleeperTransaction = z.infer<typeof sleeperTransactionSchema>;
export type SleeperDraft = z.infer<typeof sleeperDraftSchema>;
export type SleeperAccount = NonNullable<z.infer<typeof sleeperAccountSchema>>;
