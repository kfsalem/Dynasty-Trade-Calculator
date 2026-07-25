import { describe, expect, it } from 'vitest';
import { lookupPickValue, parsePickName, type PickValueTable } from './dynastyprocess';

describe('parsePickName', () => {
  it('parses an exact slot from the imminent draft', () => {
    expect(parsePickName('2026 Pick 1.01')).toEqual({
      season: '2026',
      round: 1,
      slot: 1,
      tier: null,
    });
  });

  it('parses a double-digit slot', () => {
    expect(parsePickName('2026 Pick 3.12')?.slot).toBe(12);
  });

  it('parses a tiered future pick', () => {
    expect(parsePickName('2027 Early 1st')).toEqual({
      season: '2027',
      round: 1,
      slot: null,
      tier: 'early',
    });
  });

  it('parses a generic future pick', () => {
    expect(parsePickName('2028 3rd')).toEqual({
      season: '2028',
      round: 3,
      slot: null,
      tier: null,
    });
  });

  it('rejects anything that is not a pick', () => {
    expect(parsePickName("Ja'Marr Chase")).toBeNull();
    expect(parsePickName('2026 Pick')).toBeNull();
  });
});

describe('lookupPickValue', () => {
  const table: PickValueTable = {
    seasons: ['2026', '2027', '2028'],
    fetchedAt: 0,
    rows: [
      { season: '2026', round: 1, slot: 1, tier: null, value: 6000 },
      { season: '2026', round: 1, slot: 2, tier: null, value: 5000 },
      { season: '2026', round: 1, slot: 3, tier: null, value: 4000 },
      { season: '2027', round: 1, slot: null, tier: 'early', value: 4200 },
      { season: '2027', round: 1, slot: null, tier: null, value: 3500 },
      { season: '2028', round: 1, slot: null, tier: null, value: 3000 },
    ],
  };

  it('uses the exact slot when known', () => {
    expect(lookupPickValue(table, '2026', 1, 1)).toBe(6000);
  });

  it('falls back to the tier when the slot is unknown', () => {
    expect(lookupPickValue(table, '2027', 1, null, 'early')).toBe(4200);
  });

  it('falls back to the generic round when there is no tier', () => {
    expect(lookupPickValue(table, '2027', 1)).toBe(3500);
  });

  it('uses the median slot when a season has slots but no generic row', () => {
    // 2026 has only exact slots, so an unknown-slot pick takes the middle one.
    expect(lookupPickValue(table, '2026', 1)).toBe(5000);
  });

  it('clamps a season past the published range to the furthest available', () => {
    expect(lookupPickValue(table, '2031', 1)).toBe(3000);
  });

  it('returns 0 for a round the source does not cover', () => {
    expect(lookupPickValue(table, '2026', 9)).toBe(0);
  });
});
