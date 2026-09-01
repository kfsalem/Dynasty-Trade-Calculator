import type { Matchup, Player, SeasonPhase } from '../../types';
import type {
  AwardedPoints,
  HistoryPlayer,
  LeagueBundle,
  LeagueHistory,
  LeagueProvider,
  LeagueTransaction,
  Schedule,
  SeasonHistory,
  SeasonManager,
  TransactionHistory,
} from '../types';
import type { KnownDraftOrder, TradedPickRef } from '../../engine/picks';
import {
  getDraft,
  getDrafts,
  getLeague,
  getMatchups,
  getPlayers,
  getRosters,
  getState,
  getTradedPicks,
  getTransactions,
  getUsers,
  parseLeagueId,
} from './client';
import type { SleeperMatchup } from './schema';
import {
  mapAwardedPoints,
  mapClaimedTotals,
  mapFreeAgents,
  mapLeague,
  mapMatchups,
  mapPlayer,
  mapSeasonManagers,
  mapSettings,
  mapTransactions,
  mapWeekLineups,
} from './mapper';
import { cached } from '../../lib/cache';

/**
 * Sleeper's `season_type`, canonicalised.
 *
 * The four words it publishes map one-to-one, so this is only guarding the
 * fifth case: a phase this app has not seen. That falls to `unknown` rather
 * than to a guess, because every consumer of the phase already treats unknown
 * as "trust the week number", which is precisely what the app did before it
 * asked the question at all.
 */
function mapSeasonPhase(seasonType: string | undefined): SeasonPhase {
  switch (seasonType) {
    case 'pre':
    case 'regular':
    case 'post':
    case 'off':
      return seasonType;
    default:
      return 'unknown';
  }
}

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

    // The waiver wire, out of the index this already holds — no extra request
    // and no extra bytes. See `mapFreeAgents`.
    const freeAgents = mapFreeAgents(playerIndex, players);

    const tradedPicks: TradedPickRef[] = rawTradedPicks.map((p) => ({
      season: p.season,
      round: p.round,
      originalRosterId: p.roster_id,
      ownerRosterId: p.owner_id,
    }));

    return {
      league,
      players,
      freeAgents,
      tradedPicks,
      // Fall back to the league's own season if /state is unavailable.
      currentSeason: state?.season ?? league.season,
      currentWeek: state?.week ?? null,
      seasonPhase: mapSeasonPhase(state?.season_type),
      draftOrders,
    };
  },

  /**
   * The regular-season schedule, one request per week.
   *
   * Sleeper has no schedule endpoint — it answers per week, so a 14-week season
   * is 14 calls. They are independent and each is a few hundred bytes, so they
   * go out together; the whole thing is one round trip's latency rather than
   * fourteen.
   *
   * A week that fails is skipped rather than failing the set. A missing week
   * costs the simulation the games in it, which shows up as slightly less
   * certainty; a rejected promise would cost the feature entirely.
   */
  async loadSchedule(leagueId: string, throughWeek: number): Promise<Schedule> {
    const weeks = Array.from({ length: Math.max(0, throughWeek) }, (_, i) => i + 1);

    const perWeek = await Promise.all(
      weeks.map((week) =>
        getMatchups(leagueId, week)
          .then((rows) => ({ week, matchups: mapMatchups(week, rows), rows }))
          .catch(() => ({ week, matchups: [] as Matchup[], rows: [] as SleeperMatchup[] })),
      ),
    );

    // The awarded points come out of the responses the fixtures were already
    // read from, so the oracle costs no extra round trip — see
    // `players_points` on the matchup schema.
    const awarded: AwardedPoints = new Map();
    for (const { week, rows } of perWeek) {
      const paid = mapAwardedPoints(rows);
      if (paid.size > 0) awarded.set(week, paid);
    }

    return { matchups: perWeek.flatMap((entry) => entry.matchups), awarded };
  },

  /**
   * Every season this league can reach, newest first.
   *
   * Walks `previous_league_id` back through the chain of leagues a dynasty
   * league actually is, and reads each season with that season's own rules. The
   * walk is sequential because it has to be — each league is where the next id
   * comes from — but the weeks inside a season go out together, so a four-year
   * league is eight round trips rather than seventy.
   *
   * Nothing waits on this. It is the most expensive call the app makes and the
   * only one whose failure costs a single panel.
   *
   * Measured on a real four-season league: 68 requests, ~2 seconds cold and
   * three requests warm — every season but the current one is immutable and
   * cached in IndexedDB. Fourteen of those 68 are a second read of the current
   * season's weeks, which `loadSchedule` has already fetched for the playoff
   * simulation. Deliberately not shared: the two are separate queries that run
   * at different times for different reasons, and threading one through the
   * other would couple the panel nobody has to open to the odds every league
   * load computes.
   */
  async loadHistory(leagueId: string): Promise<LeagueHistory> {
    const { seasons, truncated } = await walkSeasons(leagueId, loadSeason);
    return { seasons, players: await historyPlayers(seasons), truncated };
  },

  /**
   * Every roster move the league has made, newest first.
   *
   * The same walk `loadHistory` makes, reading one endpoint over. Kept separate
   * so a surface that wants trades does not pay for lineups and the other way
   * round — the two are wanted at different times, and each is around seventy
   * requests.
   */
  async loadTransactions(leagueId: string): Promise<TransactionHistory> {
    const { seasons, truncated } = await walkSeasons(leagueId, loadSeasonTransactions);

    const transactions = seasons.flatMap((season) => season.transactions);
    // One well-defined order, newest first: recency is what makes a habit
    // current, and every consumer of this wants the recent end.
    transactions.sort((a, b) => b.created - a.created);

    return {
      transactions,
      seasons: seasons.filter((s) => s.transactions.length > 0).map((s) => s.season),
      // Every season's table, not just the ones that traded: a consumer counting
      // a manager's trades has to be able to see that he made none.
      managers: new Map(seasons.map((s) => [s.season, s.managers])),
      truncated,
    };
  },
};

