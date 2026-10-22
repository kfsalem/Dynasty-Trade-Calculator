import { describe, expect, it } from 'vitest';
import { describeChange, evidenceLine, outscoreSentence } from './lineupText';
import type { LineupChange } from '../engine/startSit';
import type { WeekEvidence } from '../engine/weekEvidence';

const evidence = (overrides: Partial<WeekEvidence> = {}): WeekEvidence => ({
  games: 3,
  snapShare: 0.81,
  targetsPerGame: 7.3,
  carriesPerGame: 0,
  pointsPerGame: 15.2,
  track: null,
  ...overrides,
});

describe('outscoreSentence', () => {
  it('leads with the chance and shows both projections', () => {
    expect(outscoreSentence(0.64, 'Pittman', 13.4, 9.6)).toBe(
      '64% likely to outscore Pittman: 13.4 projected against 9.6.',
    );
  });

  it('calls a coin flip a coin flip', () => {
    expect(outscoreSentence(0.52, 'Pittman', 10.1, 9.6)).toBe(
      'A coin flip with Pittman: 10.1 projected against 9.6.',
    );
  });
});

describe('describeChange', () => {
  it('says a starter projected for nothing is not expected to play, with no percentage (#179)', () => {
    const change = {
      cause: 'unprojected',
      chance: 0.85,
      sitStays: false,
      sit: { player: { name: 'Pittman' } },
    } as unknown as LineupChange;

    const sentence = describeChange(change);
    expect(sentence).toBe(
      'Pittman is projected for nothing this week, which usually means he is not expected to play.',
    );
    expect(sentence).not.toMatch(/%/);
  });
});

describe('evidenceLine', () => {
  it('sets what he scored against what he was projected, over the same games (#181)', () => {
    expect(
      evidenceLine('ARI', evidence({ track: { games: 6, projected: 19.2, scored: 13.8 } }), 'QB'),
    ).toBe('vs ARI · 13.8 points a game against 19.2 projected');
  });

  it('keeps plain points a game until three games make an average worth reading', () => {
    expect(
      evidenceLine('ARI', evidence({ track: { games: 2, projected: 19.2, scored: 13.8 } }), 'QB'),
    ).toBe('vs ARI · 15.2 points a game');
  });

  it('reads opponent, role and scoring in that order', () => {
    expect(evidenceLine('PIT', evidence())).toBe(
      'vs PIT · 81% of snaps · 7.3 targets a game · 15.2 points a game',
    );
  });

  it('shows carries for a back who gets more of them than targets', () => {
    expect(evidenceLine('BAL', evidence({ targetsPerGame: 3, carriesPerGame: 17.5 }))).toContain(
      '17.5 carries a game',
    );
  });

  it('gives a quarterback no role line, only his opponent and his scoring', () => {
    expect(evidenceLine('LV', evidence({ snapShare: 1, carriesPerGame: 3.3, targetsPerGame: 0 }), 'QB')).toBe(
      'vs LV · 15.2 points a game',
    );
  });

  it('leaves out what it does not know rather than printing a zero', () => {
    expect(evidenceLine(null, evidence({ snapShare: null, pointsPerGame: null }))).toBe(
      '7.3 targets a game',
    );
    expect(evidenceLine(undefined, undefined)).toBeNull();
  });
});
