import { describe, expect, it } from 'vitest';
import { gradeAgainst } from './grades';

describe('gradeAgainst', () => {
  it('separates a runaway leader from a photo finish, which the rank cannot', () => {
    // Both teams are 1st of 4. Only one of them is safe.
    const runaway = gradeAgainst(3000, [3000, 2000, 1800, 1500]);
    const narrow = gradeAgainst(3000, [3000, 2940, 1800, 1500]);

    expect(runaway.rank).toBe(1);
    expect(narrow.rank).toBe(1);
    expect(runaway.percentile).toBe(1);
    expect(narrow.percentile).toBe(1);

    // The margin is the whole difference between the two situations.
    expect(runaway.ahead).toBeCloseTo(1 / 3, 5);
    expect(narrow.ahead).toBeCloseTo(0.02, 5);
  });

  it('measures both neighbours for a team in the middle', () => {
    const grade = gradeAgainst(1800, [3000, 2000, 1800, 1500]);

    expect(grade.rank).toBe(3);
    expect(grade.behind).toBeCloseTo(0.1, 5); // 200 short of 2000
    expect(grade.ahead).toBeCloseTo(1 / 6, 5); // 300 clear of 1500
  });

  it('has nobody above the leader and nobody below the last', () => {
    const league = [3000, 2000, 1500];

    expect(gradeAgainst(3000, league).behind).toBe(0);
    expect(gradeAgainst(1500, league).ahead).toBe(0);
  });

  it('gives tied teams the better rank and no margin between them', () => {
    const grade = gradeAgainst(2000, [2000, 2000, 1000]);

    expect(grade.rank).toBe(1);
    expect(grade.behind).toBe(0);
    // The tie is not the nearest team below — the 1000 is.
    expect(grade.ahead).toBeCloseTo(0.5, 5);
  });

  it('reads a one-team league as the middle of itself rather than as an extreme', () => {
    expect(gradeAgainst(2000, [2000])).toEqual({
      score: 2000,
      rank: 1,
      teamCount: 1,
      percentile: 0.5,
      behind: 0,
      ahead: 0,
    });
  });

  it('says nothing surprising about a league where everyone is worth nothing', () => {
    const grade = gradeAgainst(0, [0, 0, 0]);

    expect(grade.rank).toBe(1);
    expect(grade.percentile).toBe(0);
    expect(grade.behind).toBe(0);
    expect(grade.ahead).toBe(0);
  });
});
