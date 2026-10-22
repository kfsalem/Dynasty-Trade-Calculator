import { describe, expect, it } from 'vitest';
import { appendPoint, emptyHistory, historyFile, playerSeries } from './valueHistory';

/** Snapshot rows in `VALUE_COLUMNS` order: id, position, value, redraft, then ranks and tier. */
const snap = (...rows: [string, string, number, number][]) => ({
  rows: rows.map(([id, pos, value, redraft]) => [id, pos, value, redraft, 1, 1, 0, 1]) as never,
});

describe('appendPoint', () => {
  it('starts a history from nothing', () => {
    const h = appendPoint(emptyHistory(1, 'test'), '2026-10-20', snap(['a', 'RB', 1000, 900]), 'run');

    expect(h.dates).toEqual(['2026-10-20']);
    expect(h.players.a).toEqual(['RB', [1000], [900]]);
    expect(h.generatedAt).toBe('run');
  });

  it('pads a newcomer with nulls and a man missing today with a null', () => {
    let h = appendPoint(emptyHistory(1, 'test'), '2026-10-13', snap(['a', 'RB', 1000, 900]), 'r1');
    h = appendPoint(h, '2026-10-20', snap(['b', 'WR', 500, 450]), 'r2');

    expect(h.players.a).toEqual(['RB', [1000, null], [900, null]]);
    expect(h.players.b).toEqual(['WR', [null, 500], [null, 450]]);
  });

  it('replaces a point taken the same day rather than adding a second', () => {
    let h = appendPoint(emptyHistory(1, 'test'), '2026-10-20', snap(['a', 'RB', 1000, 900]), 'r1');
    h = appendPoint(h, '2026-10-20', snap(['a', 'RB', 1100, 950]), 'r2');

    expect(h.dates).toEqual(['2026-10-20']);
    expect(h.players.a).toEqual(['RB', [1100], [950]]);
  });

  it('refuses a point older than the newest, which would scramble every row', () => {
    const h = appendPoint(emptyHistory(1, 'test'), '2026-10-20', snap(['a', 'RB', 1000, 900]), 'r1');

    expect(() => appendPoint(h, '2026-10-13', snap(['a', 'RB', 1, 1]), 'r2')).toThrow(/earlier/);
  });

  it('leaves the history it was given unchanged', () => {
    const before = appendPoint(emptyHistory(1, 'test'), '2026-10-13', snap(['a', 'RB', 1000, 900]), 'r1');
    appendPoint(before, '2026-10-20', snap(['a', 'RB', 1100, 950]), 'r2');

    expect(before.players.a).toEqual(['RB', [1000], [900]]);
  });

  it('rounds to whole values, as the snapshot quotes them', () => {
    const h = appendPoint(emptyHistory(1, 'test'), '2026-10-20', snap(['a', 'RB', 1000.6, 899.4]), 'r');

    expect(h.players.a).toEqual(['RB', [1001], [899]]);
  });
});

describe('playerSeries', () => {
  it('gives the days he was listed, oldest first, and skips the rest', () => {
    let h = appendPoint(emptyHistory(1, 'test'), '2026-10-06', snap(['a', 'RB', 900, 800]), 'r1');
    h = appendPoint(h, '2026-10-13', snap(['b', 'WR', 1, 1]), 'r2');
    h = appendPoint(h, '2026-10-20', snap(['a', 'RB', 1000, 900]), 'r3');

    expect(playerSeries(h, 'a')).toEqual([
      { date: '2026-10-06', value: 900, redraft: 800 },
      { date: '2026-10-20', value: 1000, redraft: 900 },
    ]);
    expect(playerSeries(h, 'nobody')).toEqual([]);
  });
});

describe('historyFile', () => {
  it('keeps one history per QB setting beside the snapshots', () => {
    expect(historyFile(1)).toBe('values/history-1qb.json');
    expect(historyFile(2)).toBe('values/history-2qb.json');
  });
});
