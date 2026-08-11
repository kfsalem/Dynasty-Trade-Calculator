import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Position } from '../../types';
import type { PositionScarcity } from '../../engine/replacement';
import type { LeagueContention, PositionalStrength } from '../../engine/analysis';
import { ContentionScatter } from './ContentionScatter';
import { PositionalStrengthChart } from './PositionalStrengthChart';
import { ScarcityChart } from './ScarcityChart';

/**
 * The contract every chart in this app signs, asserted once per chart.
 *
 * These are #16's acceptance criteria turned into tests rather than intentions:
 * a table view that reaches every value without hovering, marks that keyboard
 * focus can land on, and identity that never rests on colour alone. The visual
 * result is a matter of taste and is checked by looking at it; these three are
 * not, and a regression in any of them is a bug rather than a preference.
 */

const contention: LeagueContention = {
  nowMedian: 1000,
  retainedMedian: 0.9,
  points: [
    { rosterId: 1, nowScore: 1400, retainedShare: 1.1, quadrant: 'juggernaut' },
    { rosterId: 2, nowScore: 1200, retainedShare: 0.7, quadrant: 'win_now' },
    { rosterId: 3, nowScore: 800, retainedShare: 1.3, quadrant: 'rebuilding' },
    { rosterId: 4, nowScore: 600, retainedShare: 0.5, quadrant: 'danger' },
  ],
};

const teamNames = new Map([
  [1, 'Dire Wolves'],
  [2, 'Kings Landing'],
  [3, 'Winterfell'],
  [4, 'Castle Black'],
]);

const positions: PositionalStrength[] = [
  { position: 'QB', starterValue: 1500, leagueMedian: 1000, z: 1.4, verdict: 'strength' },
  { position: 'RB', starterValue: 700, leagueMedian: 1000, z: -1.2, verdict: 'weakness' },
  { position: 'WR', starterValue: 1010, leagueMedian: 1000, z: 0.1, verdict: 'neutral' },
  { position: 'TE', starterValue: 400, leagueMedian: 420, z: -0.2, verdict: 'neutral' },
];

const scarcityRow = (position: Position, retained: number, winNow: number): PositionScarcity => ({
  position,
  startersNeeded: 10,
  value: 2000,
  winNow: 300,
  topMarket: 9000,
  topRedraft: 800,
  retained,
  retainedWinNow: winNow,
});

const scarcity: Partial<Record<Position, PositionScarcity>> = {
  QB: scarcityRow('QB', 0.45, 0.6),
  RB: scarcityRow('RB', 0.82, 0.71),
  WR: scarcityRow('WR', 0.66, 0.58),
  TE: scarcityRow('TE', 0.7, 0.4),
};

describe('the table view reaches every value without a pointer', () => {
  it('lists every team in the scatter', async () => {
    render(<ContentionScatter contention={contention} teamNames={teamNames} myRosterId={2} />);

    await userEvent.click(screen.getByText('Show the numbers'));
    const table = screen.getByRole('table');

    for (const name of teamNames.values()) {
      expect(within(table).getByText(new RegExp(name))).toBeInTheDocument();
    }
    // The verdict is in the table too, so the corner labels are not the only
    // place a quadrant is named.
    expect(within(table).getByText('Danger zone')).toBeInTheDocument();
    // And your own team is marked in it, not only by the highlighted dot.
    expect(within(table).getByText(/Kings Landing \(you\)/)).toBeInTheDocument();
  });

  it('gives the diverging bar a signed difference rather than colour alone', async () => {
    render(<PositionalStrengthChart positions={positions} />);

    await userEvent.click(screen.getByText('Show the numbers'));
    const table = screen.getByRole('table');

    // The sign is the encoding that survives a monochrome screen.
    expect(within(table).getByText('+500')).toBeInTheDocument();
    expect(within(table).getByText('−300')).toBeInTheDocument();
    expect(within(table).getByText('Weakness')).toBeInTheDocument();
    expect(within(table).getByText('Strength')).toBeInTheDocument();
  });

  it('carries both scales for every position in the scarcity table', async () => {
    render(<ScarcityChart scarcity={scarcity} teamCount={10} />);

    await userEvent.click(screen.getByText('Show the numbers'));
    const table = screen.getByRole('table');

    expect(within(table).getByText('82%')).toBeInTheDocument();
    expect(within(table).getByText('71%')).toBeInTheDocument();
  });
});

