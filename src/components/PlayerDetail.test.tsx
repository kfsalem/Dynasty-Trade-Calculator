import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlayerDetail } from './PlayerDetail';
import { PlayerName } from './PlayerName';
import { OpenPlayerContext } from '../hooks/useOpenPlayer';
import type { PlayerDetail as Detail } from '../engine/playerDetail';
import { makePick, makePlayer } from '../engine/testFixtures';

const detail = (over: Partial<Detail> = {}): Detail => ({
  player: { ...makePlayer('p1', 'WR', 24), name: 'Marvin Harrison', team: 'ARI' },
  owner: { rosterId: 3, teamName: 'Big 3', mine: true },
  starting: false,
  unavailable: false,
  value: { dynasty: 944, winNow: 612, market: 3100 },
  wouldStartOn: 1,
  trend: null,
  ...over,
});

describe('PlayerDetail', () => {
  it('names the player and says both scales with what each one means', () => {
    render(<PlayerDetail detail={detail()} chartSeason={2025} onClose={() => {}} />);

    expect(screen.getByRole('heading', { name: 'Marvin Harrison' })).toBeInTheDocument();
    expect(screen.getByText('944')).toBeInTheDocument();
    expect(screen.getByText('What he is worth to hold.')).toBeInTheDocument();
    expect(screen.getByText('612')).toBeInTheDocument();
    expect(screen.getByText(/The market quotes him at/)).toBeInTheDocument();
  });

  it('places him in the league: whose bench, and who else would start him', () => {
    render(<PlayerDetail detail={detail()} chartSeason={2025} onClose={() => {}} />);

    expect(screen.getByText('On your bench.')).toBeInTheDocument();
    expect(screen.getByText('Would start on 1 team other than his own.')).toBeInTheDocument();
  });

  it('says a free agent is on the wire and counts every roster', () => {
    render(
      <PlayerDetail
        detail={detail({ owner: null, starting: null, wouldStartOn: 3 })}
        chartSeason={2025}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText('On the waiver wire.')).toBeInTheDocument();
    expect(screen.getByText('Would start on 3 teams in this league.')).toBeInTheDocument();
  });

  it('closes from its close button', async () => {
    const onClose = vi.fn();
    render(<PlayerDetail detail={detail()} chartSeason={2025} onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders nothing inside the dialog while no player is open', () => {
    render(<PlayerDetail detail={null} chartSeason={2025} onClose={() => {}} />);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });
});

describe('PlayerName', () => {
  it('opens the panel for its player when the app provides one', async () => {
    const open = vi.fn();
    render(
      <OpenPlayerContext.Provider value={open}>
        <PlayerName player={makePlayer('p9', 'RB')} />
      </OpenPlayerContext.Provider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Player p9' }));
    expect(open).toHaveBeenCalledWith('p9');
  });

  it('stays plain text outside the provider, rather than a button that does nothing', () => {
    render(<PlayerName player={makePlayer('p9', 'RB')} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('PlayerDetail, for a draft pick', () => {
  const pickDetail = (slotKnown: boolean) => ({
    pick: makePick('2027-3-2', '2027', 3, 2, 140, {
      ownerRosterId: 1,
      marketValue: 168,
      slot: 1,
      slotKnown,
      label: slotKnown ? '2027 3rd (3.01)' : '2027 3rd (proj 3.01)',
    }),
    holder: { rosterId: 1, teamName: 'Big 3', mine: true },
    original: { rosterId: 2, teamName: 'Rookie SZN', mine: false },
    teamCount: 10,
  });

  it('says whose it is, what it is worth, and how picks are priced', () => {
    render(
      <PlayerDetail detail={null} pick={pickDetail(false)} chartSeason={2025} onClose={() => {}} />,
    );

    expect(screen.getByRole('heading', { name: '2027 3rd (proj 3.01)' })).toBeInTheDocument();
    expect(screen.getByText(/Held by you · originally Rookie SZN's/)).toBeInTheDocument();
    expect(screen.getByText('168')).toBeInTheDocument();
    // League size moves the price: a 3.01 in a ten-team draft is the 21st pick.
    expect(screen.getByText(/a 3\.01 is the 21st pick here/)).toBeInTheDocument();
  });

  it('tells a projected slot from a published one', () => {
    const { unmount } = render(
      <PlayerDetail detail={null} pick={pickDetail(false)} chartSeason={2025} onClose={() => {}} />,
    );
    expect(screen.getByText(/Projected from how strong Rookie SZN's/)).toBeInTheDocument();
    unmount();

    render(
      <PlayerDetail detail={null} pick={pickDetail(true)} chartSeason={2025} onClose={() => {}} />,
    );
    expect(screen.getByText(/published its draft order/)).toBeInTheDocument();
  });
});
