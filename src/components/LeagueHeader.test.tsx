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

describe('LeagueHeader, as the way into All leagues (#161)', () => {
  it('lists All leagues first, and opens it and closes itself when picked', async () => {
    const onOverview = vi.fn();
    render(
      <LeagueHeader
        league={league}
        onReset={vi.fn()}
        leagues={LEAGUES}
        onSwitch={vi.fn()}
        onOverview={onOverview}
      />,
    );
    const user = await open();

    const nav = screen.getByRole('navigation', { name: 'Your leagues' });
    expect(within(nav).getAllByRole('listitem')[0]).toHaveTextContent(
      'All leaguesThis week and shared players',
    );

    await user.click(within(nav).getByRole('button', { name: /^All leagues/ }));
    expect(onOverview).toHaveBeenCalled();
    expect(nav.closest('details')).not.toHaveAttribute('open');
  });

  it('closes itself when a league is picked, even one that opens with no wait', async () => {
    render(<LeagueHeader league={league} onReset={vi.fn()} leagues={LEAGUES} onSwitch={vi.fn()} />);
    const user = await open();

    const nav = screen.getByRole('navigation', { name: 'Your leagues' });
    await user.click(within(nav).getByRole('button', { name: /Tight Ends/ }));
    expect(nav.closest('details')).not.toHaveAttribute('open');
  });

  it('names the overview while it is showing, and makes every league a way back', async () => {
    const onSwitch = vi.fn();
    render(
      <LeagueHeader
        league={league}
        onReset={vi.fn()}
        leagues={LEAGUES}
        onSwitch={onSwitch}
        onOverview={vi.fn()}
        overview
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'All your leagues' })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/^All your leagues, 3 of them/));

    const nav = screen.getByRole('navigation', { name: 'Your leagues' });
    const items = within(nav).getAllByRole('listitem');
    expect(items[0]).toHaveAttribute('aria-current', 'true');
    expect(items[0]).toHaveTextContent('All leagues');
    // The league behind the overview is no longer "Open": it is a way back.
    await user.click(within(nav).getByRole('button', { name: /Test League/ }));
    expect(onSwitch).toHaveBeenCalledWith('test');
    // Its rules describe one league, and this screen is about all of them.
    expect(screen.queryByText('League rules')).toBeNull();
    expect(screen.getByRole('button', { name: 'Find another league' })).toBeInTheDocument();
  });
});