/**
 * Walk a league back through its own past, reading each season the same way.
 *
 * The walk is sequential because it has to be: each league object is where the
 * id of the one before it comes from. Everything expensive inside a season goes
 * out in parallel, so a four-season league is a handful of round trips rather
 * than seventy.
 *
 * A season that cannot be read stops the walk rather than failing it. What has
 * already been read stays read, and `truncated` says the span is short — a
 * league deleted, or a season older than the platform will answer for.
 */
async function walkSeasons<T extends { previous: string | null }>(
  leagueId: string,
  read: (leagueId: string, current: boolean) => Promise<T>,
): Promise<{ seasons: T[]; truncated: boolean }> {
  const seasons: T[] = [];
  let next: string | null = leagueId;
  let truncated = false;

  while (next && next !== NO_EARLIER_SEASON && seasons.length < MAX_SEASONS) {
    const id: string = next;
    // The head is live; everything behind it has finished and cannot change.
    const current = seasons.length === 0;

    let season: T;
    try {
      season = await read(id, current);
    } catch {
      truncated = true;
      break;
    }

    seasons.push(season);
    next = season.previous;
  }

  // Stopped on its own limit rather than at the end of the league. Ten seasons
  // is longer than Sleeper has existed, so this guards a cycle, not a horizon.
  if (next && next !== NO_EARLIER_SEASON && seasons.length >= MAX_SEASONS) truncated = true;

  return { seasons, truncated };
}

/**
 * Sleeper's "there is no earlier season", as a string.
 *
 * The chain ends in one of two ways: the field is absent, or it holds `"0"`.
 * The second reads as a perfectly ordinary league id and answers 404 — verified
 * against both test leagues, whose oldest seasons carry it.
 */
const NO_EARLIER_SEASON = '0';

/** Longer than Sleeper has existed. A stop against a cycle, not a horizon. */
const MAX_SEASONS = 10;

/**
 * A finished season is finished. A month is a compromise with cache size, not
 * with correctness — nothing in a completed season can move again.
 */
const SEASON_TTL = 30 * 24 * 60 * 60 * 1000;

/**
 * One season of history, and the id of the season before it.
 *
 * Read with *that season's* settings throughout. Starting slots move between
 * seasons — one of the test leagues plays ten slots in 2023 and eleven in 2025
 * — and so does the playoff week that decides how much of the season is regular
 * season. Reading a 2023 week against 2026's rules would misalign every lineup
 * in it.
 *
 * A week that fails is skipped rather than failing the season, the same policy
 * `loadSchedule` runs: a missing week costs the weeks in it and nothing else.
 */
