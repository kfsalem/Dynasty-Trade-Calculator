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

describe('TradeBuilder — the state before there is a trade', () => {
  /**
   * Where a first-time user starts, and where a shared link whose assets have
   * all moved on lands. It was one grey sentence — "Select at least one asset
   * to evaluate a trade" — which spent the only moment anyone reads this tab
   * restating the obvious instead of explaining the two columns of numbers
   * sitting above it.
   */
  it('says what the tab is for, not just what to press', async () => {
    const user = userEvent.setup();
    renderBuilder(0);

    await user.click(screen.getByRole('button', { name: 'Clear' }));

    expect(screen.getByText('Nothing on the table yet')).toBeInTheDocument();
    expect(screen.getByText(/priced twice/)).toBeInTheDocument();
  });

  it('shows the verdict again as soon as something is selected', async () => {
    const user = userEvent.setup();
    renderBuilder(0);
    await user.click(screen.getByRole('button', { name: 'Clear' }));

    await user.click(screen.getByRole('checkbox', { name: /Player p1/ }));

    expect(screen.queryByText('Nothing on the table yet')).not.toBeInTheDocument();
  });
});

/**
 * The phone layout (#18). Only one side's picker is laid out below `md`, so the
 * switch is the only way to reach the other team — which makes it part of the
 * flow rather than decoration, and worth holding still.
 *
 * These assert wiring, not visibility: jsdom applies no Tailwind, so `hidden`
 * is a class and not a computed style, and a test claiming the other picker is
 * invisible here would be claiming something it cannot see.
 */
describe('TradeBuilder — the phone side switch', () => {
  it('offers both teams with what each is sending', () => {
    renderBuilder(0);

    const [a, b] = screen.getAllByRole('button', { name: /sends/ });
    expect(a).toHaveTextContent('Team 1');
    expect(b).toHaveTextContent('Team 2');
    // Both totals stay on the control, so switching is a choice made with the
    // other side's number in hand rather than from memory.
    expect(a).toHaveTextContent(/sends\s*900/);
  });

  it('starts on the left side and moves on a press', async () => {
    const user = userEvent.setup();
    renderBuilder(0);

    const [a, b] = screen.getAllByRole('button', { name: /sends/ });
    expect(a).toHaveAttribute('aria-pressed', 'true');
    expect(b).toHaveAttribute('aria-pressed', 'false');

    await user.click(b);

    expect(a).toHaveAttribute('aria-pressed', 'false');
    expect(b).toHaveAttribute('aria-pressed', 'true');
  });

  /**
   * `aria-pressed` on plain buttons rather than a tablist: declaring `role="tab"`
   * promises arrow-key navigation, and the app already has one real tablist that
   * honours that contract. A second, fake one would teach a keyboard behaviour
   * that does not exist here.
   */
  it('does not claim to be a second tablist', () => {
    renderBuilder(0);
    // The only tablist in the app is the one in `App`, which is not rendered here.
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });
});

describe('TradeBuilder — the pinned verdict', () => {
  it('says the verdict and your side of it in one label', () => {
    renderBuilder(0);

    // Roster 1 is the claimed team, so the bar reports from its perspective.
    const bar = screen.getByRole('button', { name: /Jump to the full verdict/ });
    expect(bar).toHaveAccessibleName(/Team 1 nets/);
  });

  it('is not there when there is no trade to summarise', async () => {
    const user = userEvent.setup();
    renderBuilder(0);
    await user.click(screen.getByRole('button', { name: 'Clear' }));

    expect(
      screen.queryByRole('button', { name: /Jump to the full verdict/ }),
    ).not.toBeInTheDocument();
  });
});

describe('TradeBuilder — motion that explains', () => {
  /**
   * The running total sits pinned above a list that scrolls inside a 24rem
   * box, so on a real roster the checkbox and the number it moves can be a
   * screen apart. This asserts the wiring only — whether the highlight is
   * *drawn* is `.flash-change`'s business, and whether it is drawn at all is
   * `prefers-reduced-motion`'s.
   */
  it('marks the running total that a tick just moved', async () => {
    const user = userEvent.setup();
    renderBuilder(0);

    const total = screen.getAllByText(/Sending away/)[0].querySelector('span')!;
    expect(total.className).not.toContain('flash-change');

    await user.click(screen.getByRole('checkbox', { name: /Player p2/ }));

    expect(total.className).toContain('flash-change');
  });

  /**
   * The rule that keeps the flash meaningful: it marks a change, never an
   * arrival. Every figure on a freshly mounted panel is "new", and lighting
   * them all up on mount is how a highlight stops being read.
   */
  it('does not flash the totals that were there when the panel mounted', () => {
    renderBuilder(0);

    const total = screen.getAllByText(/Sending away/)[0].querySelector('span')!;
    expect(total.className).not.toContain('flash-change');
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

describe('TradeBuilder — a league that forbids pick trading', () => {
  /**
   * Two reasons the pick columns can be empty, and they call for opposite
   * reactions. "Unavailable right now" invites the reader to wait and try
   * again; a league rule will never change, and saying the first about the
   * second sends someone back to a page that will look identical tomorrow.
   */
  const noPickTrading = () =>
    render(
      <TradeBuilder
        league={{
          ...league,
          settings: makeSettings(['QB', 'RB'], {
            draftRounds: 1,
            teamCount: 3,
            pickTrading: false,
          }),
        }}
        players={players}
        values={values}
        picks={[]}
        // The outage flag is set too, and must lose: the rule is the true and
        // more useful statement, and printing both would contradict itself.
        picksUnavailable
        myRosterId={1}
        initial={initial}
        priced={priced}
      />,
    );

  it('names the rule rather than reporting an outage', () => {
    noPickTrading();

    expect(screen.getByText(/pick trading switched off/)).toBeInTheDocument();
    expect(screen.queryByText(/unavailable right now/i)).not.toBeInTheDocument();
  });

  it('still reports a genuine outage in a league that does allow picks', () => {
    render(
      <TradeBuilder
        league={league}
        players={players}
        values={values}
        picks={[]}
        picksUnavailable
        myRosterId={1}
        initial={initial}
        priced={priced}
      />,
    );

    expect(screen.getByText(/unavailable right now/i)).toBeInTheDocument();
    expect(screen.queryByText(/pick trading switched off/)).not.toBeInTheDocument();
  });
});
