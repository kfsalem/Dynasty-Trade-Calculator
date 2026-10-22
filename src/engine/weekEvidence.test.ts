import { describe, expect, it } from 'vitest';
import { evidenceThrough, weekEvidence } from './weekEvidence';
import {
  OPPORTUNITY_COLUMNS,
  PROJECTED_COLUMNS,
  SCORING_COLUMNS,
  SNAP_COLUMNS,
  type OpportunityFile,
  type ProjectedFile,
  type ScoringFile,
  type SnapCountsFile,
} from '../data/types';

const meta = (season: number) => ({
  generatedAt: '2026-09-29T00:00:00Z',
  season,
  throughWeek: 3,
  source: 'test',
});

const snaps = (season: number): SnapCountsFile => ({
  ...meta(season),
  columns: SNAP_COLUMNS,
  players: {
    wr: { pos: 'WR', team: 'KC', weeks: [[1, 50, 0.8], [2, 40, 0.6]] },
  },
});

const usage = (season: number): OpportunityFile => ({
  ...meta(season),
  columns: OPPORTUNITY_COLUMNS,
  players: {
    wr: {
      pos: 'WR',
      team: 'KC',
      weeks: [
        [1, 8, 0.25, 0.3, 0.6, 0, null, 6, 15],
        [2, 6, 0.2, 0.2, 0.4, 1, 0.05, 4, 9],
      ],
    },
  },
});

/** Week, then receptions and receiving yards; the rest trimmed as the file does. */
const scoring = (season: number): ScoringFile => ({
  ...meta(season),
  columns: SCORING_COLUMNS,
  players: {
    wr: { pos: 'WR', team: 'KC', weeks: [[1, 6, 80], [2, 4, 40]] },
  },
});

const RULES = { rec: 1, rec_yd: 0.1 };

/** A projected row: the weeks summed as a bitmask, then the named sums. */
const projectedRow = (weeks: number[], sums: Record<string, number>): number[] => [
  weeks.reduce((mask, week) => mask | (1 << week), 0),
  ...PROJECTED_COLUMNS.slice(1).map((key) => sums[key] ?? 0),
];

const projected = (season: number, row: number[]): ProjectedFile => ({
  ...meta(season),
  columns: PROJECTED_COLUMNS,
  players: { wr: row },
});

describe('weekEvidence', () => {
  it("averages this season's snaps, targets, carries and league points", () => {
    const evidence = weekEvidence({
      season: 2026,
      snaps: snaps(2026),
      usage: usage(2026),
      scoring: scoring(2026),
      rules: RULES,
    }).get('wr');

    expect(evidence?.games).toBe(2);
    expect(evidence?.snapShare).toBeCloseTo(0.7);
    expect(evidence?.targetsPerGame).toBe(7);
    expect(evidence?.carriesPerGame).toBe(0.5);
    // (6 + 8) and (4 + 4), under the league's own rules: 11 a game.
    expect(evidence?.pointsPerGame).toBeCloseTo(11);
  });

  it('says nothing from a file describing another season', () => {
    // Last November's snap share is fair context in July, but beside a call
    // for this Sunday it would read as this year's role.
    const evidence = weekEvidence({
      season: 2026,
      snaps: snaps(2025),
      usage: usage(2025),
      scoring: scoring(2025),
      rules: RULES,
    });

    expect(evidence.size).toBe(0);
  });

  describe('against his projection (#181)', () => {
    it('sets what he scored against what he was projected, per game, in league points', () => {
      // Projected 10 catches for 140 yards over the two weeks: (10 + 14) / 2 = 12 a game.
      const track = weekEvidence({
        season: 2026,
        snaps: null,
        usage: null,
        scoring: scoring(2026),
        projected: projected(2026, projectedRow([1, 2], { rec: 10, rec_yd: 140 })),
        rules: RULES,
      }).get('wr')?.track;

      expect(track?.games).toBe(2);
      expect(track?.projected).toBeCloseTo(12);
      expect(track?.scored).toBeCloseTo(11);
    });

    it('scores only the weeks that had a projection, on both sides', () => {
      // Week 2 had no projection, so his week-2 points are left out too: 14, not 11.
      const track = weekEvidence({
        season: 2026,
        snaps: null,
        usage: null,
        scoring: scoring(2026),
        projected: projected(2026, projectedRow([1], { rec: 5, rec_yd: 70 })),
        rules: RULES,
      }).get('wr')?.track;

      expect(track?.games).toBe(1);
      expect(track?.projected).toBeCloseTo(12);
      expect(track?.scored).toBeCloseTo(14);
    });

    it("applies the league's own rules to the projection, as to what he scored", () => {
      const track = weekEvidence({
        season: 2026,
        snaps: null,
        usage: null,
        scoring: scoring(2026),
        projected: projected(2026, projectedRow([1, 2], { rec: 10, rec_yd: 140 })),
        rules: { rec: 0, rec_yd: 0.1 },
      }).get('wr')?.track;

      // Standard scoring: 14 projected yards a game, 6 scored.
      expect(track?.projected).toBeCloseTo(7);
      expect(track?.scored).toBeCloseTo(6);
    });

    it('says nothing from a projection file for another season', () => {
      const evidence = weekEvidence({
        season: 2026,
        snaps: null,
        usage: null,
        scoring: scoring(2026),
        projected: projected(2025, projectedRow([1, 2], { rec: 10, rec_yd: 140 })),
        rules: RULES,
      }).get('wr');

      expect(evidence?.track).toBeNull();
    });
  });

  it('survives files that have not loaded', () => {
    expect(
      weekEvidence({ season: 2026, snaps: null, usage: undefined, scoring: null, rules: RULES })
        .size,
    ).toBe(0);
  });
});

describe('evidenceThrough', () => {
  it('is the stalest current-season file, so the date never overclaims', () => {
    expect(evidenceThrough(2026, [snaps(2026), { ...usage(2026), throughWeek: 2 }, scoring(2026)])).toBe(2);
  });

  it('ignores files from another season, and says nothing when none are current', () => {
    expect(evidenceThrough(2026, [snaps(2025), usage(2026)])).toBe(3);
    expect(evidenceThrough(2026, [snaps(2025), null, undefined])).toBeNull();
  });
});