async function loadSeason(
  leagueId: string,
  current: boolean,
): Promise<SeasonHistory & { previous: string | null }> {
  const read = async () => {
    const [league, rosters, users] = await Promise.all([
      getLeague(leagueId),
      getRosters(leagueId),
      getUsers(leagueId),
    ]);

    const settings = mapSettings(league);
    const slotCount = settings.startingSlots.length;
    const throughWeek = Math.max(0, settings.playoffWeekStart - 1);
    const weekNumbers = Array.from({ length: throughWeek }, (_, i) => i + 1);

    const weeks = await Promise.all(
      weekNumbers.map((week) =>
        getMatchups(leagueId, week)
          .then((rows) => mapWeekLineups(week, rows, slotCount))
          .catch(() => []),
      ),
    );

    return {
      leagueId,
      season: league.season,
      startingSlots: settings.startingSlots,
      managers: mapSeasonManagers(rosters, users),
      weeks: weeks.flat(),
      claimed: mapClaimedTotals(rosters),
      previous: league.previous_league_id ?? null,
    };
  };

  return current ? read() : cached(`sleeper:history:${leagueId}:v1`, SEASON_TTL, read);
}

/**
 * The last week Sleeper files transactions under.
 *
 * Seventeen, measured: weeks 18 and 19 answer with an empty array in every
 * season of both test leagues, and week 17 still carries claims. Not derived
 * from `playoff_week_start` — the regular season ends at 14 in both leagues and
 * three hundred moves happen after it.
 */
const LAST_TRANSACTION_WEEK = 17;

/**
 * One season's roster moves, and the id of the season before it.
 *
 * A week that fails is skipped rather than failing the season, the policy
 * `loadSchedule` and `loadSeason` both run: a lost week costs the moves in it
 * and nothing else.
 */
async function loadSeasonTransactions(
  leagueId: string,
  current: boolean,
): Promise<{
  season: string;
  transactions: LeagueTransaction[];
  managers: Map<number, SeasonManager>;
  previous: string | null;
}> {
  const read = async () => {
    const league = await getLeague(leagueId);
    const weeks = Array.from({ length: LAST_TRANSACTION_WEEK }, (_, i) => i + 1);

    /*
      Rosters and users alongside the weeks, and the reason is that without them
      this feed cannot name anybody. Every row identifies its sides by roster id,
      which is a position in *this* season's table and not a person — so a walk
      that reads four seasons and never reads who owned what has four
      incompatible sets of ids and no way to know it.

      Two requests against the seventeen already going out for the weeks. The
      alternative was to make each consumer join against `loadHistory`, which
      would have made a panel about trades pay for every lineup in every season.
    */
    const [rosters, users, perWeek] = await Promise.all([
      getRosters(leagueId),
      getUsers(leagueId),
      Promise.all(
        weeks.map((week) =>
          getTransactions(leagueId, week)
            .then((rows) => mapTransactions(league.season, week, rows))
            .catch(() => []),
        ),
      ),
    ]);

    return {
      season: league.season,
      transactions: perWeek.flat(),
      managers: mapSeasonManagers(rosters, users),
      previous: league.previous_league_id ?? null,
    };
  };

  // v2: the cached shape gained `managers`, and a v1 entry cannot supply it.
  return current
    ? read()
    : cached(`sleeper:transactions:${leagueId}:v2`, SEASON_TTL, read);
}

/**
 * Everyone a history mentions, out of the player index already held.
 *
 * Resolved here rather than by the caller because the population is different
 * from every other one in the app: it includes players who have since retired,
 * been cut, or been traded out of the league, and none of them are in the
 * roster-derived player map. The alternative — widening that map — would let
 * them into the pool replacement level is computed over, which is the leak
 * `LeagueBundle.freeAgents` exists to prevent.
 *
 * A player the index cannot place is simply absent, which reads downstream as a
 * man who cannot fill a slot. That is the safe direction: the bench figure
 * comes out lower than the truth rather than inventing a lineup nobody could
 * have fielded.
 */
async function historyPlayers(seasons: SeasonHistory[]): Promise<Map<string, HistoryPlayer>> {
  const players = new Map<string, HistoryPlayer>();
  if (seasons.length === 0) return players;

  const index = await getPlayers().catch(() => null);
  if (!index) return players;

  for (const season of seasons) {
    for (const week of season.weeks) {
      for (const id of week.playerIds) {
        if (players.has(id)) continue;
        const slim = index[id];
        if (!slim) continue;
        const mapped = mapPlayer(slim);
        if (mapped) players.set(id, { position: mapped.position, name: mapped.name });
      }
    }
  }

  return players;
}

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
