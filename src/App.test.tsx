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
      retry: () => {},
      retrying: false,
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
    retry: () => {},
    retrying: false,
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
    retry: () => {},
    retrying: false,
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

/**
 * The three states that are not "it worked": still loading, failed, and never
 * started. Each one used to be a default — a spinner, a red box, and a form —
 * and each is now the surface someone actually judges the app on, because two
 * of the three are where a first-time user spends their first ten seconds.
 */
describe('App — the states that are not success', () => {
  it('explains what is slow instead of spinning at the user', async () => {
    mocks.states['111111'] = stillLoading();

    // A whole trade in the link, because a bare `l=` is not one — `decodeTrade`
    // rejects it and the app falls back to the remembered league, which these
    // tests clear.
    await openAt('/?l=111111&a=1&b=2&ap=p1');

    // The load is three requests deep and holds the screen for seconds. An
    // unexplained wait is how a slow league becomes a suspected broken one.
    const loading = await screen.findByLabelText('Loading league');
    expect(loading).toHaveTextContent(/pricing every player/i);
  });

  /**
   * A failure with no way out except the address bar is worse here than
   * anywhere else in the app: on a shared link a reload is *also* the scariest
   * button on screen, which is why the effect above works so hard to keep the
   * trade in the URL. A retry is the cheap fix.
   */
  it('offers a retry when the league fails, rather than only a reload', async () => {
    const retry = vi.fn();
    mocks.states['111111'] = {
      ...stillLoading(),
      isLoading: false,
      error: new Error('Sleeper is down'),
      retry,
    };

    await openAt('/?l=111111&a=1&b=2&ap=p1');

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('teaches replacement level before anyone has loaded a league', async () => {
    await openAt('/');

    // The one idea the app is built on, and the reason its numbers differ from
    // every other calculator's. A user who has not read it reads a low value
    // as a bug.
    expect(
      await screen.findByRole('heading', { name: /worth less here than on KTC/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/What he adds to your lineup/i)).toBeInTheDocument();
  });

  /**
   * The explainer is for a first run, not for every run. Someone staring at a
   * failed load needs the error and the retry, and burying those under a
   * lecture about replacement level is how a designed state becomes a worse
   * one than the default it replaced.
   */
  it('does not lecture about replacement level over a failed load', async () => {
    mocks.states['111111'] = {
      ...stillLoading(),
      isLoading: false,
      error: new Error('nope'),
    };

    await openAt('/?l=111111&a=1&b=2&ap=p1');

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /worth less here than on KTC/i }),
    ).not.toBeInTheDocument();
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

describe('App — a league that does not trade', () => {
  /**
   * `disable_trades` means the two trade tabs have nothing to offer. An
   * explanation, not an empty state: "no trades found" reads as a failure of
   * the search and invites the reader to try again, change teams, or conclude
   * the app is broken — none of which help, because the league decided this.
   */
  const noTrades = (id = '55') => {
    const league = {
      ...leagueWithRosters(id, 1, 2),
      settings: makeSettings(['QB', 'RB'], {
        draftRounds: 1,
        teamCount: 2,
        tradesDisabled: true,
      }),
    };
    mocks.states[id] = ready(league, [1, 2]);
    return id;
  };

  it('explains the rule on the calculator instead of pricing offers nobody can accept', async () => {
    const id = noTrades();
    localStorage.setItem('dynasty:leagueId', id);
    await openAt('/');

    await userEvent.click(await screen.findByRole('tab', { name: 'Trade calculator' }));

    expect(await screen.findByText("This league doesn't do trades")).toBeInTheDocument();
    expect(screen.getByText(/could not be made/)).toBeInTheDocument();
  });

  it('explains the rule on the ideas tab, and points at what still works', async () => {
    const id = noTrades('56');
    localStorage.setItem('dynasty:leagueId', id);
    await openAt('/');

    await userEvent.click(await screen.findByRole('tab', { name: 'Trade ideas' }));

    expect(await screen.findByText("This league doesn't do trades")).toBeInTheDocument();
    expect(screen.getByText(/roster and free-agent views/)).toBeInTheDocument();
  });

  it('leaves the tabs themselves in place', async () => {
    // Removing them would hide the explanation along with the feature, and a
    // manager who knows the app has a calculator would think it had broken.
    const id = noTrades('57');
    localStorage.setItem('dynasty:leagueId', id);
    await openAt('/');

    expect(await screen.findByRole('tab', { name: 'Trade calculator' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Trade ideas' })).toBeInTheDocument();
  });

  it('still builds trades in an ordinary league', async () => {
    mocks.states['58'] = ready(leagueWithRosters('58', 1, 2), [1, 2]);
    localStorage.setItem('dynasty:leagueId', '58');
    await openAt('/');

    await userEvent.click(await screen.findByRole('tab', { name: 'Trade calculator' }));

    expect(screen.queryByText("This league doesn't do trades")).not.toBeInTheDocument();
  });
});
