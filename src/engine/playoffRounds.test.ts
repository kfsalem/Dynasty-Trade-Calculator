import { describe, expect, it } from 'vitest';
import { lastPlayoffWeek, roundWeeks } from './playoffRounds';

describe('roundWeeks', () => {
  it('plays one round a week under round type 0, the verified format', () => {
    // The test league's 2025 playoffs: three rounds from week 15.
    expect([1, 2, 3].map((round) => roundWeeks(15, 0, round, 3))).toEqual([[15], [16], [17]]);
    expect(lastPlayoffWeek(15, 0, 3)).toBe(17);
  });

  it('spreads a two-week final under type 1, and every round under type 2', () => {
    expect(roundWeeks(15, 1, 3, 3)).toEqual([17, 18]);
    expect(roundWeeks(15, 2, 2, 3)).toEqual([17, 18]);
    expect(lastPlayoffWeek(15, 2, 3)).toBe(20);
  });

  it('adds no weeks for a bracket with no rounds', () => {
    expect(lastPlayoffWeek(15, 0, 0)).toBe(14);
  });
});
