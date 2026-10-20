import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LeagueImport } from './LeagueImport';
import type { LeagueSearch } from '../platforms/types';

const findLeagues = vi.fn<(username: string) => Promise<LeagueSearch>>();
vi.mock('../platforms/sleeper', () => ({ sleeperProvider: { findLeagues: (u: string) => findLeagues(u) } }));

const search: LeagueSearch = {
  userId: 'u9',
  displayName: 'KJFantasy',
  season: '2026',
  leagues: [
    { leagueId: '1336802780030988288', name: 'The Eternal Rebuild', teams: 10, format: 'dynasty' },
    { leagueId: '999999999999999999', name: 'Work League', teams: 12, format: 'redraft' },
  ],
};

beforeEach(() => {
  findLeagues.mockReset();
  localStorage.clear();
});

const field = () => screen.getByLabelText(/Sleeper username/i);
const submit = () => screen.getByRole('button', { name: 'Find my league' });

describe('LeagueImport', () => {
  it('opens a league ID or URL directly, without a lookup', async () => {
    const onSubmit = vi.fn();
    render(<LeagueImport onSubmit={onSubmit} />);

    await userEvent.type(field(), 'https://sleeper.com/leagues/1235622229488717824/team');
    await userEvent.click(submit());

    expect(onSubmit).toHaveBeenCalledWith('1235622229488717824');
    expect(findLeagues).not.toHaveBeenCalled();
  });

  it('lists a username’s leagues, and loads the one picked with whose it is', async () => {
    findLeagues.mockResolvedValue(search);
    const onSubmit = vi.fn();
    render(<LeagueImport onSubmit={onSubmit} />);

    await userEvent.type(field(), 'kjfantasy');
    await userEvent.click(submit());

    expect(findLeagues).toHaveBeenCalledWith('kjfantasy');
    expect(await screen.findByText("KJFantasy's leagues · 2026")).toBeInTheDocument();
    expect(screen.getByText('12 teams · Redraft')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /The Eternal Rebuild/ }));
    expect(onSubmit).toHaveBeenCalledWith('1336802780030988288', 'u9');
  });

  it('remembers the username, so the list is one tap away next time', async () => {
    findLeagues.mockResolvedValue(search);
    const { unmount } = render(<LeagueImport onSubmit={vi.fn()} />);
    await userEvent.type(field(), 'kjfantasy');
    await userEvent.click(submit());
    await screen.findByText("KJFantasy's leagues · 2026");
    unmount();

    render(<LeagueImport onSubmit={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Show leagues for kjfantasy' }));
    expect(await screen.findByRole('button', { name: /Work League/ })).toBeInTheDocument();
  });

  it('forgets the username on request', async () => {
    localStorage.setItem('dynasty:sleeperUsername', 'kjfantasy');
    render(<LeagueImport onSubmit={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Forget' }));

    expect(screen.queryByRole('button', { name: /Show leagues for/ })).not.toBeInTheDocument();
    expect(localStorage.getItem('dynasty:sleeperUsername')).toBeNull();
  });

  it('shows the lookup’s error for an unknown username', async () => {
    findLeagues.mockRejectedValue(new Error('No Sleeper user named "nobody".'));
    render(<LeagueImport onSubmit={vi.fn()} />);

    await userEvent.type(field(), 'nobody');
    await userEvent.click(submit());

    expect(await screen.findByRole('alert')).toHaveTextContent('No Sleeper user named "nobody".');
  });

  it('says so when the user has no leagues at all', async () => {
    findLeagues.mockResolvedValue({ ...search, season: '2025', leagues: [] });
    render(<LeagueImport onSubmit={vi.fn()} />);

    await userEvent.type(field(), 'kjfantasy');
    await userEvent.click(submit());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'KJFantasy has no NFL leagues on Sleeper for 2025.',
    );
  });

  it('rejects input that is neither a username nor a league', async () => {
    render(<LeagueImport onSubmit={vi.fn()} />);

    await userEvent.type(field(), 'my league name');
    await userEvent.click(submit());

    expect(screen.getByRole('alert')).toHaveTextContent("doesn't look like a Sleeper username");
    expect(findLeagues).not.toHaveBeenCalled();
  });
});
