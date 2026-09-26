import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LeagueHistory } from './LeagueHistory';
import { leagueHistoryStats } from '../engine/leagueHistory';
import type { LeagueHistory as History, SeasonHistory } from '../platforms/types';

/*
  Four teams, one regular-season week, a four-team bracket. Roster 4 is an
  orphan: it has no manager, and it wins the title.
*/
const season: SeasonHistory = {
  leagueId: 'L2024',
  season: '2024',
  startingSlots: [],
  managers: new Map([
    [1, { userId: 'u1', name: 'Ann', teamName: 'Ann FC' }],
    [2, { userId: 'u2', name: 'Bo', teamName: 'Bo FC' }],
    [3, { userId: 'u3', name: 'Cy', teamName: 'Cy FC' }],
    [4, { userId: null, name: 'Orphan team', teamName: 'Nine' }],
  ]),
  weeks: [],
  claimed: new Map(),
  results: [
    { week: 1, rosterId: 1, matchupId: 1, points: 150 },
    { week: 1, rosterId: 2, matchupId: 1, points: 90 },
    { week: 1, rosterId: 3, matchupId: 2, points: 100 },
    { week: 1, rosterId: 4, matchupId: 2, points: 110 },
    { week: 2, rosterId: 1, matchupId: 1, points: 100 },
    { week: 2, rosterId: 4, matchupId: 1, points: 120 },
    { week: 2, rosterId: 2, matchupId: 2, points: 90 },
    { week: 2, rosterId: 3, matchupId: 2, points: 95 },
    { week: 3, rosterId: 4, matchupId: 1, points: 130 },
    { week: 3, rosterId: 3, matchupId: 1, points: 100 },
  ],
  playoffs: {
    weekStart: 2,
    teams: 4,
    roundType: 0,
    winners: [
      { round: 1, match: 1, teams: [1, 4], winner: 4, loser: 1, placement: null },
      { round: 1, match: 2, teams: [2, 3], winner: 3, loser: 2, placement: null },
      { round: 2, match: 3, teams: [4, 3], winner: 4, loser: 3, placement: 1 },
    ],
    losers: [],
  },
};

const history: History = { seasons: [season], players: new Map(), truncated: false };

function show(onModeChange = vi.fn()) {
  render(
    <LeagueHistory
      stats={leagueHistoryStats(history)}
      loading={false}
      failed={false}
      truncated={false}
      mode="points"
      onModeChange={onModeChange}
      myKey="u1"
    />,
  );
  return onModeChange;
}

describe('LeagueHistory', () => {
  it('names the champion by team, and an orphan as having no manager', () => {
    show();
    expect(screen.getByRole('heading', { name: 'League history' })).toBeInTheDocument();
    const champion = screen.getByText('Champion').parentElement!;
    expect(champion.textContent).toContain('Nine');
    expect(champion.textContent).toContain('no manager');
  });

  it('switches how standings are decided from the champions panel', async () => {
    const onModeChange = show();
    await userEvent.click(screen.getByRole('radio', { name: 'Official bracket' }));
    expect(onModeChange).toHaveBeenCalledWith('bracket');
  });

  it('shows records from the regular season only', () => {
    show();
    const highest = screen.getByText('Highest week').parentElement!;
    // Week 1's 150 is the top regular-season score; the 130 is a playoff game.
    expect(within(highest).getByText('150.00')).toBeInTheDocument();
  });

  it('opens the rivalries on the claimed manager', () => {
    show();
    expect(screen.getByLabelText('Manager')).toHaveValue('u1');
  });

  it('says so when the history could not be read, rather than showing an empty table', () => {
    render(
      <LeagueHistory
        stats={undefined}
        loading={false}
        failed
        truncated={false}
        mode="points"
        onModeChange={() => {}}
        myKey={null}
      />,
    );
    expect(screen.getByText(/history didn't load/)).toBeInTheDocument();
  });
});
