import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LeagueHeader } from './LeagueHeader';
import { makeLeague, makeRoster, makeSettings } from '../engine/testFixtures';
import type { LeagueChoice } from '../platforms/types';

const league = makeLeague([makeRoster(1, []), makeRoster(2, [])], makeSettings(['QB', 'RB']));

const LEAGUES: LeagueChoice[] = [
  { leagueId: 'test', name: 'Test League', teams: 10, format: 'dynasty' },
  { leagueId: 'other', name: 'Tight Ends', teams: 12, format: 'dynasty' },
  { leagueId: 'third', name: 'Work League', teams: null, format: 'redraft' },
];

async function open() {
  const user = userEvent.setup();
  // The pill, by its accessible name; the list holds the name too.
  await user.click(screen.getByLabelText(/^Test League, /));
  return user;
}

describe('LeagueHeader, as the league switcher (#161)', () => {
  it("lists the manager's other leagues first, with the open one marked", async () => {
    render(<LeagueHeader league={league} onReset={vi.fn()} leagues={LEAGUES} onSwitch={vi.fn()} />);
    await open();

    const nav = screen.getByRole('navigation', { name: 'Your leagues' });
    const items = within(nav).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Test LeagueOpen',
      'Tight Ends12-team · Dynasty',
      'Work LeagueRedraft',
    ]);
    expect(items[0]).toHaveAttribute('aria-current', 'true');
    expect(within(items[0]).queryByRole('button')).toBeNull();
  });

  it('opens another league when it is picked', async () => {
    const onSwitch = vi.fn();
    render(<LeagueHeader league={league} onReset={vi.fn()} leagues={LEAGUES} onSwitch={onSwitch} />);
    const user = await open();

    await user.click(screen.getByRole('button', { name: /Tight Ends/ }));
    expect(onSwitch).toHaveBeenCalledWith('other');
  });

  it('keeps a way to a league the manager is not in', async () => {
    const onReset = vi.fn();
    render(<LeagueHeader league={league} onReset={onReset} leagues={LEAGUES} onSwitch={vi.fn()} />);
    const user = await open();

    await user.click(screen.getByRole('button', { name: 'Find another league' }));
    expect(onReset).toHaveBeenCalled();
  });

  it('shows no list, and the old button, when there is nowhere else to go', async () => {
    render(
      <LeagueHeader league={league} onReset={vi.fn()} leagues={[LEAGUES[0]]} onSwitch={vi.fn()} />,
    );
    await open();

    expect(screen.queryByRole('navigation', { name: 'Your leagues' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Change league' })).toBeInTheDocument();
  });

  it('shows no list before a team is claimed', async () => {
    render(<LeagueHeader league={league} onReset={vi.fn()} />);
    await open();

    expect(screen.queryByRole('navigation', { name: 'Your leagues' })).toBeNull();
  });
});
