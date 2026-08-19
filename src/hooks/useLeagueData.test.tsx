import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { deferred, withClient } from '../test/harness';
import { makeLeague, makePlayer, makeRoster, makeSettings, makeValue } from '../engine/testFixtures';
import type { Player } from '../types';
import type { ValueBundle } from '../values/fantasycalc';
import type { PickValueTable } from '../values/dynastyprocess';
import type { LeagueBundle } from '../platforms/types';

// Only the fetchers are replaced. These modules also export helpers the engine
// calls directly — `buildDraftPicks` reads the pick-label parser out of
// `dynastyprocess` — so a wholesale mock replaces real code with `undefined`
// and fails somewhere that has nothing to do with the test.
vi.mock('../platforms/sleeper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platforms/sleeper')>()),
  sleeperProvider: { loadLeague: vi.fn() },
}));
vi.mock('../values/fantasycalc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../values/fantasycalc')>()),
  fetchFantasyCalcValues: vi.fn(),
}));
vi.mock('../values/dynastyprocess', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../values/dynastyprocess')>()),
  fetchPickValues: vi.fn(),
}));
vi.mock('../data/activity', () => ({
  fetchSnapCounts: vi.fn(async () => null),
  fetchDepthCharts: vi.fn(async () => null),
  fetchOpportunity: vi.fn(async () => null),
}));

import { sleeperProvider } from '../platforms/sleeper';
import { fetchFantasyCalcValues } from '../values/fantasycalc';
import { fetchPickValues } from '../values/dynastyprocess';
import { useLeagueSummaries } from './useLeagueData';

const settings = makeSettings(['QB', 'RB'], { draftRounds: 2, teamCount: 2 });
const league = makeLeague([makeRoster(1, ['p1', 'p2']), makeRoster(2, ['p3', 'p4'])], settings);

const players = new Map<string, Player>([
  ['p1', makePlayer('p1', 'QB')],
  ['p2', makePlayer('p2', 'RB')],
  ['p3', makePlayer('p3', 'QB')],
  ['p4', makePlayer('p4', 'RB')],
]);

const bundle: LeagueBundle = {
  league,
  players,
  freeAgents: new Map(),
  tradedPicks: [],
  currentSeason: '2026',
  currentWeek: null,
  seasonPhase: 'unknown',
  draftOrders: [],
};

const valueBundle: ValueBundle = {
  bySleeperId: new Map([
    ['p1', makeValue('p1', 1000, 'QB')],
    ['p2', makeValue('p2', 800, 'RB')],
    ['p3', makeValue('p3', 600, 'QB')],
    ['p4', makeValue('p4', 400, 'RB')],
  ]),
  rawMax: 1000,
  fetchedAt: 0,
};

const pickTable: PickValueTable = {
  rows: [],
  seasons: ['2027'],
  fetchedAt: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useLeagueSummaries — picksSettled', () => {
  /**
   * The regression test for the bug that shipped twice.
   *
   * `picks` is built from the DynastyProcess pick table *and* the FantasyCalc
   * values, which are two hosts behind two caches racing from one trigger. The
   * first fix watched only the pick query, so `picksSettled` went true while
   * `picks` was still empty — and a shared link resolved in that window lost
   * every traded pick and told the recipient they were no longer on the roster.
   *
   * Asserting on the end state cannot catch this: the end state was always
   * right. The assertion has to be about every moment in between, so this
   * records what the hook published on each render and checks the invariant
   * across all of them.
   */
  it('is never true while picks is still empty, whatever order the queries land in', async () => {
    const values = deferred<ValueBundle>();
    vi.mocked(sleeperProvider.loadLeague).mockResolvedValue(bundle);
    vi.mocked(fetchPickValues).mockResolvedValue(pickTable);
    vi.mocked(fetchFantasyCalcValues).mockReturnValue(values.promise);

    const seen: { settled: boolean; picks: number }[] = [];

    const { result } = renderHook(
      () => {
        const state = useLeagueSummaries('L1');
        seen.push({ settled: state.picksSettled, picks: state.picks.length });
        return state;
      },
      { wrapper: withClient() },
    );

    // The window the bug lives in: league in hand, pick table in hand, values
    // still on the wire. The pick list cannot be built yet.
    await waitFor(() => expect(result.current.league).toBeDefined());
    await waitFor(() => expect(fetchFantasyCalcValues).toHaveBeenCalled());
    expect(result.current.picks).toEqual([]);

    await act(async () => {
      values.resolve(valueBundle);
    });

    // Everything has landed, and this league does have picks — so any render
    // that claimed settled-with-nothing was claiming something false.
    await waitFor(() => expect(result.current.picks.length).toBeGreaterThan(0));
    expect(result.current.picksSettled).toBe(true);

    const lies = seen.filter((s) => s.settled && s.picks === 0);
    expect(lies).toEqual([]);
  });

  it('is true once the pick query fails, since the list will never fill', async () => {
    // The other empty array: no picks are coming, and a consumer that waits for
    // them waits forever. `picksUnavailable` is the flag that says why.
    vi.mocked(sleeperProvider.loadLeague).mockResolvedValue(bundle);
    vi.mocked(fetchFantasyCalcValues).mockResolvedValue(valueBundle);
    vi.mocked(fetchPickValues).mockRejectedValue(new Error('DynastyProcess is down'));

    const { result } = renderHook(() => useLeagueSummaries('L1'), { wrapper: withClient() });

    // `usePickValues` sets `retry: 1` itself, which beats the client default,
    // so the failure only surfaces after react-query's backoff. Waiting it out
    // is the honest option — overriding the retry here would test a query the
    // app does not actually make.
    await waitFor(() => expect(result.current.picksUnavailable).toBe(true), {
      timeout: 5000,
    });
    expect(result.current.picksSettled).toBe(true);
    expect(result.current.picks).toEqual([]);
  });
});
