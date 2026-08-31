import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BenchPoints } from './BenchPoints';
import type { BenchManager, BenchReport } from '../engine/benchPoints';

const manager = (over: Partial<BenchManager> = {}): BenchManager => ({
  userId: 'u1',
  name: 'Ann',
  weeks: 28,
  perWeek: 24.2,
  seasons: [
    { season: '2025', weeks: 14, scored: 1400, potential: 1750, gap: 350, perWeek: 25 },
    { season: '2024', weeks: 14, scored: 1400, potential: 1727, gap: 327, perWeek: 23.4 },
  ],
  worst: {
    season: '2025',
    week: 3,
    scored: 96,
    potential: 144.3,
    gap: 48.3,
    costliest: { playerId: 'p9', name: 'Puka Nacua', points: 31.4 },
  },
  ...over,
});

const report = (over: Partial<BenchReport> = {}): BenchReport => ({
  managers: [manager({ userId: 'u2', name: 'Bo', perWeek: 18 }), manager()],
  leaguePerWeek: 21.1,
  weeks: 56,
  seasons: ['2025', '2024'],
  fidelity: { compared: 20, exact: 15, error: 0.0012, verdict: 'close' },
  ...over,
});

const props = {
  report: report(),
  loading: false,
  failed: false,
  truncated: false,
  userId: 'u1',
  bestBall: false,
};

describe('BenchPoints', () => {
  it('states the figure, the league it is measured against, and the standing', () => {
    render(<BenchPoints {...props} />);

    expect(screen.getByText(/You leave 24.2 points a week on your bench/)).toBeInTheDocument();
    expect(screen.getByText(/The league average is 21.1/)).toBeInTheDocument();
    expect(screen.getByText(/Every other manager leaves less/)).toBeInTheDocument();
  });

  /**
   * The comparison is the whole of the tone. Every manager in every league
   * leaves points on his bench; without the league's own figure beside it the
   * panel is an accusation rather than a measurement.
   */
  it('never shows the figure without what the league leaves', () => {
    render(<BenchPoints {...props} />);
    expect(screen.getByText(/league average/i)).toBeInTheDocument();
  });

  it('breaks the figure down by season', () => {
    render(<BenchPoints {...props} />);

    expect(screen.getByText('2025')).toBeInTheDocument();
    expect(screen.getByText('2024')).toBeInTheDocument();
    expect(screen.getByText('25.0')).toBeInTheDocument();
    expect(screen.getByText('23.4')).toBeInTheDocument();
  });

  it('names the man who sat through the worst week', () => {
    render(<BenchPoints {...props} />);
    expect(
      screen.getByText(/Week 3 of 2025: 48.3 points left behind, with Puka Nacua scoring 31.4/),
    ).toBeInTheDocument();
  });

  it('shows how many weeks the figure rests on, and the outside check', () => {
    render(<BenchPoints {...props} />);

    expect(screen.getByText(/From 28 weeks across two seasons/)).toBeInTheDocument();
    expect(screen.getByText(/Checked against Sleeper's own potential-points totals/)).toBeInTheDocument();
  });

  /**
   * Best ball scores every roster's optimal lineup automatically, so there is
   * no bench to leave anything on. The lineup panel already explains that;
   * saying it twice on one tab is worse than saying it once.
   */
  it('renders nothing at all in a best ball league', () => {
    const { container } = render(<BenchPoints {...props} bestBall />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing before a history has been asked for', () => {
    const { container } = render(<BenchPoints {...props} report={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('holds its place while the history loads', () => {
    const { container } = render(
      <BenchPoints {...props} report={undefined} loading />,
    );

    expect(screen.getByText(/Points left on the bench/)).toBeInTheDocument();
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
  });

  it('says a failure costs this panel and nothing else', () => {
    render(<BenchPoints {...props} report={undefined} failed />);
    expect(screen.getByText(/past seasons didn't load/)).toBeInTheDocument();
    expect(screen.getByText(/Everything else on this page is unaffected/)).toBeInTheDocument();
  });

  it('explains itself in a league that has not finished a week', () => {
    render(<BenchPoints {...props} report={report({ weeks: 0, managers: [], seasons: [] })} />);
    expect(screen.getByText(/hasn't finished a week/)).toBeInTheDocument();
  });

  /**
   * A team claimed in its first season. The league has a history and none of it
   * is his, which is a different sentence from the league having none.
   */
  it('tells a new manager what the rest of the league leaves', () => {
    render(<BenchPoints {...props} userId="nobody" />);
    expect(screen.getByText(/Your first week in this league hasn't been played/)).toBeInTheDocument();
    expect(screen.getByText(/21.1 points a week/)).toBeInTheDocument();
  });

  it('says why an unowned team has no history to show', () => {
    render(<BenchPoints {...props} userId={null} />);
    expect(screen.getByText(/no manager on Sleeper/)).toBeInTheDocument();
  });

  it('does not claim a span it could not read', () => {
    render(<BenchPoints {...props} truncated />);
    expect(screen.getByText(/as far back as Sleeper still publishes/)).toBeInTheDocument();
  });

  /**
   * One week is not a rate. Stating it as one would put a number on screen that
   * a single Sunday cannot support.
   */
  it('does not turn a single week into a weekly average', () => {
    render(
      <BenchPoints
        {...props}
        report={report({
          managers: [
            manager({
              weeks: 1,
              perWeek: 31.2,
              seasons: [
                { season: '2025', weeks: 1, scored: 96, potential: 127.2, gap: 31.2, perWeek: 31.2 },
              ],
            }),
          ],
        })}
      />,
    );

    expect(screen.getByText(/You left 31.2 points on your bench/)).toBeInTheDocument();
  });
});
