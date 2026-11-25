import { describe, expect, it } from 'vitest';
import {
  marketMovers,
  pickWindow,
  priceMove,
  trendWindows,
  typicalMove,
  type TrendWindow,
} from './valueTrend';
import type { ValueHistoryFile } from './valueHistory';

const WEEKLY = [
  '2026-09-29',
  '2026-10-06',
  '2026-10-13',
  '2026-10-20',
  '2026-10-27',
  '2026-11-03',
  '2026-11-10',
];

const history = (dates: string[], players: ValueHistoryFile['players']): ValueHistoryFile => ({
  generatedAt: '',
  numQbs: 1,
  source: 'test',
  dates,
  players,
});

const flat = (n: number, value: number) => Array<number>(n).fill(value);

describe('trendWindows (#158)', () => {
  it('lands a week and four weeks exactly on weekly points, and adds the whole history', () => {
    const windows = trendWindows(WEEKLY);
    expect(windows.map((w) => [w.key, w.start, w.days])).toEqual([
      ['week', '2026-11-03', 7],
      ['month', '2026-10-13', 28],
      ['all', '2026-09-29', 42],
    ]);
    expect(windows.every((w) => w.end === '2026-11-10' && w.endIndex === 6)).toBe(true);
  });

  it('takes the older of two points equally near, so a window is not shorter than its name', () => {
    const windows = trendWindows(['2026-10-01', '2026-11-01', '2026-11-03', '2026-11-09']);
    // Nov 1 and Nov 3 are 8 and 6 days back: one day either side of a week.
    expect(windows.find((w) => w.key === 'week')?.start).toBe('2026-11-01');
  });

  it('leaves out a window the points cannot honestly fill, rather than mislabel it', () => {
    // Out of season the points are a month apart: no point sits near a week back.
    const windows = trendWindows(['2026-02-10', '2026-03-10', '2026-04-10']);
    expect(windows.map((w) => w.key)).toEqual(['month', 'all']);
    expect(windows[0].start).toBe('2026-03-10');
  });

  it('does not call two weeks of history four weeks', () => {
    const windows = trendWindows(['2026-10-27', '2026-11-03', '2026-11-10']);
    expect(windows.map((w) => [w.key, w.start])).toEqual([
      ['week', '2026-11-03'],
      ['all', '2026-10-27'],
    ]);
  });

  it('keeps one window when two would start at the same point', () => {
    // Four weeks back is the first point, so "since the start" says nothing new.
    const windows = trendWindows(WEEKLY.slice(2));
    expect(windows.map((w) => [w.key, w.start])).toEqual([
      ['week', '2026-11-03'],
      ['month', '2026-10-13'],
    ]);
  });

  it('has no window with fewer than two points', () => {
    expect(trendWindows([])).toEqual([]);
    expect(trendWindows(['2026-11-10'])).toEqual([]);
  });
});

describe('pickWindow', () => {
  const windows = trendWindows(['2026-02-10', '2026-03-10', '2026-04-10']);

  it('honours a preference the history has', () => {
    expect(pickWindow(windows, 'all')?.key).toBe('all');
  });

  it('falls back to four weeks when the preference is missing', () => {
    expect(pickWindow(windows, 'week')?.key).toBe('month');
  });

  it('falls back to the longest window when four weeks is missing too', () => {
    const short = trendWindows(['2026-11-03', '2026-11-10']);
    expect(pickWindow(short, 'month')?.key).toBe('week');
  });

  it('is null with no window', () => {
    expect(pickWindow([], 'week')).toBeNull();
  });
});

describe('priceMove', () => {
  const h = history(WEEKLY, {
    steady: ['RB', [5000, 5100, 5200, 5300, 5400, 5500, 6000], flat(7, 0)],
    late: ['WR', [null, null, null, null, null, 800, 1200], flat(7, 0)],
    zero: ['QB', [0, 0, 0, 0, 0, 0, 300], flat(7, 0)],
  });
  const month = trendWindows(WEEKLY).find((w) => w.key === 'month') as TrendWindow;

  it('is his value at both ends of the window', () => {
    expect(priceMove(h, 'steady', month)).toEqual({
      playerId: 'steady',
      from: 5200,
      to: 6000,
      change: 800,
      share: 800 / 5200,
    });
  });

  it('is null for a player first priced inside the window, not a move from zero', () => {
    expect(priceMove(h, 'late', month)).toBeNull();
  });

  it('has no share when he started at nothing', () => {
    expect(priceMove(h, 'zero', month)?.share).toBeNull();
  });

  it('is null for a player the history never priced', () => {
    expect(priceMove(h, 'nobody', month)).toBeNull();
  });
});

describe('typicalMove', () => {
  it('is the median absolute move over the window, across the whole history', () => {
    const dates = ['2026-11-03', '2026-11-10'];
    const h = history(dates, {
      a: ['RB', [1000, 1100], [0, 0]],
      b: ['RB', [1000, 700], [0, 0]],
      c: ['RB', [1000, 1050], [0, 0]],
      d: ['RB', [1000, 1200], [0, 0]],
      gone: ['RB', [1000, null], [0, null]],
    });
    // |moves| 100, 300, 50, 200: median of four is (100 + 200) / 2.
    expect(typicalMove(h, trendWindows(dates)[0])).toBe(150);
  });
});

describe('marketMovers', () => {
  const dates = ['2026-11-03', '2026-11-10'];
  const h = history(dates, {
    star: ['QB', [7400, 8200], [0, 0]],
    back: ['RB', [3000, 3700], [0, 0]],
    drift: ['WR', [4000, 4050], [0, 0]],
    slump: ['RB', [6800, 6200], [0, 0]],
    crash: ['WR', [7400, 6000], [0, 0]],
    still: ['TE', [2000, 2000], [0, 0]],
    other: ['TE', [1000, 1060], [0, 0]],
  });
  const week = trendWindows(dates)[0];

  it('ranks by points and drops moves no bigger than the typical one', () => {
    const movers = marketMovers(h, ['star', 'back', 'drift', 'slump', 'crash', 'still'], week);
    // Every |move| in the file: 800, 700, 50, 600, 1400, 0, 60 — median 600.
    expect(movers.typical).toBe(600);
    expect(movers.rising.map((m) => m.playerId)).toEqual(['star', 'back']);
    expect(movers.falling.map((m) => m.playerId)).toEqual(['crash']);
    expect(movers.priced).toBe(6);
  });

  it('measures the bar on the whole history, not on the players asked about', () => {
    expect(marketMovers(h, ['drift'], week).typical).toBe(600);
  });

  it('caps each list and counts a repeated id once', () => {
    const movers = marketMovers(h, ['star', 'star', 'back'], week, 1);
    expect(movers.rising.map((m) => m.playerId)).toEqual(['star']);
    expect(movers.priced).toBe(2);
  });

  it('breaks a tie by id, so the same file always gives the same list', () => {
    const tie = history(dates, {
      b: ['RB', [1000, 2000], [0, 0]],
      a: ['RB', [1000, 2000], [0, 0]],
      c: ['RB', [1000, 1000], [0, 0]],
      d: ['RB', [1000, 1000], [0, 0]],
      e: ['RB', [1000, 1000], [0, 0]],
    });
    const movers = marketMovers(tie, ['b', 'a', 'c'], trendWindows(dates)[0]);
    expect(movers.rising.map((m) => m.playerId)).toEqual(['a', 'b']);
  });
});
