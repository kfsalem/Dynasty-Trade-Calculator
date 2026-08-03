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
import { DEFAULT_MODEL, type OddsContext } from '../engine/playoffOdds';

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

function renderBuilder(droppedFromLink?: number, odds?: OddsContext) {
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
      odds={odds}
      priced={priced}
    />,
  );
}

/**
 * A league with games left to play.
 *
 * Roster 1 is far and away the strongest, roster 2 the weakest, so a trade that
 * moves lineup strength between them has to move the odds — which is the whole
 * assertion. Iterations are turned down because these tests run on the main
 * thread: jsdom has no `Worker`, so `usePlayoffOdds` falls back to running the
 * simulation inline.
 */
const oddsContext: OddsContext = {
  teams: [
    { rosterId: 1, wins: 3, losses: 3, ties: 0, pointsFor: 900, strength: 2000 },
    { rosterId: 2, wins: 3, losses: 3, ties: 0, pointsFor: 900, strength: 600 },
    { rosterId: 3, wins: 3, losses: 3, ties: 0, pointsFor: 900, strength: 1300 },
  ],
  remaining: [
    { week: 7, rosterIds: [1, 2], points: null },
    { week: 8, rosterIds: [2, 3], points: null },
    { week: 9, rosterIds: [1, 3], points: null },
  ],
  playoffTeams: 2,
  model: DEFAULT_MODEL,
};

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

  it('says nothing about the playoffs when there is no schedule to simulate', async () => {
    // A league whose provider cannot supply a schedule renders exactly as it
    // did before the feature existed, rather than showing an empty row.
    renderBuilder(0);
    expect(await screen.findByText('Trade calculator')).toBeInTheDocument();
    expect(screen.queryByText('Playoff odds')).not.toBeInTheDocument();
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

describe('TradeBuilder — playoff odds', () => {
  it('shows each side its odds before and after the trade', async () => {
    renderBuilder(0, oddsContext);

    const rows = await screen.findAllByText('Playoff odds');
    // One per side of the trade, and only for the two teams involved.
    expect(rows).toHaveLength(2);
  });

  it('reads as a before-and-after, not a single number', async () => {
    renderBuilder(0, oddsContext);

    const rows = await screen.findAllByText('Playoff odds');
    const cell = rows[0].parentElement!.querySelector('dd')!;
    expect(cell.textContent).toMatch(/\d+%\s*→\s*\d+%/);
  });

  it('raises the odds of the side whose lineup the trade improves', async () => {
    // Roster 1 sends p1 and gets p3 back, and p1 is worth more — so roster 2 is
    // the side that gains, and its odds have to move up. This is the assertion
    // the whole feature exists for: a value the manager can act on.
    renderBuilder(0, oddsContext);
    await screen.findAllByText('Playoff odds');

    // By heading: the team name also appears in each side's roster dropdown.
    const gained = screen
      .getByRole('heading', { name: 'Team 2', level: 4 })
      .closest('div')!;
    const cell = within(gained).getByText('Playoff odds').parentElement!.querySelector('dd')!;

    const [before, after] = [...cell.textContent!.matchAll(/(\d+)%/g)].map((m) => Number(m[1]));
    expect(after).toBeGreaterThan(before);
  });

  it('is deterministic — the same trade renders the same odds twice', async () => {
    const first = renderBuilder(0, oddsContext);
    await screen.findAllByText('Playoff odds');
    const one = screen.getAllByText('Playoff odds').map(
      (row) => row.parentElement!.querySelector('dd')!.textContent,
    );
    first.unmount();

    renderBuilder(0, oddsContext);
    await screen.findAllByText('Playoff odds');
    const two = screen.getAllByText('Playoff odds').map(
      (row) => row.parentElement!.querySelector('dd')!.textContent,
    );

    expect(two).toEqual(one);
  });
});
