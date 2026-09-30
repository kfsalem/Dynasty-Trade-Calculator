import { describe, expect, it } from 'vitest';
import { evidenceThrough, weekEvidence } from './weekEvidence';
import {
  OPPORTUNITY_COLUMNS,
  SCORING_COLUMNS,
  SNAP_COLUMNS,
  type OpportunityFile,
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
