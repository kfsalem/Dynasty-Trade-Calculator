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
      { season: '2027', round: 2, slot: null, tier: null, value: 900 },
      { season: '2028', round: 1, slot: null, tier: null, value: 3000 },
    ],
  };

  it('uses the exact slot when known', () => {
    expect(lookupPickValue(table, '2026', 1)).toBe(6000);
    expect(lookupPickValue(table, '2026', 3)).toBe(4000);
  });

  it('reads the overall pick number onto the twelve-team board the source uses', () => {
    // The mismatch this signature exists to remove. DynastyProcess names every
    // pick 1.01-1.12, so its labels are overall pick numbers and nothing else.
    // Passing a 10-team league's own "2.09" asked for the 21st pick when the
    // caller meant the 19th — two picks deeper into a class that does not care
    // how many teams are in the league. Round 1 was immune, which is what kept
    // it invisible.
    expect(lookupPickValue(table, '2026', 2)).toBe(5000);
    // Past the twelfth pick the board rolls into its second round.
    expect(lookupPickValue(table, '2027', 13)).toBe(900);
  });

  it('falls back to the tier when the source names no exact slot', () => {
    // 2027 is tiered only; overall pick 2 is early on a twelve-team board.
    expect(lookupPickValue(table, '2027', 2)).toBe(4200);
  });

  it('falls back to the generic round when there is no tier either', () => {
    // Overall pick 10 is late, and 2027 publishes no late row.
    expect(lookupPickValue(table, '2027', 10)).toBe(3500);
  });

  it('uses the median slot when a season has slots but no matching one', () => {
    // 2026 lists only 1.01-1.03, so a pick outside them takes the middle.
    expect(lookupPickValue(table, '2026', 7)).toBe(5000);
  });

  it('clamps a season past the published range to the furthest available', () => {
    expect(lookupPickValue(table, '2031', 1)).toBe(3000);
  });

  it('clamps a round past the deepest published one instead of pricing it at zero', () => {
    // Overall pick 100 is round 9 on the board, and no source covers that. A
    // zero here is a real asset the engine would hand over for nothing.
    expect(lookupPickValue(table, '2026', 100)).toBe(5000);
  });
});
