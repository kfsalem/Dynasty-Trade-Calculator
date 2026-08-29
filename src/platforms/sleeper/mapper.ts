import type {
  League,
  LeagueSettings,
  LineupSlot,
  Matchup,
  Player,
  Position,
  Roster,
  InjuryStatus,
} from '../../types';
import type { SlimPlayer } from './client';
import type {
  SleeperLeague,
  SleeperMatchup,
  SleeperRoster,
  SleeperUser,
} from './schema';

const POSITIONS = new Set<Position>(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
const BENCH = new Set(['BN', 'IR', 'TAXI']);

/** Sleeper uses "0" as a placeholder for an unfilled starting slot. */
const isRealPlayerId = (id: string): boolean => id !== '0' && id.trim() !== '';

export function avatarUrl(avatar: string | null | undefined): string | null {
  return avatar ? `https://sleepercdn.com/avatars/thumbs/${avatar}` : null;
}

/**
 * Sleeper's `injury_status`, canonicalised.
 *
 * Two of these are not injuries. `DNR` is the reserve/did-not-report list and
 * `NA` marks a player who is not on an active NFL roster; Sleeper reports both
 * in the same field, and both mean the man cannot play. They were missing here
 * until R9, when the real league turned out to roster a receiver whose only
 * designation is `DNR` — dropped on the floor by the old map, and therefore
 * started every week by a model that had just learned to bench injured players.
 */
const KNOWN_STATUS: Record<string, InjuryStatus['status']> = {
  questionable: 'questionable',
  doubtful: 'doubtful',
  out: 'out',
  ir: 'ir',
  pup: 'pup',
  sus: 'sus',
  dnr: 'dnr',
  na: 'na',
};

/**
 * An unrecognised status is kept rather than discarded, carrying its raw text.
 *
 * Returning `undefined` for a word we do not know reports the player as
 * perfectly healthy, which is a claim, and a wrong one — Sleeper adds
 * designations without asking. `unknown` is treated as week-to-week by
 * `engine/availability`, so an unfamiliar word shows on the row and changes no
 * arithmetic, which is the right amount of trust to place in it.
 */
function mapInjury(status: string | null): InjuryStatus | undefined {
  if (!status?.trim()) return undefined;
  const normalized = status.trim().toLowerCase();
  return { status: KNOWN_STATUS[normalized] ?? 'unknown', description: status };
}

export function mapPlayer(p: SlimPlayer): Player | null {
  if (!POSITIONS.has(p.position as Position)) return null;
  return {
    id: p.id,
    name: p.name,
    position: p.position as Position,
    team: p.team,
    age: p.age,
    yearsExp: p.yearsExp,
    injury: mapInjury(p.injuryStatus),
    platformIds: { sleeper: p.id },
  };
}

/**
 * Everyone in the index that nobody in this league rosters.
 *
 * The players were already in memory and every build before this one threw them
 * away: `loadLeague` walked the rosters, kept what they referenced, and dropped
 * the rest on the floor. On the test league that was 893 players — against 176
 * rostered — about whom the app could not answer a single question.
 *
 * Two filters, and both matter.
 *
 * **Rostered players are excluded**, so the two maps are disjoint by
 * construction. That is what `LeagueBundle` promises and what keeps a free agent
 * out of `bestLineup`, and therefore out of every replacement level in the app.
 *
 * **A player with no NFL team is excluded.** The slimmed index carries roughly
 * four thousand players at these positions and only about a thousand are on a
 * roster somewhere in the league; the rest are retired or unsigned. A board
 * listing them is a directory, not a waiver wire.
 */
export function mapFreeAgents(
  index: Record<string, SlimPlayer>,
  rostered: Map<string, Player>,
): Map<string, Player> {
  const freeAgents = new Map<string, Player>();

  for (const [id, slim] of Object.entries(index)) {
    if (rostered.has(id) || !slim.team) continue;
    const player = mapPlayer(slim);
    if (player) freeAgents.set(id, player);
  }

  return freeAgents;
}

/**
 * Sleeper writes booleans as 1 and 0.
 *
 * The default is the caller's to choose and it is never cosmetic: an absent
 * key has to leave the app doing exactly what it did before this function
 * learned to read the key at all. So `pick_trading` defaults to *allowed* and
 * `disable_trades` to *not disabled* — the permissive reading in both cases,
 * because a league that publishes neither is a league this app has always
 * treated as trading normally.
 */
const flag = (value: number | null | undefined, fallback: boolean): boolean =>
  value == null ? fallback : value !== 0;

/**
 * The longest the NFL regular season can be, and therefore the last week a
 * trade deadline could fall in.
 */
const LAST_POSSIBLE_WEEK = 18;

/**
 * The week trading closes, or null when it never does.
 *
 * Sleeper stores "no deadline" as `99` — verified across all four seasons of
 * the test league. Rather than hardcoding that sentinel and hoping no league
 * uses a different large number, anything past the end of the NFL regular
 * season is read as "never binds". Both readings agree on 99, and this one
 * cannot be wrong about a deadline that could actually arrive.
 */
function mapTradeDeadline(week: number | null | undefined): number | null {
  if (week == null || week <= 0 || week > LAST_POSSIBLE_WEEK) return null;
  return week;
}

/**
 * FAAB budget, when the league runs one.
 *
 * Gated on the budget being positive rather than on `waiver_type`, because the
 * budget is the thing #47 actually needs and a zero budget is not a FAAB
 * league whatever the type code says.
 */
const mapWaiverBudget = (budget: number | null | undefined): number | null =>
  budget != null && budget > 0 ? budget : null;

export function mapSettings(league: SleeperLeague): LeagueSettings {
  const allSlots = league.roster_positions as LineupSlot[];
  const startingSlots = allSlots.filter((s) => !BENCH.has(s));
  const settings = league.settings;

  return {
    // type 2 is dynasty; 1 is keeper. Treat keeper as dynasty-ish for valuation,
    // since both carry players across seasons.
    isDynasty: (settings?.type ?? 0) >= 1,
    teamCount: league.total_rosters || settings?.num_teams || 12,
    ppr: league.scoring_settings?.rec ?? 0,
    // A SUPER_FLEX slot is what actually makes QBs scarce, not the QB count.
    numQbs: startingSlots.includes('SUPER_FLEX') ? 2 : 1,
    startingSlots,
    allSlots,
    // Counted, not configured: Sleeper expresses bench depth by repeating "BN"
    // in roster_positions rather than by publishing a number. The test league
    // carries 19 of them against 11 starting slots.
    benchSlots: allSlots.filter((slot) => slot === 'BN').length,
    taxiSlots: settings?.taxi_slots ?? 0,
    taxiYears: settings?.taxi_years ?? 0,
    taxiAllowVets: flag(settings?.taxi_allow_vets, false),
    reserveSlots: settings?.reserve_slots ?? 0,
    // Every flag defaults to false: claiming a designation may be stashed when
    // the league never said so would overstate how cheap an injured player is
    // to hold, and that is the direction that costs somebody a roster spot.
    reserveAllows: {
      out: flag(settings?.reserve_allow_out, false),
      doubtful: flag(settings?.reserve_allow_doubtful, false),
      na: flag(settings?.reserve_allow_na, false),
      sus: flag(settings?.reserve_allow_sus, false),
      dnr: flag(settings?.reserve_allow_dnr, false),
      cov: flag(settings?.reserve_allow_cov, false),
    },
    draftRounds: settings?.draft_rounds ?? 4,
    // Sleeper's own defaults when a league has not overridden them. Both are
    // read rather than assumed because they decide how much season is left to
    // play and how many teams that season has to sort out.
    playoffWeekStart: settings?.playoff_week_start ?? 15,
    playoffTeams: settings?.playoff_teams ?? 6,
    playoffType: settings?.playoff_type ?? null,
    playoffRoundType: settings?.playoff_round_type ?? null,
    playoffSeedType: settings?.playoff_seed_type ?? null,
    pickTrading: flag(settings?.pick_trading, true),
    tradesDisabled: flag(settings?.disable_trades, false),
    tradeDeadline: mapTradeDeadline(settings?.trade_deadline),
    bestBall: flag(settings?.best_ball, false),
    medianMatch: flag(settings?.league_average_match, false),
    waivers: {
      type: settings?.waiver_type ?? null,
      budget: mapWaiverBudget(settings?.waiver_budget),
      minBid: settings?.waiver_bid_min ?? null,
    },
  };
}

/**
 * A week of Sleeper matchup rows, reassembled into fixtures.
 *
 * Sleeper publishes a row per roster carrying a `matchup_id`; two rows sharing
 * one is what a fixture is. Anything that does not come out as a clean pair is
 * dropped rather than guessed at — a null `matchup_id` is a roster with no game
 * that week, and a group of one is the bye that falls out of an odd number of
 * teams. Either way there is no fixture to report, and inventing an opponent
 * would put a game in the simulation that nobody plays.
 */
export function mapMatchups(week: number, rows: SleeperMatchup[]): Matchup[] {
  const groups = new Map<number, SleeperMatchup[]>();
  for (const row of rows) {
    if (row.matchup_id == null) continue;
    const group = groups.get(row.matchup_id) ?? [];
    group.push(row);
    groups.set(row.matchup_id, group);
  }

  const fixtures: Matchup[] = [];
  for (const group of groups.values()) {
    if (group.length !== 2) continue;
    // Lower roster id first, then fixtures in that order. Sleeper lists rows in
    // no particular order, and a fixture that reads [4, 3] one week and [3, 4]
    // the next is the same game wearing two faces — which matters because the
    // simulation is seeded, and a stable input is half of reproducible.
    const [first, second] = [...group].sort((x, y) => x.roster_id - y.roster_id);

    /**
     * A week nobody has played yet.
     *
     * Sleeper returns the fixture with points at 0 well before kickoff, so an
     * unplayed week is indistinguishable from one in which both teams were
     * shut out. That second thing does not happen — a fantasy lineup scoring
     * exactly nothing would need every starter to post a zero — so two zeroes
     * is read as "not yet", which is right essentially always and costs one
     * week of calibration data in the case where it is not.
     */
    const a = first.points ?? 0;
    const b = second.points ?? 0;
    const played = a > 0 || b > 0;

    fixtures.push({
      week,
      rosterIds: [first.roster_id, second.roster_id],
      points: played ? [a, b] : null,
    });
  }
  return fixtures.sort((x, y) => x.rosterIds[0] - y.rosterIds[0]);
}

/**
 * Sleeper's `starters` array, kept in slot order.
 *
 * The array is positional: entry *i* is whoever the manager put in starting
 * slot *i*, and `"0"` is Sleeper's placeholder for a slot left empty. Both
 * facts used to be discarded here — the placeholders were filtered out, which
 * compacted the array and silently shifted every player after an empty slot
 * into somebody else's position.
 *
 * A length that does not match the league's starting slots means the two are
 * not describing the same thing, and there is no honest way to guess which
 * slots the ids belong to. That returns an empty lineup, which reads downstream
 * as "this manager has set no lineup" — the same as a brand-new roster, and the
 * safe direction to be wrong in: `startSit` then recommends a lineup instead of
 * claiming a mistake nobody made.
 */
function mapSetLineup(
  starters: string[] | null | undefined,
  slotCount: number,
): (string | null)[] {
  if (!starters || starters.length !== slotCount) return [];
  return starters.map((id) => (isRealPlayerId(id) ? id : null));
}

export function mapLeague(
  league: SleeperLeague,
  rosters: SleeperRoster[],
  users: SleeperUser[],
): League {
  const usersById = new Map(users.map((u) => [u.user_id, u]));
  const settings = mapSettings(league);
  const { startingSlots } = settings;

  const mapped: Roster[] = rosters.map((r) => {
    const user = r.owner_id ? usersById.get(r.owner_id) : undefined;
    const ownerName = user?.display_name ?? 'Orphan team';
    const fpts = (r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100;

    return {
      rosterId: r.roster_id,
      ownerId: r.owner_id ?? null,
      // Custom team names are optional on Sleeper; most managers never set one.
      teamName: user?.metadata?.team_name?.trim() || ownerName,
      ownerName,
      avatar: avatarUrl(user?.avatar),
      wins: r.settings?.wins ?? 0,
      losses: r.settings?.losses ?? 0,
      ties: r.settings?.ties ?? 0,
      pointsFor: fpts,
      playerIds: (r.players ?? []).filter(isRealPlayerId),
      setLineup: mapSetLineup(r.starters, startingSlots.length),
      taxiIds: (r.taxi ?? []).filter(isRealPlayerId),
      reserveIds: (r.reserve ?? []).filter(isRealPlayerId),
    };
  });

  return {
    id: league.league_id,
    platform: 'sleeper',
    name: league.name,
    season: league.season,
    status: league.status,
    avatar: avatarUrl(league.avatar),
    settings,
    rosters: mapped.sort((a, b) => a.rosterId - b.rosterId),
  };
}
