import { describe, expect, it } from 'vitest';
import {
  TRACK_RECORD_COLUMNS,
  summarize,
  tally,
  wilson,
  type TrackRecordFile,
  type TrackRecordRow,
} from './trackRecord';

const row = (
  chance: number,
  hit: 0 | 1,
  { decisive = 0, fact = 0, season = 2025 }: { decisive?: 0 | 1; fact?: 0 | 1; season?: number } = {},
): TrackRecordRow => [season, 3, 0, 'WR', Math.round(chance * 1000), hit, decisive, fact];

const file = (rows: TrackRecordRow[], graded = ['0:2025:3']): TrackRecordFile => ({
  generatedAt: '2026-10-22T00:00:00.000Z',
  columns: TRACK_RECORD_COLUMNS,
  leagues: 2,
  graded,
  rows,
});

describe('wilson', () => {
  it('does not call eighteen in eighteen certain', () => {
    const [low, high] = wilson(18, 18);
    expect(high).toBe(1);
    expect(low).toBeCloseTo(0.824, 3);
  });

  it('is wide on a small sample and narrow on a large one', () => {
    const [smallLow, smallHigh] = wilson(5, 10);
    const [bigLow, bigHigh] = wilson(500, 1000);
    expect(smallHigh - smallLow).toBeGreaterThan(0.5);
    expect(bigHigh - bigLow).toBeLessThan(0.07);
  });

  it('claims nothing about no calls at all', () => {
    expect(wilson(0, 0)).toEqual([0, 1]);
  });
});

describe('tally', () => {
  it('compares the share that came true with the mean stated chance', () => {
    const t = tally([row(0.6, 1), row(0.7, 1), row(0.65, 0)]);
    expect(t.calls).toBe(3);
    expect(t.hits).toBe(2);
    expect(t.rate).toBeCloseTo(2 / 3);
    expect(t.stated).toBeCloseTo(0.65);
  });
});

describe('summarize', () => {
  it('reads opinions apart from facts, so a near-certain bye cannot flatter the curve', () => {
    const s = summarize(file([row(0.56, 1), row(0.56, 0), row(0.85, 1, { fact: 1 })]));
    expect(s.opinions.calls).toBe(2);
    expect(s.facts.calls).toBe(1);
    expect(s.buckets.reduce((sum, b) => sum + b.calls, 0)).toBe(2);
  });

  it('buckets by stated chance, half-open, and keeps only buckets with calls', () => {
    const s = summarize(file([row(0.5, 1), row(0.549, 0), row(0.55, 1), row(0.62, 1)]));
    expect(s.buckets.map((b) => [b.from, b.to, b.calls])).toEqual([
      [0.5, 0.55, 2],
      [0.55, 0.6, 1],
      [0.6, 0.7, 1],
    ]);
  });

  it('puts a call stated at certainty in the last bucket rather than dropping it', () => {
    const s = summarize(file([row(1, 1)]));
    expect(s.buckets).toHaveLength(1);
    expect(s.buckets[0].from).toBe(0.9);
  });

  it('counts the decisive calls among the opinions only', () => {
    const s = summarize(
      file([row(0.65, 1, { decisive: 1 }), row(0.8, 1, { decisive: 1, fact: 1 }), row(0.52, 0)]),
    );
    expect(s.decisive.calls).toBe(1);
  });

  it('counts weeks and seasons from what was graded, including weeks with no call', () => {
    const s = summarize(file([], ['0:2024:1', '0:2024:2', '1:2025:1']));
    expect(s.weeks).toBe(3);
    expect(s.seasons).toEqual([2024, 2025]);
    expect(s.leagues).toBe(2);
  });
});
