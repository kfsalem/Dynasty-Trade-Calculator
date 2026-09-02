import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TradeSuggestions } from './TradeSuggestions';
import {
  makeLeague,
  makePlayer,
  makeRoster,
  makeSettings,
  makeValue,
} from '../engine/testFixtures';
import type { Player, PlayerValue } from '../types';
import type { ManagerModel } from '../engine/managers';

/**
 * These are about the one thing the panel says before the list is trustworthy.
 *
 * The manager walk is around seventy requests and the list re-sorts when it
 * lands. `useManagerModel` computed `loading` and `failed` from the start and
 * `App` passed neither, so a reader opening the tab got a list ranked with
 * every partner weighted alike, watched it re-order a couple of seconds later,
 * and was told nothing about either state.
 */
const settings = makeSettings(['QB', 'RB'], { draftRounds: 1, teamCount: 2 });
const league = makeLeague([makeRoster(1, ['p1']), makeRoster(2, ['p2'])], settings);
const players = new Map<string, Player>([
  ['p1', makePlayer('p1', 'QB')],
  ['p2', makePlayer('p2', 'RB')],
]);
const values = new Map<string, PlayerValue>([
  ['p1', makeValue('p1', 900, 'QB')],
  ['p2', makeValue('p2', 800, 'RB')],
]);

/** A landed model, stated flat: these tests are about the notice, not the walk. */
const landed: ManagerModel = {
  managers: new Map(),
  rosters: new Map(),
  orphans: new Set(),
  trades: 9,
  unattributed: 0,
  tradesPerSeason: 2.25,
  meanTrades: 4.5,
  seasons: ['2024', '2025'],
  truncated: false,
};

function renderPanel(props: Partial<Parameters<typeof TradeSuggestions>[0]> = {}) {
  return render(
    <TradeSuggestions
      league={league}
      players={players}
      values={values}
      picks={[]}
      // No summaries on purpose. The notice sits above the list and is the
      // whole subject here; the ordering itself is `engine/suggest`'s to test.
      summaries={[]}
      myRosterId={1}
      onOpenInCalculator={() => {}}
      {...props}
    />,
  );
}

describe('TradeSuggestions, while the manager walk is out', () => {
  it('says the order is provisional rather than letting the list move silently', () => {
    renderPanel({ managersLoading: true });

    expect(screen.getByText(/ranked on value alone until it lands/)).toBeInTheDocument();
  });

  it('says so when the walk lost a request, and that nothing else is affected', () => {
    renderPanel({ managersFailed: true });

    expect(screen.getByText(/every manager is weighted the same/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing else on this page is affected/)).toBeInTheDocument();
  });

  it('drops the notice once the model lands, and says what the order counts', () => {
    renderPanel({ managers: landed, managersLoading: false });

    expect(screen.queryByText(/until it lands/)).not.toBeInTheDocument();
    expect(screen.getByText(/how often each manager/)).toBeInTheDocument();
    expect(screen.getByText(/9 trades since 2024/)).toBeInTheDocument();
  });

  it('says when the span behind the figure is short', () => {
    // The walk stops at MAX_SEASONS or at the first season Sleeper has dropped,
    // and the trade count is then a floor. The bench panel says so for the same
    // walk; this one quoted the figure flat.
    renderPanel({ managers: { ...landed, truncated: true } });

    expect(
      screen.getByText(/as far back as Sleeper still publishes/),
    ).toBeInTheDocument();
  });

  it('says nothing at all when the walk was never asked for', () => {
    // The tab is gated, and a visitor who has not opened it is not waiting on
    // anything. An idle query is not a loading one.
    renderPanel();

    expect(screen.queryByText(/until it lands/)).not.toBeInTheDocument();
    expect(screen.queryByText(/weighted the same/)).not.toBeInTheDocument();
  });
});
