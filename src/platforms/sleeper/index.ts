import type { Matchup, Player, SeasonPhase } from '../../types';
import type { LeagueBundle, LeagueProvider } from '../types';
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
  getUsers,
  parseLeagueId,
} from './client';
import { mapLeague, mapMatchups, mapPlayer } from './mapper';

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
  async loadSchedule(leagueId: string, throughWeek: number): Promise<Matchup[]> {
    const weeks = Array.from({ length: Math.max(0, throughWeek) }, (_, i) => i + 1);

    const perWeek = await Promise.all(
      weeks.map((week) =>
        getMatchups(leagueId, week)
          .then((rows) => mapMatchups(week, rows))
          .catch(() => [] as Matchup[]),
      ),
    );

    return perWeek.flat();
  },
};

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
