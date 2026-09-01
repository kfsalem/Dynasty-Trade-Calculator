import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SleeperLeague, SleeperMatchup, SleeperTransaction } from './schema';

/**
 * The season walk, and what it does when the platform lets it down.
 *
 * The only tests in this repo that mock the network, and they earn it: two
 * features now hang off one `previous_league_id` walk, its failure policy is
 * three separate documented promises — a bad week is skipped, a bad season
 * stops the walk, a chain ending in `"0"` is not followed — and every one of
 * them was written from a live API that cannot be made to fail on demand.
 *
 * Everything else about these loaders is tested through the mappers, which is
 * where the reading of a payload belongs. This is about the orchestration.
 */

const client = {
  getLeague: vi.fn(),
  getRosters: vi.fn(),
  getUsers: vi.fn(),
  getMatchups: vi.fn(),
  getTransactions: vi.fn(),
  getPlayers: vi.fn(),
  getDraft: vi.fn(),
  getDrafts: vi.fn(),
  getState: vi.fn(),
  getTradedPicks: vi.fn(),
  parseLeagueId: vi.fn(),
};

vi.mock('./client', () => client);

// The IndexedDB layer is not what is under test, and a finished season being
// cached would hide the very requests these assertions count.
vi.mock('../../lib/cache', () => ({
  cached: <T>(_key: string, _ttl: number, fetcher: () => Promise<T>) => fetcher(),
  TTL: { PLAYERS: 0, VALUES: 0 },
}));

const { sleeperProvider } = await import('./index');

/** A league in a chain: `2026` points at `2025`, and the oldest at `"0"`. */
const league = (season: string, previous: string | null): SleeperLeague =>
  ({
    league_id: `L${season}`,
    previous_league_id: previous,
    name: 'Test',
    season,
    status: 'complete',
    avatar: null,
    total_rosters: 2,
    roster_positions: ['QB', 'BN'],
    settings: { playoff_week_start: 3 },
    scoring_settings: { rec: 1 },
  }) as SleeperLeague;

const matchup = (): SleeperMatchup[] => [
  {
    roster_id: 1,
    matchup_id: 1,
    points: 20,
    starters: ['a'],
    players: ['a', 'b'],
    players_points: { a: 20, b: 5 },
  } as SleeperMatchup,
];

const transaction = (id: string, created: number): SleeperTransaction[] => [
  {
    transaction_id: id,
    type: 'waiver',
    status: 'complete',
    leg: 1,
    created,
    roster_ids: [1],
    adds: { a: 1 },
    drops: null,
    creator: 'u1',
    consenter_ids: [1],
    draft_picks: [],
    waiver_budget: [],
    settings: { waiver_bid: 3 },
  } as SleeperTransaction,
];

