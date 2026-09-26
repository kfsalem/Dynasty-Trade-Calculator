import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RosterList } from './RosterList';
import { summarizeRoster } from '../engine/rosterValue';
import type { Player, PlayerValue } from '../types';
import { makeLeague, makePlayer, makeRoster, makeSettings, makeValue } from '../engine/testFixtures';

function renderList() {
  const settings = makeSettings(['WR']);
  const players = new Map<string, Player>([
    ['a', makePlayer('a', 'WR')],
    ['b', makePlayer('b', 'WR')],
  ]);
  const values = new Map<string, PlayerValue>([
    ['a', makeValue('a', 2000, 'WR')],
    ['b', makeValue('b', 1000, 'WR')],
  ]);
  const rosters = [makeRoster(1, ['a']), makeRoster(2, ['b'])];
  const league = makeLeague(rosters, settings);
  const summaries = rosters.map((r) => summarizeRoster(r, players, values, settings));

  return render(
    <RosterList
      league={league}
      summaries={summaries}
      myRosterId={1}
      snaps={new Map()}
      usage={new Map()}
      snapsMeta={{ season: 2026, throughWeek: 2, chartSeason: 2026 }}
    />,
  );
}

/**
 * The Rosters tab after #120 and #68: the answer before the method, and the
 * activity columns as a choice rather than a cost every row pays.
 */
describe('RosterList', () => {
  it('leads with the rankings, and keeps the method one tap away', () => {
    renderList();

    expect(screen.getByRole('heading', { name: 'Power rankings' })).toBeInTheDocument();
    const method = screen.getByText('How these rankings are built').closest('details');
    expect(method).not.toHaveAttribute('open');
    expect(method?.textContent).toMatch(/Two questions, two numbers/);
  });

  it('leaves the snap and usage columns off until asked for', async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(screen.getByRole('button', { name: /Team 1/ }));
    expect(screen.queryAllByTitle(/No snap data/)).toHaveLength(0);

    const toggle = screen.getByRole('button', { name: 'Snaps & usage' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryAllByTitle(/No snap data/).length).toBeGreaterThan(0);
  });
});
