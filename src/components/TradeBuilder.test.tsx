import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TradeBuilder, type PendingTrade } from './TradeBuilder';
import {
  makeLeague,
  makePlayer,
  makeRoster,
  makeSettings,
  makeValue,
} from '../engine/testFixtures';
import type { Player, PlayerValue, Position } from '../types';

// Three rosters, not two: each side's dropdown excludes the other side, so a
// two-team league leaves team A with nothing to switch to.
const settings = makeSettings(['QB', 'RB'], { draftRounds: 1, teamCount: 3 });
const league = makeLeague(
  [makeRoster(1, ['p1', 'p2']), makeRoster(2, ['p3', 'p4']), makeRoster(3, ['p5', 'p6'])],
  settings,
);

const players = new Map<string, Player>(
  ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((id, i) => [
    id,
    makePlayer(id, i % 2 === 0 ? 'QB' : 'RB'),
  ]),
);

const values = new Map<string, PlayerValue>(
  ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((id, i) => [
    id,
    makeValue(id, 900 - i * 100, i % 2 === 0 ? 'QB' : 'RB'),
  ]),
);

const priced = new Set<Position>(['QB', 'RB']);

const initial: PendingTrade = {
  teamA: 1,
  teamB: 2,
  givesA: { playerIds: ['p1'], pickIds: [] },
  givesB: { playerIds: ['p3'], pickIds: [] },
};

function renderBuilder(droppedFromLink?: number) {
  return render(
    <TradeBuilder
      league={league}
      players={players}
      values={values}
      picks={[]}
      picksUnavailable={false}
      myRosterId={1}
      initial={initial}
      droppedFromLink={droppedFromLink}
      priced={priced}
    />,
  );
}

const notice = () => screen.queryByText(/no longer on the roster that was sending/);

describe('TradeBuilder — the shared-link notice', () => {
  it('says how many assets the link lost', () => {
    renderBuilder(2);
    expect(notice()).toBeInTheDocument();
    expect(notice()).toHaveTextContent('2 assets');
  });

  it('says nothing when the link arrived intact', () => {
    renderBuilder(0);
    expect(notice()).not.toBeInTheDocument();
  });

  /**
   * The regression test for a notice that outlived its trade.
   *
   * It used to be read straight from the prop, which is derived from a link
   * parsed once at module scope — so it was fixed for the whole session. Clear
   * the trade, build a different one, and it was still on screen insisting that
   * "the trade below is not quite the one that was shared", about a trade the
   * link had never described.
   */
  it('retires once the trade has been cleared', async () => {
    const user = userEvent.setup();
    renderBuilder(1);
    expect(notice()).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear' }));

    expect(notice()).not.toBeInTheDocument();
  });

  it('retires once a side changes team, since nothing of the link survives that', async () => {
    const user = userEvent.setup();
    renderBuilder(1);
    expect(notice()).toBeInTheDocument();

    // The left side moves to roster 3; its selections belonged to roster 1.
    await user.selectOptions(screen.getAllByLabelText('Team')[0], '3');

    expect(notice()).not.toBeInTheDocument();
  });
});
