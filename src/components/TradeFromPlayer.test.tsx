import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlayerDetail } from './PlayerDetail';
import { TradeSuggestions } from './TradeSuggestions';
import type { PlayerDetail as Detail } from '../engine/playerDetail';
import {
  makeLeague,
  makePlayer,
  makeRoster,
  makeSettings,
  makeValue,
} from '../engine/testFixtures';
import type { Player, PlayerValue } from '../types';

/* Starting a trade from the player (#165): the way in, and the page it opens. */

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

function renderPanel(props: Partial<Parameters<typeof TradeSuggestions>[0]> = {}) {
  return render(
    <TradeSuggestions
      league={league}
      players={players}
      values={values}
      picks={[]}
      summaries={[]}
      myRosterId={1}
      onOpenInCalculator={() => {}}
      {...props}
    />,
  );
}

describe('PlayerDetail, starting a trade from the player (#165)', () => {
  it('asks who would trade for him when he is yours', async () => {
    const onTrade = vi.fn();
    const onClose = vi.fn();
    render(
      <PlayerDetail detail={detail()} chartSeason={2025} onClose={onClose} onTrade={onTrade} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Who would trade for him?' }));
    expect(onTrade).toHaveBeenCalledWith('p1');
    expect(onClose).toHaveBeenCalled();
  });

  it('asks what he would cost when he is somebody else’s', () => {
    render(
      <PlayerDetail
        detail={detail({ owner: { rosterId: 4, teamName: 'Rivals', mine: false } })}
        chartSeason={2025}
        onClose={() => {}}
        onTrade={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'What would he cost?' })).toBeInTheDocument();
  });

  it('offers nothing for a free agent, or where no trade can be built', () => {
    const { unmount } = render(
      <PlayerDetail
        detail={detail({ owner: null, starting: null })}
        chartSeason={2025}
        onClose={() => {}}
        onTrade={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: /would/ })).not.toBeInTheDocument();
    unmount();

    render(<PlayerDetail detail={detail()} chartSeason={2025} onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: /would/ })).not.toBeInTheDocument();
  });
});

describe('TradeSuggestions, built around one player (#165)', () => {
  it('says it is pricing his player, and offers the way back', async () => {
    const onClearPin = vi.fn();
    renderPanel({ pinnedPlayerId: 'p2', onClearPin });

    expect(
      screen.getByRole('heading', { level: 2, name: 'What Player p2 would cost' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Packages Team 2 would take for him, cheapest first/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Back to all trade ideas' }));
    expect(onClearPin).toHaveBeenCalled();
  });

  it('says who would trade for one of yours', () => {
    renderPanel({ pinnedPlayerId: 'p1' });
    expect(
      screen.getByRole('heading', { level: 2, name: 'Who would trade for Player p1' }),
    ).toBeInTheDocument();
  });

  it('is the open search when nothing is pinned', () => {
    renderPanel();
    expect(screen.getByRole('heading', { level: 2, name: 'Trade ideas' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back to all trade ideas' })).not.toBeInTheDocument();
  });
});
