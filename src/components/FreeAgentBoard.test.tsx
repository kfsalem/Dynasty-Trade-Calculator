import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FreeAgentBoard } from './FreeAgentBoard';
import type { FreeAgent, FreeAgentBoard as Board } from '../engine/freeAgents';
import { makePlayer, makeValue } from '../engine/testFixtures';
import type { Position } from '../types';

function agent(
  id: string,
  position: Position,
  value: number | null,
  team = 'KC',
): FreeAgent {
  return {
    player: { ...makePlayer(id, position), name: id, team },
    value: value === null ? null : makeValue(id, value, position),
    snaps: undefined,
    usage: undefined,
    adjustment: undefined,
  };
}

const priced = [agent('Priced WR', 'WR', 900), agent('Priced RB', 'RB', 400, 'BUF')];
const unpriced = [agent('Fringe WR', 'WR', null), agent('Some Kicker', 'K', null)];
const board: Board = { priced, unpriced, all: [...priced, ...unpriced] };

const view = (overrides: Partial<Parameters<typeof FreeAgentBoard>[0]> = {}) =>
  render(
    <FreeAgentBoard
      board={board}
      activityCurrent
      priced={new Set<Position>(['QB', 'RB', 'WR', 'TE'])}
      {...overrides}
    />,
  );

describe('FreeAgentBoard', () => {
  it('keeps the priced and the unpriced in separate blocks', () => {
    view();

    // One ranked list would mean inventing a number for the players nobody
    // prices, which is the thing #10 exists to refuse.
    const market = screen.getByRole('heading', { name: /priced by the market/i });
    const none = screen.getByRole('heading', { name: /no published price/i });
    expect(market).toBeInTheDocument();
    expect(none).toBeInTheDocument();
  });

  it('never renders an unpriced player as zero', () => {
    view();

    const block = screen
      .getByRole('heading', { name: /no published price/i })
      .closest('section') as HTMLElement;

    expect(within(block).queryByText('0')).not.toBeInTheDocument();
    // A fringe player is worth about nothing; a kicker has no market at all.
    expect(within(block).getByText('~0')).toBeInTheDocument();
    expect(within(block).getByText('no market')).toBeInTheDocument();
  });

  it('filters by position', async () => {
    const user = userEvent.setup();
    view();

    await user.click(screen.getByRole('radio', { name: 'RB' }));

    expect(screen.getByText('Priced RB')).toBeInTheDocument();
    expect(screen.queryByText('Priced WR')).not.toBeInTheDocument();
    expect(screen.queryByText('Fringe WR')).not.toBeInTheDocument();
  });

  it('searches by name and by team', async () => {
    const user = userEvent.setup();
    view();

    const search = screen.getByRole('searchbox');
    await user.type(search, 'fringe');
    expect(screen.getByText('Fringe WR')).toBeInTheDocument();
    expect(screen.queryByText('Priced WR')).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'buf');
    expect(screen.getByText('Priced RB')).toBeInTheDocument();
    expect(screen.queryByText('Priced WR')).not.toBeInTheDocument();
  });

  it('says so when nothing matches, rather than showing empty blocks', async () => {
    const user = userEvent.setup();
    view();

    await user.type(screen.getByRole('searchbox'), 'nobody at all');

    expect(screen.getByText('Nobody matches')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /priced by the market/i }),
    ).not.toBeInTheDocument();
  });

  it('labels the season the playing time comes from when it is not this one', () => {
    view({
      activityCurrent: false,
      snapsMeta: { season: 2025, throughWeek: 18, chartSeason: 2026 },
    });

    // The unpriced block is *ordered* by this data, so a reader who assumes it
    // describes the season being played is misled by the ranking itself.
    expect(screen.getByText(/2025 season/)).toBeInTheDocument();
    expect(screen.getByText(/not this season/)).toBeInTheDocument();
  });

  it('stays quiet about the season when the data is current', () => {
    view({ snapsMeta: { season: 2026, throughWeek: 3, chartSeason: 2026 } });

    expect(screen.queryByText(/not this season/)).not.toBeInTheDocument();
  });
});
