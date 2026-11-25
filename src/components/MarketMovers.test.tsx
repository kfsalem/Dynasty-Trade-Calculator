import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MarketMovers } from './MarketMovers';
import { ValueHistoryChart } from './charts/ValueHistoryChart';
import { withClient } from '../test/harness';
import { summarizeRoster } from '../engine/rosterValue';
import { makeLeague, makePlayer, makeRoster, makeSettings, makeValue } from '../engine/testFixtures';
import type { Player, PlayerValue } from '../types';
import type { ValueHistoryFile } from '../values/valueHistory';

/**
 * The Market movers card (#158). What is ranked and why is covered in
 * `values/valueTrend`; these check what the card says about it, and that the
 * window it shows is the one the player panel shows.
 */

const DATES = ['2026-09-29', '2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03', '2026-11-10'];

/** A dynasty series ending at `to`, flat until the last week unless given in full. */
const series = (values: number[]) => values;

const HISTORY: ValueHistoryFile = {
  generatedAt: '2026-11-10T00:00:00.000Z',
  numQbs: 1,
  source: 'test',
  dates: DATES,
  players: {
    // Mine. Over the last week: +800, −1,400, +20. Over four weeks: +2,000, −1,400, +20.
    riser: ['QB', series([5000, 5000, 6000, 6400, 7000, 7200, 8000]), Array(7).fill(5000)],
    faller: ['WR', series([7400, 7400, 7400, 7400, 7400, 7400, 6000]), Array(7).fill(5000)],
    drifter: ['RB', series([3000, 3000, 3000, 3000, 3000, 3000, 3020]), Array(7).fill(2000)],
    // Theirs: the biggest gain in the league over the last week.
    rival: ['TE', series([2000, 2000, 2000, 2000, 2000, 2000, 3500]), Array(7).fill(1500)],
    // Unrostered, and quiet, so the typical move stays small.
    q1: ['RB', series([1000, 1000, 1000, 1000, 1000, 1000, 1000]), Array(7).fill(800)],
    q2: ['RB', series([1000, 1000, 1000, 1000, 1000, 1000, 1010]), Array(7).fill(800)],
    q3: ['WR', series([1000, 1000, 1000, 1000, 1000, 1000, 990]), Array(7).fill(800)],
  },
};

function world() {
  const settings = makeSettings(['QB', 'RB', 'WR', 'TE'], { teamCount: 2 });
  const players = new Map<string, Player>([
    ['riser', { ...makePlayer('riser', 'QB', 25), name: 'Riley Riser' }],
    ['faller', { ...makePlayer('faller', 'WR', 25), name: 'Fred Faller' }],
    ['drifter', { ...makePlayer('drifter', 'RB', 25), name: 'Dan Drifter' }],
    ['rival', { ...makePlayer('rival', 'TE', 25), name: 'Rex Rival' }],
  ]);
  const values = new Map<string, PlayerValue>(
    [...players.keys()].map((id) => [id, makeValue(id, 1000)]),
  );
  const rosters = [makeRoster(1, ['riser', 'faller', 'drifter']), makeRoster(2, ['rival'])];
  const league = makeLeague(rosters, settings);
  const summaries = rosters.map((r) => summarizeRoster(r, players, values, settings));
  return { league, summaries };
}

const respond = (body: unknown, ok = true) =>
  vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 404, json: async () => body });

const show = (extra?: React.ReactNode) => {
  const { league, summaries } = world();
  return render(
    <>
      <MarketMovers league={league} summaries={summaries} myRosterId={1} numQbs={1} />
      {extra}
    </>,
    { wrapper: withClient() },
  );
};

