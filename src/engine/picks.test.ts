import { describe, expect, it } from 'vitest';
import { buildDraftPicks, picksForRoster, tradeableSeasons } from './picks';
import { makeLeague, makeRoster, makeSettings } from './testFixtures';
import type { PickValueTable } from '../values/dynastyprocess';

const league = makeLeague(
  [makeRoster(1, []), makeRoster(2, []), makeRoster(3, [])],
  makeSettings(['QB', 'WR'], { draftRounds: 2 }),
);

const table: PickValueTable = {
  seasons: ['2026', '2027'],
  fetchedAt: 0,
  rows: [
    { season: '2026', round: 1, slot: null, tier: null, value: 5000 },
    { season: '2026', round: 2, slot: null, tier: null, value: 2000 },
    { season: '2027', round: 1, slot: null, tier: null, value: 4000 },
    { season: '2027', round: 2, slot: null, tier: null, value: 1500 },
  ],
};

describe('buildDraftPicks', () => {
  it('gives every roster its own picks when nothing has been traded', () => {
    const picks = buildDraftPicks(league, [], ['2026', '2027'], table);
    // 3 rosters x 2 seasons x 2 rounds
    expect(picks).toHaveLength(12);
    expect(picks.every((p) => p.ownerRosterId === p.originalRosterId)).toBe(true);
  });

  it('reassigns ownership for traded picks only', () => {
    const picks = buildDraftPicks(
      league,
      [{ season: '2027', round: 1, originalRosterId: 3, ownerRosterId: 1 }],
      ['2026', '2027'],
      table,
    );

    const traded = picks.find((p) => p.id === '2027-1-3');
    expect(traded?.ownerRosterId).toBe(1);

    // Everything else is untouched.
    const others = picks.filter((p) => p.id !== '2027-1-3');
    expect(others.every((p) => p.ownerRosterId === p.originalRosterId)).toBe(true);
  });

  it('labels an acquired pick with the team it came from', () => {
    const picks = buildDraftPicks(
      league,
      [{ season: '2027', round: 1, originalRosterId: 3, ownerRosterId: 1 }],
      ['2027'],
      table,
    );
    expect(picks.find((p) => p.id === '2027-1-3')?.label).toBe('2027 1st (via Team 3)');
    expect(picks.find((p) => p.id === '2027-1-1')?.label).toBe('2027 1st');
  });

  it('prices picks from the value table', () => {
    const picks = buildDraftPicks(league, [], ['2026'], table);
    expect(picks.find((p) => p.id === '2026-1-1')?.value).toBe(5000);
    expect(picks.find((p) => p.id === '2026-2-1')?.value).toBe(2000);
  });

  it('degrades to zero-value picks when the value table is missing', () => {
    const picks = buildDraftPicks(league, [], ['2026'], undefined);
    expect(picks).toHaveLength(6);
    expect(picks.every((p) => p.value === 0)).toBe(true);
  });
});

describe('picksForRoster', () => {
  it('returns picks a roster holds, including acquired ones', () => {
    const picks = buildDraftPicks(
      league,
      [{ season: '2027', round: 1, originalRosterId: 3, ownerRosterId: 1 }],
      ['2027'],
      table,
    );

    const forOne = picksForRoster(picks, 1);
    expect(forOne.map((p) => p.id).sort()).toEqual(['2027-1-1', '2027-1-3', '2027-2-1']);

    // Roster 3 lost its first-rounder.
    expect(picksForRoster(picks, 3).map((p) => p.id)).toEqual(['2027-2-3']);
  });
});

describe('tradeableSeasons', () => {
  it('drops draft classes that have already happened', () => {
    expect(tradeableSeasons('2027', ['2026', '2027', '2028'])).toEqual(['2027', '2028']);
  });

  it('keeps everything when the current season precedes the range', () => {
    expect(tradeableSeasons('2025', ['2026', '2027'])).toEqual(['2026', '2027']);
  });
});
