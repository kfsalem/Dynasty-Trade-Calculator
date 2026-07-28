import { describe, expect, it } from 'vitest';
import {
  buildDraftPicks,
  pickRealismFactor,
  picksForRoster,
  projectedSlots,
  slotTier,
  tradeableSeasons,
} from './picks';
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

describe('pickRealismFactor', () => {
  it('keeps the first ten picks at full value', () => {
    expect(pickRealismFactor(1, 1)).toBe(1);
    expect(pickRealismFactor(10, 1)).toBe(1);
  });

  it('puts a cliff after roughly the fifteenth pick', () => {
    // An NFL class yields ~10-15 offensive players who matter early. Pick 16
    // is the first one past that supply, and it is worth barely half of 15.
    const fifteen = pickRealismFactor(15, 2);
    const sixteen = pickRealismFactor(16, 2);
    expect(fifteen).toBeGreaterThan(0.7);
    expect(sixteen).toBeLessThan(fifteen * 0.65);
  });

  it('treats third-rounders as near worthless', () => {
    expect(pickRealismFactor(21, 3)).toBeLessThan(0.05);
    expect(pickRealismFactor(35, 3)).toBeLessThan(0.05);
  });

  it('measures the cliff in absolute picks, not rounds', () => {
    // Pick 12 is a late 1st in a 12-team league and an early 2nd in a 10-team
    // one. NFL talent supply does not care which, so the factor must not.
    expect(pickRealismFactor(12, 1)).toBe(pickRealismFactor(12, 2));
  });
});

describe('projected draft slots', () => {
  it('gives the worst roster the first pick', () => {
    const slots = projectedSlots([3, 1, 2]);
    expect(slots.get(3)).toBe(1);
    expect(slots.get(2)).toBe(3);
  });

  it('buckets slots into thirds for seasons priced by tier', () => {
    expect(slotTier(1, 12)).toBe('early');
    expect(slotTier(6, 12)).toBe('mid');
    expect(slotTier(12, 12)).toBe('late');
  });

  it('prices a bottom team’s first well above the champion’s', () => {
    // DynastyProcess names the imminent draft by exact slot and the next one by
    // tier. The realism curve is only a correction to the market's shape, so
    // within-round differences have to come from these rows.
    const slotted: PickValueTable = {
      seasons: ['2026', '2027'],
      fetchedAt: 0,
      rows: [
        { season: '2026', round: 1, slot: 1, tier: null, value: 8000 },
        { season: '2026', round: 1, slot: 2, tier: null, value: 6000 },
        { season: '2026', round: 1, slot: 3, tier: null, value: 4500 },
        { season: '2027', round: 1, slot: null, tier: 'early', value: 7000 },
        { season: '2027', round: 1, slot: null, tier: 'mid', value: 5500 },
        { season: '2027', round: 1, slot: null, tier: 'late', value: 4000 },
      ],
    };

    // Same round, same season — the only difference is who it came from.
    const picks = buildDraftPicks(league, [], ['2026', '2027'], slotted, [3, 2, 1]);
    const worst = picks.find((p) => p.id === '2026-1-3');
    const best = picks.find((p) => p.id === '2026-1-1');

    expect(worst!.slot).toBe(1);
    expect(best!.slot).toBe(3);
    expect(worst!.marketValue).toBe(8000);
    expect(best!.marketValue).toBe(4500);

    // A season out, the same ordering survives through the tier buckets.
    expect(picks.find((p) => p.id === '2027-1-3')!.marketValue).toBe(7000);
    expect(picks.find((p) => p.id === '2027-1-1')!.marketValue).toBe(4000);
  });

  it('scales league value off market value without touching the market figure', () => {
    const picks = buildDraftPicks(league, [], ['2026'], table, [3, 2, 1], 0.5);
    const pick = picks.find((p) => p.id === '2026-1-3');

    expect(pick!.marketValue).toBe(5000);
    expect(pick!.value).toBe(2500);
  });

  it('leaves values unslotted when standings are unknown', () => {
    const picks = buildDraftPicks(league, [], ['2026'], table);
    expect(picks.every((p) => p.slot === null)).toBe(true);
    expect(picks.find((p) => p.id === '2026-1-1')!.marketValue).toBe(5000);
  });
});
