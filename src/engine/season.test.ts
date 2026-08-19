import { describe, expect, it } from 'vitest';
import { isGameWeek, regularSeasonWeek } from './season';
import { remainingFixtures } from './playoffOdds';
import type { Matchup } from '../types';

describe('regularSeasonWeek', () => {
  it('reads a preseason week as the season not having started', () => {
    // Sleeper says week 2 in the middle of August. It is not week 2.
    expect(regularSeasonWeek(2, 'pre', 14)).toBe(1);
  });

  it('takes a regular-season week at face value', () => {
    expect(regularSeasonWeek(7, 'regular', 14)).toBe(7);
    expect(regularSeasonWeek(16, 'post', 14)).toBe(16);
  });

  it('puts the offseason past the last fixture rather than at week 0', () => {
    // "Nothing left to play" and "no idea what week it is" are different
    // answers, and only one of them is a null.
    expect(regularSeasonWeek(1, 'off', 14)).toBe(15);
  });

  it('trusts the platform when no phase is published', () => {
    expect(regularSeasonWeek(3, 'unknown', 14)).toBe(3);
  });

  it('never guesses a week the platform does not know', () => {
    expect(regularSeasonWeek(null, 'regular', 14)).toBeNull();
    expect(regularSeasonWeek(null, 'pre', 14)).toBeNull();
  });
});

describe('regularSeasonWeek with remainingFixtures', () => {
  const schedule: Matchup[] = [1, 2, 3].map((week) => ({
    week,
    rosterIds: [1, 2] as [number, number],
    points: null,
  }));

  it('keeps the whole season ahead of a preseason league', () => {
    // The bug this closes: week 2 of the preseason retired weeks 1 and 2 of a
    // season nobody had played, and the playoff odds simulated the rest.
    const weeks = remainingFixtures(schedule, regularSeasonWeek(2, 'pre', 3), 4);
    expect(weeks.map((fixture) => fixture.week)).toEqual([1, 2, 3]);
  });

  it('still retires the weeks already played in the regular season', () => {
    const weeks = remainingFixtures(schedule, regularSeasonWeek(2, 'regular', 3), 4);
    expect(weeks.map((fixture) => fixture.week)).toEqual([2, 3]);
  });
});

describe('isGameWeek', () => {
  it('is true only when a game is next', () => {
    expect(isGameWeek('regular')).toBe(true);
    expect(isGameWeek('post')).toBe(true);
    expect(isGameWeek('pre')).toBe(false);
    expect(isGameWeek('off')).toBe(false);
    expect(isGameWeek('unknown')).toBe(false);
  });
});