/** Chain of `seasons`, each answering with one played week and one move. */
function stubChain(seasons: string[]) {
  client.getLeague.mockImplementation((id: string) => {
    const index = seasons.findIndex((season) => `L${season}` === id);
    if (index < 0) return Promise.reject(new Error(`no league ${id}`));
    const previous = index + 1 < seasons.length ? `L${seasons[index + 1]}` : '0';
    return Promise.resolve(league(seasons[index], previous));
  });
  client.getRosters.mockResolvedValue([
    { roster_id: 1, owner_id: 'u1', players: ['a'], starters: ['a'], settings: { ppts: 30 } },
  ]);
  client.getUsers.mockResolvedValue([{ user_id: 'u1', display_name: 'Ann', avatar: null }]);
  client.getMatchups.mockResolvedValue(matchup());
  client.getTransactions.mockImplementation((id: string, week: number) =>
    Promise.resolve(transaction(`${id}-${week}`, Number(id.slice(1)) * 100 + week)),
  );
  client.getPlayers.mockResolvedValue({
    a: { id: 'a', name: 'A', position: 'QB', team: 'KC', age: 25, yearsExp: 3, injuryStatus: null },
    b: { id: 'b', name: 'B', position: 'QB', team: 'KC', age: 25, yearsExp: 3, injuryStatus: null },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  stubChain(['2026', '2025']);
});

describe('loadHistory', () => {
  it('walks the chain back to the season that has no earlier one', async () => {
    const history = await sleeperProvider.loadHistory!('L2026');

    expect(history.seasons.map((s) => s.season)).toEqual(['2026', '2025']);
    expect(history.truncated).toBe(false);
    // `"0"` is a league id as far as any type is concerned, and following it
    // answers 404. Never requested.
    expect(client.getLeague).not.toHaveBeenCalledWith('0');
  });

  it('skips a week that fails rather than losing the season', async () => {
    client.getMatchups.mockImplementation((_id: string, week: number) =>
      week === 1 ? Promise.reject(new Error('502')) : Promise.resolve(matchup()),
    );

    const history = await sleeperProvider.loadHistory!('L2026');

    // Two weeks per season, one of them refused: the season survives with the
    // other, and both seasons are still read.
    expect(history.seasons).toHaveLength(2);
    expect(history.seasons[0].weeks.map((w) => w.week)).toEqual([2]);
  });

  it('stops at a season it cannot read, and says the span is short', async () => {
    client.getLeague.mockImplementation((id: string) =>
      id === 'L2026'
        ? Promise.resolve(league('2026', 'L2025'))
        : Promise.reject(new Error('404')),
    );

    const history = await sleeperProvider.loadHistory!('L2026');

    // What was read stays read; the walk simply ends early and admits it.
    expect(history.seasons.map((s) => s.season)).toEqual(['2026']);
    expect(history.truncated).toBe(true);
  });

  it('gives up after ten seasons rather than following a cycle', async () => {
    // Every league points at another that exists, so the chain never ends.
    client.getLeague.mockImplementation((id: string) =>
      Promise.resolve(league(id.slice(1), `L${Number(id.slice(1)) - 1}`)),
    );

    const history = await sleeperProvider.loadHistory!('L2026');

    expect(history.seasons).toHaveLength(10);
    expect(history.truncated).toBe(true);
  });
});

describe('loadTransactions', () => {
  it('walks the same chain and returns every move, newest first', async () => {
    const history = await sleeperProvider.loadTransactions!('L2026');

    // Two seasons of seventeen transaction weeks each, one move apiece — the
    // calendar the feed actually runs on, not the two-week regular season this
    // stub league plays. See the test below.
    expect(history.transactions).toHaveLength(34);
    expect(history.seasons).toEqual(['2026', '2025']);
    expect(history.truncated).toBe(false);

    const created = history.transactions.map((t) => t.created);
    expect(created).toEqual([...created].sort((a, b) => b - a));
  });

  /**
   * Sleeper files the offseason under week 1 and stops at 17, and neither
   * bound comes from the league's own settings — this league's playoffs start
   * in week 3.
   */
  it('reads the whole transaction calendar, not the regular season', async () => {
    await sleeperProvider.loadTransactions!('L2026');

    const weeks = client.getTransactions.mock.calls
      .filter(([id]) => id === 'L2026')
      .map(([, week]) => week);
    expect(weeks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  });

  it('skips a week that fails rather than losing the season', async () => {
    client.getTransactions.mockImplementation((id: string, week: number) =>
      week === 1
        ? Promise.reject(new Error('502'))
        : Promise.resolve(transaction(`${id}-${week}`, week)),
    );

    const history = await sleeperProvider.loadTransactions!('L2026');

    expect(history.transactions.length).toBeGreaterThan(0);
    expect(history.transactions.every((t) => t.week !== 1)).toBe(true);
  });

  it('stops at a season it cannot read, and says the span is short', async () => {
    client.getLeague.mockImplementation((id: string) =>
      id === 'L2026'
        ? Promise.resolve(league('2026', 'L2025'))
        : Promise.reject(new Error('404')),
    );

    const history = await sleeperProvider.loadTransactions!('L2026');

    expect(history.seasons).toEqual(['2026']);
    expect(history.truncated).toBe(true);
  });

  it('reports a league with no moves as a league with no moves', async () => {
    client.getTransactions.mockResolvedValue([]);

    const history = await sleeperProvider.loadTransactions!('L2026');

    expect(history.transactions).toEqual([]);
    expect(history.seasons).toEqual([]);
    expect(history.truncated).toBe(false);
  });
});
