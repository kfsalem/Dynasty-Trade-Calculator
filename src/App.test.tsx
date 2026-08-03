import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { withClient } from './test/harness';
import {
  makeLeague,
  makePlayer,
  makeRoster,
  makeSettings,
  makeValue,
} from './engine/testFixtures';
import type { DraftPick, League, Player, PlayerValue } from './types';

/**
 * `App` is mounted against a stubbed data hook rather than a stubbed network.
 *
 * The bugs these tests cover are in the wiring — what `App` does with the link,
 * the seed and the league id — and none of them care where the league came
 * from. Driving the hook directly makes the ordering explicit instead of
 * something to be arranged through three layers of react-query.
 */
const mocks = vi.hoisted(() => ({
  states: {} as Record<string, unknown>,
}));

vi.mock('./hooks/useLeagueData', () => ({
  useLeagueSummaries: (leagueId: string | null) =>
    mocks.states[leagueId ?? ''] ?? {
      league: undefined,
      players: undefined,
      values: undefined,
      scarcity: undefined,
      summaries: [],
      picks: [],
      picksUnavailable: false,
      picksSettled: false,
      snaps: undefined,
      usage: undefined,
      roles: undefined,
      snapsMeta: undefined,
      adjustments: undefined,
      priced: undefined,
      trends: undefined,
      // Mirrors the real hook, where the league query is disabled without an
      // id: no league chosen is idle, not loading. The import button reads
      // "Loading…" and goes disabled if this lies.
      isLoading: Boolean(leagueId),
      error: null,
    },
}));

const settings = makeSettings(['QB', 'RB'], { draftRounds: 1, teamCount: 2 });

function leagueWithRosters(id: string, a: number, b: number): League {
  return {
    ...makeLeague([makeRoster(a, [`p${a}`]), makeRoster(b, [`p${b}`])], settings),
    id,
    name: `League ${id}`,
  };
}

function playersFor(ids: number[]): Map<string, Player> {
  return new Map(ids.map((n) => [`p${n}`, makePlayer(`p${n}`, 'QB')]));
}

function valuesFor(ids: number[]): Map<string, PlayerValue> {
  return new Map(ids.map((n) => [`p${n}`, makeValue(`p${n}`, 500, 'QB')]));
}

function ready(league: League, rosterIds: number[], picks: DraftPick[] = []) {
  return {
    league,
    players: playersFor(rosterIds),
    values: valuesFor(rosterIds),
    scarcity: undefined,
    summaries: [],
    picks,
    picksUnavailable: false,
    picksSettled: true,
    snaps: undefined,
    usage: undefined,
    roles: undefined,
    snapsMeta: undefined,
    adjustments: undefined,
    priced: undefined,
    trends: undefined,
    isLoading: false,
    error: null,
  };
}

function stillLoading() {
  return {
    league: undefined,
    players: undefined,
    values: undefined,
    scarcity: undefined,
    summaries: [],
    picks: [],
    picksUnavailable: false,
    picksSettled: false,
    snaps: undefined,
    usage: undefined,
    roles: undefined,
    snapsMeta: undefined,
    adjustments: undefined,
    priced: undefined,
    trends: undefined,
    isLoading: true,
    error: null,
  };
}

/**
 * `App` reads the shared trade once, at module scope, so a test that wants a
 * particular link has to set the address *and* re-import the module.
 */
async function openAt(url: string) {
  window.history.replaceState(null, '', url);
  vi.resetModules();
  const { default: App } = await import('./App');
  return render(<App />, { wrapper: withClient() });
}

beforeEach(() => {
  mocks.states = {};
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('App — a link that is still loading', () => {
  /**
   * The regression test for the URL being cleared on mount.
   *
   * `shared` is null on the first commit and the league id is already set from
   * the link, so an unguarded write effect put the bare path in the address bar
   * immediately — a second or more before the league arrived to restore it. A
   * refresh in that window, or a league that never loads, left the recipient
   * holding a link that no longer described anything.
   */
  it('leaves the trade in the address bar while the league is still in flight', async () => {
    mocks.states['111111'] = stillLoading();

    await openAt('/?l=111111&a=1&b=2&ap=p1');

    expect(await screen.findByLabelText('Loading league')).toBeInTheDocument();

    // The link is the only copy of the trade that exists right now.
    expect(window.location.search).toContain('l=111111');
    expect(window.location.search).toContain('ap=p1');
  });

  it('still holds the link when the league fails to load', async () => {
    mocks.states['111111'] = { ...stillLoading(), isLoading: false, error: new Error('nope') };

    await openAt('/?l=111111&a=1&b=2&ap=p1');

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load that league");
    // Nothing else remembers the trade, so a reload is the only way back to it.
    expect(window.location.search).toContain('l=111111');
  });

  it('clears an unusable link once the league is in and has rejected it', async () => {
    // Roster 99 is not in this league. The trade is dropped — and with it, the
    // reason to keep the link in the address bar.
    mocks.states['111111'] = ready(leagueWithRosters('111111', 1, 2), [1, 2]);

    await openAt('/?l=111111&a=99&b=2&ap=p1');

    await waitFor(() => expect(window.location.search).toBe(''));
  });
});

describe('App — switching leagues', () => {
  /**
   * The regression test for a trade outliving the league it belongs to.
   *
   * Roster and asset ids mean nothing in another league, and seeding the
   * builder with them hands `buildSide` a roster that does not exist. It throws
   * on one, so the whole render goes down — the crash `resolveShare` guards the
   * front door against, reached through the back.
   */
  it('does not carry a trade into the next league', async () => {
    mocks.states['111111'] = ready(leagueWithRosters('111111', 1, 2), [1, 2]);
    mocks.states['222222'] = ready(leagueWithRosters('222222', 10, 11), [10, 11]);

    await openAt('/?l=111111&a=1&b=2&ap=p1');

    // The link landed: we are on the calculator with a trade in it.
    // By role: the tab and the panel heading share this name.
    expect(
      await screen.findByRole('heading', { name: 'Trade calculator' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toContain('ap=p1'));

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Change league' }));
    await user.type(screen.getByLabelText(/Sleeper league ID/i), '222222');
    await user.click(screen.getByRole('button', { name: 'Load league' }));

    // League 2 has neither roster 1 nor player p1. Rendering at all is the
    // assertion; the old code threw `Unknown roster 1` from `buildSide`.
    expect(await screen.findByText('League 222222')).toBeInTheDocument();
    expect(window.location.search).not.toContain('ap=p1');
  });
});
