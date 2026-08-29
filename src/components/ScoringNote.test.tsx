import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScoringNote } from './ScoringNote';
import { LeagueHeader } from './LeagueHeader';
import { makeLeague, makeRoster, makeSettings } from '../engine/testFixtures';
import type { ScoringFidelity } from '../engine/scoringCheck';

const fidelity = (over: Partial<ScoringFidelity> = {}): ScoringFidelity => ({
  compared: 1200,
  exact: 1200,
  error: 0,
  unreachable: [],
  unknown: [],
  verdict: 'exact',
  ...over,
});

describe('ScoringNote', () => {
  it('says nothing at all when there is nothing to report', () => {
    // A league whose rules the engine reproduces and whose season has not
    // started yet. Both "checked 0 of 0" and a claim of success would be worse
    // than silence.
    const { container } = render(
      <ScoringNote fidelity={fidelity({ verdict: 'unchecked', compared: 0, exact: 0 })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing before the fidelity has been computed', () => {
    const { container } = render(<ScoringNote fidelity={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the evidence when it reproduces the league exactly', () => {
    render(<ScoringNote fidelity={fidelity()} />);
    expect(
      screen.getByText(/1,200 of 1,200 player-weeks match Sleeper's own totals exactly/),
    ).toBeInTheDocument();
  });

  /**
   * Sleeper's key names are identifiers, not English. A manager reading
   * "rec_td_50p" learns nothing; "50+ yard receiving touchdowns" tells him
   * exactly what his league pays for that this app is not counting.
   */
  it('names what it cannot count, in words rather than rule keys', () => {
    render(
      <ScoringNote
        fidelity={fidelity({ verdict: 'close', exact: 1150, unreachable: ['rec_td_50p'] })}
      />,
    );

    expect(screen.getByText(/50\+ yard receiving touchdowns/)).toBeInTheDocument();
    expect(screen.queryByText(/rec_td_50p/)).not.toBeInTheDocument();
  });

  it('says one thing once when five rule keys describe one idea', () => {
    render(
      <ScoringNote
        fidelity={fidelity({
          verdict: 'close',
          exact: 1100,
          unreachable: ['rec_0_4', 'rec_5_9', 'rec_10_19', 'rec_20_29', 'rec_30_39'],
        })}
      />,
    );

    expect(screen.getAllByText(/receptions by length/)).toHaveLength(1);
  });

  it('says which numbers it fell back to when it cannot reproduce the league', () => {
    render(<ScoringNote fidelity={fidelity({ verdict: 'unreliable', exact: 300 })} />);

    expect(screen.getByText(/priced off market rankings/)).toBeInTheDocument();
  });
});

describe('LeagueHeader — scoring badges', () => {
  const header = (scoring: Record<string, number>) => {
    const settings = makeSettings(['QB', 'RB'], { scoring, ppr: scoring.rec ?? 0 });
    return render(
      <LeagueHeader
        league={makeLeague([makeRoster(1, [])], settings)}
        onReset={() => {}}
      />,
    );
  };

  /**
   * The contract that makes every field above safe to add: a plain PPR league
   * looks exactly as it did before the app could read a rulebook at all.
   */
  it('adds nothing to a vanilla PPR league', () => {
    header({ rec: 1, pass_td: 4, rec_td: 6, rush_td: 6 });

    expect(screen.getByText('PPR')).toBeInTheDocument();
    expect(screen.queryByText(/premium/)).not.toBeInTheDocument();
    expect(screen.queryByText(/pass TD/)).not.toBeInTheDocument();
  });

  it('says TE premium out loud, which "PPR" was hiding', () => {
    header({ rec: 1, bonus_rec_te: 0.5, pass_td: 6 });

    expect(screen.getByText('TE premium +0.5')).toBeInTheDocument();
    expect(screen.getByText('6-pt pass TD')).toBeInTheDocument();
  });

  it('stays quiet about a rule set to the platform default', () => {
    // Four-point passing touchdowns are what everyone assumes; a badge for the
    // default would be noise on every league in the world.
    header({ rec: 1, pass_td: 4 });
    expect(screen.queryByText(/pass TD/)).not.toBeInTheDocument();
  });
});
