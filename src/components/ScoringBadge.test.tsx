import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScoringBadge } from './ScoringBadge';
import type { ScoringFidelity } from '../engine/scoringCheck';

const fidelity = (over: Partial<ScoringFidelity> = {}): ScoringFidelity => ({
  compared: 356,
  exact: 342,
  error: 0.001,
  unreachable: ['rec_td_50p'],
  unknown: [],
  verdict: 'close',
  ...over,
});

/**
 * The scoring note moved from a paragraph over every tab into this badge
 * (#120). What must survive the move: the verdict stays visible, the evidence
 * stays reachable, a failed check stays loud, and there is no badge at all
 * when the note has nothing to say.
 */
describe('ScoringBadge', () => {
  it('names the verdict and opens onto the full note', async () => {
    render(<ScoringBadge fidelity={fidelity()} />);

    const pill = screen.getByLabelText(/Scoring checked · 342 of 356 weeks exact/);
    await userEvent.click(pill);

    expect(screen.getByText(/50\+ yard receiving touchdowns/)).toBeVisible();
  });

  it('marks a check that failed as a warning', () => {
    render(<ScoringBadge fidelity={fidelity({ verdict: 'unreliable', exact: 12 })} />);

    const pill = screen.getByLabelText(/Scoring can't be reproduced/);
    expect(pill.className).toMatch(/text-caution/);
  });

  it('renders nothing when the note would say nothing', () => {
    const { container } = render(
      <ScoringBadge
        fidelity={fidelity({ verdict: 'unchecked', compared: 0, exact: 0, unreachable: [] })}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
