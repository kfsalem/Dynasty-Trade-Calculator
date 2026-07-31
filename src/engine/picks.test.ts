import { describe, expect, it } from 'vitest';
import {
  buildDraftPicks,
  overallPickNumber,
  picksForRoster,
  projectedSlots,
  tradeableSeasons,
  type KnownDraftOrder,
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
 * Every round on the source's own board quoted identically, so two picks that
 * differ in price here differ because they land in different *rounds of the
 * board* — never because of anything applied on top of it.
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

/** The same board named slot by slot, for tests that need adjacent picks to differ. */
const bySlot: PickValueTable = {
  seasons: ['2026'],
  fetchedAt: 0,
  rows: Array.from({ length: 36 }, (_, i) => ({
    season: '2026',
    round: Math.floor(i / 12) + 1,
    slot: (i % 12) + 1,
    tier: null,
    value: 6000 - i * 150,
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

  it('prices picks from the value table, by overall pick number', () => {
    const picks = buildDraftPicks(league, [], ['2026'], table);
    expect(picks.find((p) => p.id === '2026-1-1')?.value).toBe(5000);
    // A three-team league's "2.01" is the *fourth* pick overall, which is still
    // a first-round talent — so it takes the source's first-round price. The
    // round number in your league's own labelling is not a fact about the class.
    expect(picks.find((p) => p.id === '2026-2-1')?.value).toBe(5000);
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

describe('the rookie-pick cliff', () => {
  /** A board with the shape of the real source: steep, and named by exact slot. */
  const steep: PickValueTable = {
    seasons: ['2026'],
    fetchedAt: 0,
    rows: Array.from({ length: 36 }, (_, i) => ({
      season: '2026',
      round: Math.floor(i / 12) + 1,
      slot: (i % 12) + 1,
      tier: null,
      // Roughly DynastyProcess's own 2026 curve: 5,500 at 1.01, a 28x drop by
      // the twentieth pick, and still ordered at the end of the third round.
      value: Math.round(5500 * 0.85 ** i),
    })),
  };

  const build = (teams: number, rounds: number) =>
    buildDraftPicks(
      makeLeague(
        Array.from({ length: teams }, (_, i) => makeRoster(i + 1, [])),
        makeSettings(['QB'], { draftRounds: rounds }),
      ),
      [],
      ['2026'],
      steep,
      Array.from({ length: teams }, (_, i) => i + 1),
    );

  const at = (picks: ReturnType<typeof build>, round: number, slot: number) =>
    picks.find((p) => p.id === `2026-${round}-${slot}`)!.marketValue;

  it('comes from the source, and is not imposed a second time on top of it', () => {
    /**
     * The regression. `pickRealismFactor` multiplied DynastyProcess's own curve
     * by a second one — 0.30 at pick 20, 0.08 at pick 30 — on the theory that
     * market pick values are smoother than reality because hope is priced in.
     * They are not: the source already drops 28x by pick 20 before anything of
     * ours runs. Compounded, a 2026 second-rounder in the real 10-team league
     * priced at **44 out of 10,000** — a sixth of a waiver-wire running back.
     *
     * A pick is now worth exactly what the source says for its overall position,
     * with nothing applied on top.
     */
    const picks = build(10, 3);

    // Overall pick 11 in a 10-team league is the source's 1.11, not its 2.01.
    expect(at(picks, 2, 1)).toBe(steep.rows[10].value);
    // Overall 20 is its 2.08, and overall 21 its 2.09.
    expect(at(picks, 2, 10)).toBe(steep.rows[19].value);
    expect(at(picks, 3, 1)).toBe(steep.rows[20].value);
  });

  it('still falls off a cliff, because the source does', () => {
    const picks = build(10, 3);

    expect(at(picks, 2, 10)).toBeLessThan(at(picks, 1, 1) * 0.1);
    // Small, but ordered and never zero: flattening late picks onto one number
    // loses the real difference between an early third and a late one.
    expect(at(picks, 3, 1)).toBeGreaterThan(at(picks, 3, 10));
    expect(at(picks, 3, 10)).toBeGreaterThan(0);
  });

  it('has no step between adjacent picks', () => {
    // A `round >= 3` short-circuit once put an 11x drop between picks 20 and 21
    // in a 10-team league, which no projected slot is precise enough to justify.
    // Reading the source by overall pick number cannot reintroduce one: round
    // boundaries in *this* league no longer mean anything to the lookup.
    const picks = build(10, 3).sort(
      (a, b) => a.round - b.round || (a.slot as number) - (b.slot as number),
    );

    for (let i = 1; i < picks.length; i++) {
      expect(picks[i - 1].marketValue / Math.max(1, picks[i].marketValue)).toBeLessThan(2);
    }
  });

  it('prices a pick deeper than the source publishes rather than at zero', () => {
    // A six-round rookie draft against a source covering three. Priced at zero,
    // those are assets the suggestion engine hands over for free.
    for (const pick of build(10, 6)) expect(pick.marketValue).toBeGreaterThan(0);
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

  it('prices a bottom team’s first well above the champion’s', () => {
    // DynastyProcess names the imminent draft by exact slot and the next one by
    // tier, so within-round differences come from these rows and nowhere else.
    const slotted: PickValueTable = {
      seasons: ['2026', '2027'],
      fetchedAt: 0,
      rows: [
        ...Array.from({ length: 12 }, (_, i) => ({
          season: '2026',
          round: 1,
          slot: i + 1,
          tier: null,
          value: 8000 - i * 600,
        })),
        { season: '2027', round: 1, slot: null, tier: 'early' as const, value: 7000 },
        { season: '2027', round: 1, slot: null, tier: 'mid' as const, value: 5500 },
        { season: '2027', round: 1, slot: null, tier: 'late' as const, value: 4000 },
      ],
    };

    // Twelve teams, so the tier buckets a season out land on distinct thirds of
    // the board. On a three-team league every slot is an early pick by overall
    // number, and correctly so — the supply of NFL talent does not shrink
    // because your league is small.
    const twelve = makeLeague(
      Array.from({ length: 12 }, (_, i) => makeRoster(i + 1, [])),
      makeSettings(['QB', 'WR'], { draftRounds: 1 }),
    );
    const order = Array.from({ length: 12 }, (_, i) => 12 - i);

    // Same round, same season — the only difference is who it came from.
    const picks = buildDraftPicks(twelve, [], ['2026', '2027'], slotted, order);
    const worst = picks.find((p) => p.id === '2026-1-12');
    const best = picks.find((p) => p.id === '2026-1-1');

    expect(worst!.slot).toBe(1);
    expect(best!.slot).toBe(12);
    expect(worst!.marketValue).toBe(8000);
    expect(best!.marketValue).toBe(1400);

    // A season out, the same ordering survives through the tier buckets.
    expect(picks.find((p) => p.id === '2027-1-12')!.marketValue).toBe(7000);
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

describe('published draft order', () => {
  /** Roster 1 picks third, roster 3 picks first — nothing like a strength order. */
  const order: KnownDraftOrder = {
    season: '2026',
    slots: new Map([
      [3, 1],
      [2, 2],
      [1, 3],
    ]),
    snake: false,
  };

  const slotted: PickValueTable = {
    seasons: ['2026'],
    fetchedAt: 0,
    rows: [
      { season: '2026', round: 1, slot: 1, tier: null, value: 8000 },
      { season: '2026', round: 1, slot: 2, tier: null, value: 6000 },
      { season: '2026', round: 1, slot: 3, tier: null, value: 4500 },
    ],
  };

  it('uses the published order rather than the projection', () => {
    // The projection is handed the exact opposite order, so a pick priced off
    // the published one cannot have come from anywhere else.
    const picks = buildDraftPicks(league, [], ['2026'], slotted, [1, 2, 3], 1, [order]);

    expect(picks.find((p) => p.id === '2026-1-3')!.slot).toBe(1);
    expect(picks.find((p) => p.id === '2026-1-1')!.slot).toBe(3);
    expect(picks.find((p) => p.id === '2026-1-3')!.marketValue).toBe(8000);
  });

  it('marks a published slot as known and a projected one as not', () => {
    const picks = buildDraftPicks(league, [], ['2026', '2027'], slotted, [1, 2, 3], 1, [order]);

    expect(picks.find((p) => p.id === '2026-1-1')!.slotKnown).toBe(true);
    expect(picks.find((p) => p.id === '2027-1-1')!.slotKnown).toBe(false);
  });

  it('names the slot on the pick, and says when it is only projected', () => {
    // Value swings ninefold inside a round, so which slot it is belongs in the
    // pick's name rather than being inferred from the number beside it.
    const picks = buildDraftPicks(league, [], ['2026', '2027'], slotted, [1, 2, 3], 1, [order]);

    expect(picks.find((p) => p.id === '2026-1-1')!.label).toBe('2026 1st (1.03)');
    expect(picks.find((p) => p.id === '2027-1-1')!.label).toBe('2027 1st (proj 1.01)');
  });

  it('keeps the via-team note alongside the slot', () => {
    const traded = [{ season: '2026', round: 1, originalRosterId: 3, ownerRosterId: 1 }];
    const picks = buildDraftPicks(league, traded, ['2026'], slotted, [1, 2, 3], 1, [order]);

    expect(picks.find((p) => p.id === '2026-1-3')!.label).toBe('2026 1st (1.01, via Team 3)');
  });

  it('falls back to the projection for a season with no published draft', () => {
    // Sleeper only has a draft for the coming year; 2027 is still a guess.
    const picks = buildDraftPicks(league, [], ['2027'], slotted, [3, 2, 1], 1, [order]);

    expect(picks.find((p) => p.id === '2027-1-3')!.slot).toBe(1);
    expect(picks.find((p) => p.id === '2027-1-3')!.slotKnown).toBe(false);
  });

  it('prices a snake second round from the reversed slot', () => {
    // Twelve teams, because in a three-team league every pick in the first two
    // rounds sits on the flat top of the realism curve and the reversal cannot
    // show up in the price at all.
    const big = makeLeague(
      Array.from({ length: 12 }, (_, i) => makeRoster(i + 1, [])),
      makeSettings(['QB', 'WR'], { draftRounds: 2 }),
    );
    const straight: KnownDraftOrder = {
      season: '2026',
      slots: new Map(Array.from({ length: 12 }, (_, i) => [i + 1, i + 1])),
      snake: false,
    };

    // Roster 1 holds 1.01: it picks last in round two under snake, first under
    // linear. Pricing its second as though it picked first overstates it badly.
    const snake = buildDraftPicks(big, [], ['2026'], bySlot, [], 1, [
      { ...straight, snake: true },
    ]);
    const linear = buildDraftPicks(big, [], ['2026'], bySlot, [], 1, [straight]);

    const snakeSecond = snake.find((p) => p.id === '2026-2-1')!;
    const linearSecond = linear.find((p) => p.id === '2026-2-1')!;

    expect(snakeSecond.label).toBe('2026 2nd (2.12)');
    expect(linearSecond.label).toBe('2026 2nd (2.01)');
    expect(snakeSecond.marketValue).toBeLessThan(linearSecond.marketValue);

    // Round one is identical either way — only the even rounds reverse.
    expect(snake.find((p) => p.id === '2026-1-1')!.marketValue).toBe(
      linear.find((p) => p.id === '2026-1-1')!.marketValue,
    );
  });
});

describe('overallPickNumber', () => {
  it('repeats the order every round when linear', () => {
    expect(overallPickNumber(1, 1, 10, false)).toBe(1);
    expect(overallPickNumber(2, 1, 10, false)).toBe(11);
    expect(overallPickNumber(3, 10, 10, false)).toBe(30);
  });

  it('reverses the even rounds when snake', () => {
    expect(overallPickNumber(1, 1, 10, true)).toBe(1);
    expect(overallPickNumber(2, 1, 10, true)).toBe(20);
    expect(overallPickNumber(2, 10, 10, true)).toBe(11);
    expect(overallPickNumber(3, 1, 10, true)).toBe(21);
  });
});
