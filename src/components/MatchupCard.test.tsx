import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MatchupCard } from './MatchupCard';
import type { MatchupOdds, MatchupSide } from '../engine/matchup';

const side = (expected: number): MatchupSide =>
  ({ rosterId: 1, expected, scored: 0, projectedBefore: expected, projectedLeft: expected }) as MatchupSide;

const odds: MatchupOdds = {
  me: side(130),
  them: side(120),
  chance: 0.6,
  asSet: { expected: 110, chance: 0.69 },
  themUnset: false,
  underway: false,
  final: false,
};

describe('MatchupCard', () => {
  it('names the week, the verdict and the chance, with the opponent’s set lineup', () => {
    render(<MatchupCard odds={odds} week={7} opponent="Gridiron Gang" bestBall={false} />);

    expect(screen.getByRole('region', { name: 'Week 7 matchup' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: "You're favoured against Gridiron Gang" })).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(screen.getByText('Projected 130.0 to 120.0.')).toBeInTheDocument();
    expect(screen.getByText(/as set projects 110\.0/)).toBeInTheDocument();
    expect(screen.getByText('Why?')).toBeInTheDocument();
  });

  it('drops the chance and the reasoning once the week is final', () => {
    render(
      <MatchupCard odds={{ ...odds, final: true, underway: true }} week={7} opponent="GG" bestBall={false} />,
    );

    expect(screen.getByText('Final')).toBeInTheDocument();
    expect(screen.queryByText('to win')).not.toBeInTheDocument();
    expect(screen.queryByText('Why?')).not.toBeInTheDocument();
  });
});