describe('marks are reachable and announced', () => {
  it('makes every point in the scatter focusable and labelled', () => {
    render(<ContentionScatter contention={contention} teamNames={teamNames} myRosterId={2} />);

    const marks = screen
      .getAllByRole('img')
      .filter((mark) => mark.getAttribute('tabindex') === '0');
    expect(marks).toHaveLength(contention.points.length);

    // The label carries the same three facts the tooltip shows, which is what
    // lets the tooltip stay aria-hidden.
    const mine = screen.getByLabelText(/Kings Landing, your team/);
    expect(mine).toHaveAttribute('aria-label', expect.stringContaining('1,200'));
    expect(mine).toHaveAttribute('aria-label', expect.stringContaining('Window closing'));
  });

  it('labels a bar with its verdict, not just its value', () => {
    render(<PositionalStrengthChart positions={positions} />);

    expect(screen.getByLabelText(/^RB:/)).toHaveAttribute(
      'aria-label',
      expect.stringContaining('Weakness'),
    );
    expect(screen.getByLabelText(/^RB:/)).toHaveAttribute(
      'aria-label',
      expect.stringContaining('below the league median'),
    );
  });

  it('keeps the position letters on every coloured mark', () => {
    // The light-mode position palette clears the validator only "with visible
    // labels or a table view" — the letters are what make the hue legal, so a
    // chart may never render the colour without them.
    const { container } = render(<ScarcityChart scarcity={scarcity} teamCount={10} />);
    const chipText = [...container.querySelectorAll('svg text')].map((node) => node.textContent);

    for (const position of ['QB', 'RB', 'WR', 'TE']) {
      expect(chipText).toContain(position);
    }
  });
});

describe('the two-series chart declares its encoding', () => {
  it('legends the scarcity pair, because fill-versus-outline is not self-evident', () => {
    render(<ScarcityChart scarcity={scarcity} teamCount={10} />);

    expect(screen.getByText(/Dynasty — what he is worth to hold/)).toBeInTheDocument();
    expect(screen.getByText(/Win-now — what he is worth this season/)).toBeInTheDocument();
  });

  it('gives a single-series chart no legend box', () => {
    // The title already names what is plotted; a one-swatch legend restates it.
    render(<PositionalStrengthChart positions={positions} />);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});

describe('degenerate leagues', () => {
  it('draws a one-team league without dividing by zero', () => {
    const alone: LeagueContention = {
      nowMedian: 900,
      retainedMedian: 1,
      points: [{ rosterId: 1, nowScore: 900, retainedShare: 1, quadrant: 'juggernaut' }],
    };

    render(
      <ContentionScatter contention={alone} teamNames={new Map([[1, 'Solo']])} myRosterId={1} />,
    );

    // A single point has no extent on either axis; the plot still has to exist
    // and the dot still has to land inside it.
    const dot = screen.getByLabelText(/Solo, your team/);
    expect(dot).toBeInTheDocument();
    for (const circle of dot.querySelectorAll('circle')) {
      expect(Number(circle.getAttribute('cx'))).toBeGreaterThan(0);
      expect(Number.isFinite(Number(circle.getAttribute('cy')))).toBe(true);
    }
  });

  it('renders nothing rather than an empty frame when no position has a market', () => {
    expect(
      render(<ScarcityChart scarcity={{}} teamCount={10} />).container.firstChild,
    ).toBeNull();
  });
});
