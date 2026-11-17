import { describe, expect, it } from 'vitest';
import { formatShare, weekHeadline, weekSummary, type WeekTally } from './allLeaguesText';

const tally = (overrides: Partial<WeekTally>): WeekTally => ({
  leagues: 3,
  checked: 3,
  changes: 0,
  claims: 0,
  withCalls: 0,
  unfilled: 0,
  unchecked: 0,
  ...overrides,
});

describe('the All leagues verdict (#161)', () => {
  it('counts lineup moves and waiver claims together, and says where they are', () => {
    const t = tally({ changes: 2, claims: 1, withCalls: 2 });
    expect(weekHeadline(t)).toBe('3 changes to make');
    expect(weekSummary(t)).toBe('2 lineup moves and 1 waiver claim, in 2 of your 3 leagues.');
  });

  it('names only the kind of call there is', () => {
    expect(weekSummary(tally({ claims: 2, withCalls: 3 }))).toBe(
      '2 waiver claims, in all 3 of your leagues.',
    );
    expect(weekHeadline(tally({ changes: 1, withCalls: 1 }))).toBe('1 change to make');
  });

  it('says every lineup is set only when one was checked', () => {
    expect(weekHeadline(tally({}))).toBe('Every lineup is set');
    expect(weekSummary(tally({}))).toBe(
      'In all 3 lineups checked, nothing on the wire or your bench beats what you have set.',
    );
    expect(weekHeadline(tally({ checked: 0, unchecked: 3 }))).toBe('No lineups to check');
  });

  it('owns up to leagues it could not check', () => {
    expect(weekSummary(tally({ checked: 2, unchecked: 1 }))).toBe(
      "In both lineups checked, nothing on the wire or your bench beats what you have set. One league couldn't be checked; it's listed below.",
    );
    expect(weekSummary(tally({ checked: 1, changes: 1, withCalls: 1, unchecked: 2 }))).toBe(
      "1 lineup move, in 1 of your 3 leagues. 2 leagues couldn't be checked; they're listed below.",
    );
  });
});

describe('a slot nobody can fill', () => {
  it('is not called a set lineup', () => {
    const t = tally({ unfilled: 1 });
    expect(weekHeadline(t)).toBe('1 slot nobody can fill');
    expect(weekSummary(t)).toBe("One starting slot can't be filled from your bench or the wire.");
  });

  it('is added to the calls, not counted as one', () => {
    const t = tally({ claims: 1, withCalls: 1, unfilled: 2 });
    expect(weekHeadline(t)).toBe('1 change to make');
    expect(weekSummary(t)).toBe(
      "1 waiver claim, in 1 of your 3 leagues. 2 starting slots can't be filled from your bench or the wire.",
    );
  });
});

describe('formatShare', () => {
  it('rounds to a whole percent and never shows a held player as 0%', () => {
    expect(formatShare(0.184)).toBe('18%');
    expect(formatShare(0.003)).toBe('<1%');
    expect(formatShare(0)).toBe('0%');
  });
});
