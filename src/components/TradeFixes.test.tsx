import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

// The calculator's own test league: three rosters, one QB and one RB slot.
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

describe('TradeBuilder — making an uneven trade fair (#168)', () => {
  // p1 at 900 for p3 at 500: 44% apart. Team 2's p4, at 400, levels it exactly.
  const uneven = new Map(values);
  uneven.set('p3', makeValue('p3', 500, 'QB'));
  uneven.set('p4', makeValue('p4', 400, 'RB'));

  const renderUneven = (trade: PendingTrade = initial) =>
    render(
      <TradeBuilder
        league={league}
        players={players}
        values={uneven}
        picks={[]}
        picksUnavailable={false}
        myRosterId={1}
        initial={trade}
        priced={priced}
      />,
    );

  const panel = () => screen.queryByRole('region', { name: 'Make it fair' });

  it('offers the change that evens it, and applies it in one tap', async () => {
    const user = userEvent.setup();
    renderUneven();

    const fixes = panel();
    expect(fixes).toBeInTheDocument();
    const row = within(fixes!).getByText('Team 2 adds Player p4').closest('li')!;
    expect(row).toHaveTextContent('Very fair · 0% apart');

    await user.click(within(row).getByRole('button', { name: 'Apply' }));

    const verdict = screen.getByRole('region', { name: 'Verdict' });
    expect(within(verdict).getByRole('heading', { level: 3 })).toHaveTextContent('Very fair');
    // Fair now, so there is nothing left to fix.
    expect(panel()).not.toBeInTheDocument();
  });

  it('says so, and how close it got, when no single change is enough', () => {
    // 1700 for 400. Team 2 adding p3 is the nearest, at 900 for 1700: 47%.
    renderUneven({
      ...initial,
      givesA: { playerIds: ['p1', 'p2'], pickIds: [] },
      givesB: { playerIds: ['p4'], pickIds: [] },
    });
    expect(panel()).toHaveTextContent('No single addition, removal or swap');
    expect(panel()).toHaveTextContent('47% apart');
  });

  it('stays out of the way while one side is still empty', () => {
    renderUneven({ ...initial, givesB: { playerIds: [], pickIds: [] } });
    expect(panel()).not.toBeInTheDocument();
  });
});
