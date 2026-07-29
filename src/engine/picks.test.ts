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

/**
 * Every round quoted identically, so anything that differs between two picks
 * priced off this table came from the realism curve and nowhere else.
 */
const flat: PickValueTable = {
  seasons: ['2026'],
  fetchedAt: 0,
  rows: [1, 2, 3].map((round) => ({
    season: '2026',
    round,
    slot: null,
    tier: null,
    value: 1000,
  })),
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
  const drafting = { season: '2026', status: 'pre_draft' };
  const drafted = { season: '2026', status: 'in_season' };

  it('drops draft classes that have already happened', () => {
    expect(tradeableSeasons('2027', ['2026', '2027', '2028'], { ...drafting, season: '2027' }))
      .toEqual(['2027', '2028']);
  });

  it('keeps everything when the current season precedes the range', () => {
    expect(tradeableSeasons('2025', ['2026', '2027'], { ...drafting, season: '2025' }))
      .toEqual(['2026', '2027']);
  });

  it('keeps this year’s class while the rookie draft is still to come', () => {
    // Dynasty rookie drafts run as late as August, months after Sleeper's
    // season field rolls over. Those picks are live and highly tradeable.
    expect(tradeableSeasons('2026', ['2026', '2027'], drafting)).toEqual(['2026', '2027']);
    expect(tradeableSeasons('2026', ['2026', '2027'], { ...drafting, status: 'drafting' }))
      .toEqual(['2026', '2027']);
  });

  it('drops this year’s class once the league has drafted', () => {
    // The window this closes is long: from the day a league drafts until the
    // NFL season field rolls over the following spring.
    expect(tradeableSeasons('2026', ['2026', '2027'], drafted)).toEqual(['2027']);
    expect(tradeableSeasons('2026', ['2026', '2027'], { ...drafted, status: 'complete' }))
      .toEqual(['2027']);
  });

  it('ignores the status of a league that has not rolled over yet', () => {
    // A dynasty league still on last season's entry reads `complete` — a
    // statement about a finished season, not about this year's rookie draft,
    // which has not even been scheduled.
    expect(tradeableSeasons('2026', ['2026', '2027'], { season: '2025', status: 'complete' }))
      .toEqual(['2026', '2027']);
  });
});

describe('pickRealismFactor', () => {
  it('keeps the first ten picks at full value', () => {
    expect(pickRealismFactor(1)).toBe(1);
    expect(pickRealismFactor(10)).toBe(1);
  });

  it('falls off a cliff past the fifteenth pick', () => {
    // An NFL class yields ~10-15 offensive players who matter early. Past that
    // the supply is gone, and the curve has to say so.
    expect(pickRealismFactor(15)).toBeGreaterThan(0.65);
    expect(pickRealismFactor(22)).toBeLessThan(pickRealismFactor(15) * 0.4);
  });

  it('prices late picks as lottery tickets without erasing them', () => {
    // Small, but ordered: flattening them onto one number loses the difference
    // between an early third and a late fourth, which is a real difference.
    expect(pickRealismFactor(30)).toBeLessThan(0.1);
    expect(pickRealismFactor(60)).toBeGreaterThan(0);
    expect(pickRealismFactor(25)).toBeGreaterThan(pickRealismFactor(35));
  });

  it('is continuous — no two adjacent picks differ by a step', () => {
    // The regression. A `round >= 3` short-circuit put an 11x drop between
    // picks 20 and 21 in a 10-team league, which no projected slot is precise
    // enough to justify.
    for (let pick = 1; pick < 60; pick++) {
      const drop = pickRealismFactor(pick) - pickRealismFactor(pick + 1);
      expect(drop).toBeGreaterThanOrEqual(0);
      expect(drop).toBeLessThan(0.1);
    }
  });

  it('measures the cliff in absolute picks, not rounds', () => {
    // Pick 21 is a third-rounder in a 10-team league and a second-rounder in a
    // 12-team one. NFL talent supply does not care which, so neither may this.
    const tenTeam = buildDraftPicks(
      makeLeague(
        Array.from({ length: 10 }, (_, i) => makeRoster(i + 1, [])),
        makeSettings(['QB'], { draftRounds: 3 }),
      ),
      [], ['2026'], flat, Array.from({ length: 10 }, (_, i) => i + 1),
    );
    const twelveTeam = buildDraftPicks(
      makeLeague(
        Array.from({ length: 12 }, (_, i) => makeRoster(i + 1, [])),
        makeSettings(['QB'], { draftRounds: 3 }),
      ),
      [], ['2026'], flat, Array.from({ length: 12 }, (_, i) => i + 1),
    );

    // 3.01 in the ten-team league and 2.09 in the twelve-team one are both
    // overall pick 21, drawing on the same class.
    const third = tenTeam.find((p) => p.id === '2026-3-1')!;
    const second = twelveTeam.find((p) => p.id === '2026-2-9')!;
    expect(third.slot).toBe(1);
    expect(second.slot).toBe(9);
    expect(third.marketValue).toBe(second.marketValue);
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