const list = (title: string) =>
  within(screen.getByRole('heading', { name: title }).parentElement as HTMLElement);

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('MarketMovers (#158)', () => {
  it('opens on four weeks of your own roster, saying which dates it covers', async () => {
    vi.stubGlobal('fetch', respond(HISTORY));
    show();

    expect(await screen.findByText(/on your roster, Oct 13 to Nov 10/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '4 weeks' })).toHaveAttribute('aria-pressed', 'true');
    expect(list('Rising').getByText('Riley Riser')).toBeInTheDocument();
    expect(list('Rising').getByText('+2,000')).toBeInTheDocument();
    expect(list('Rising').getByText('+33%')).toBeInTheDocument();
    expect(list('Rising').getByText('6,000 → 8,000')).toBeInTheDocument();
    expect(list('Falling').getByText('−1,400')).toBeInTheDocument();
    expect(list('Falling').getByText('−19%')).toBeInTheDocument();
    expect(screen.queryByText('Rex Rival')).not.toBeInTheDocument();
  });

  it('leaves out a drift no bigger than the typical move', async () => {
    vi.stubGlobal('fetch', respond(HISTORY));
    show();

    await screen.findByText('Riley Riser');
    expect(screen.queryByText('Dan Drifter')).not.toBeInTheDocument();
  });

  it('shows the whole league with each player’s team, yours named as yours', async () => {
    vi.stubGlobal('fetch', respond(HISTORY));
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'League' }));

    expect(screen.getByText(/in this league,/)).toBeInTheDocument();
    expect(list('Rising').getByText('Rex Rival')).toBeInTheDocument();
    expect(list('Rising').getByText(/Team 2 ·/)).toBeInTheDocument();
    expect(list('Rising').getByText(/Your team ·/)).toBeInTheDocument();
  });

  it('moves to the window picked: one week back is Nov 3', async () => {
    vi.stubGlobal('fetch', respond(HISTORY));
    show();
    await userEvent.click(await screen.findByRole('button', { name: '1 week' }));

    expect(screen.getByText(/on your roster, Nov 3 to Nov 10/)).toBeInTheDocument();
    expect(list('Rising').getByText('+800')).toBeInTheDocument();
    expect(list('Rising').getByText('7,200 → 8,000')).toBeInTheDocument();
  });

  it('says so when nobody moved more than the typical player over the window', async () => {
    const flat = (n: number) => Array<number>(7).fill(n);
    const quiet: ValueHistoryFile = {
      ...HISTORY,
      players: {
        ...HISTORY.players,
        riser: ['QB', flat(5000), flat(5000)],
        faller: ['WR', flat(7400), flat(5000)],
        // Over four weeks: 0, 0, 20 here; 1,500, 50, 50, 50 elsewhere — typical is 50.
        q1: ['RB', [1000, 1000, 1000, 1000, 1000, 1000, 1050], flat(800)],
        q2: ['RB', [1000, 1000, 1000, 1000, 1000, 1000, 950], flat(800)],
        q3: ['WR', [1000, 1000, 1000, 1000, 1000, 1000, 1050], flat(800)],
      },
    };
    vi.stubGlobal('fetch', respond(quiet));
    show();

    expect(
      await screen.findByText(
        'Nobody on your roster gained more than 50 points, the typical move over this span.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Nobody on your roster lost more than 50 points, the typical move over this span.'),
    ).toBeInTheDocument();
  });

  it('keeps the chosen window for the player panel, and for the next visit', async () => {
    vi.stubGlobal('fetch', respond(HISTORY));
    show(<ValueHistoryChart playerId="riser" position="QB" numQbs={1} />);
    const sinceButtons = await screen.findAllByRole('button', { name: 'Since Sep 29' });
    expect(sinceButtons).toHaveLength(2);

    await userEvent.click(screen.getAllByRole('button', { name: '1 week' })[0]);

    for (const button of screen.getAllByRole('button', { name: '1 week' })) {
      expect(button).toHaveAttribute('aria-pressed', 'true');
    }
    // The chart's sentence follows: 7,200 to 8,000 since Nov 3.
    expect(screen.getByText('up 11%')).toBeInTheDocument();
    expect(screen.getByText(/since Nov 3/)).toBeInTheDocument();
    expect(localStorage.getItem('dynasty:trendWindow')).toBe('week');
  });

  it('draws nothing when the history cannot be read', async () => {
    const fetch = respond(null, false);
    vi.stubGlobal('fetch', fetch);
    const { container } = show();

    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await vi.waitFor(() => expect(container.querySelector('.skeleton')).toBeNull());
    expect(container).toBeEmptyDOMElement();
  });
});
