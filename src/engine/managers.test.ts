import { describe, expect, it } from 'vitest';
import type {
  LeagueTransaction,
  SeasonManager,
  TransactionHistory,
  TransactionType,
} from '../platforms/types';
import {
  appetite,
  appetiteFor,
  expectedTrades,
  managerFor,
  modelManagers,
  partnership,
} from './managers';

/** A season table naming exactly these managers, roster ids in order from 1. */
const owned = (...userIds: string[]): Map<number, SeasonManager> =>
  new Map<number, SeasonManager>(
    userIds.map((userId, i) => [i + 1, { userId, name: userId, teamName: userId }]),
  );

/** Four managers, stable across seasons, plus an orphan roster nobody owns. */
const TABLE = (season: string): Map<number, SeasonManager> =>
  new Map([
    [1, { userId: 'u1', name: 'Ada', teamName: 'Ada' }],
    [2, { userId: 'u2', name: 'Ben', teamName: 'Ben' }],
    [3, { userId: 'u3', name: 'Cy', teamName: `Cy ${season}` }],
    [4, { userId: 'u4', name: 'Dee', teamName: 'Dee' }],
    [9, { userId: null, name: 'Orphan team', teamName: 'Orphan team' }],
  ]);

let counter = 0;

function tx(overrides: Partial<LeagueTransaction> & { type: TransactionType }): LeagueTransaction {
  return {
    id: `t${counter++}`,
    season: '2025',
    week: 3,
    succeeded: true,
    created: counter,
    rosterIds: [],
    adds: new Map(),
    drops: new Map(),
    picks: [],
    budget: [],
    bid: null,
    ...overrides,
  };
}

const trade = (rosterIds: number[], season = '2025') =>
  tx({ type: 'trade', rosterIds, season });

function history(
  transactions: LeagueTransaction[],
  seasons = ['2025'],
): TransactionHistory {
  return {
    transactions,
    seasons,
    managers: new Map(seasons.map((s) => [s, TABLE(s)])),
    truncated: false,
  };
}

describe('modelManagers', () => {
  it('counts a trade for both sides', () => {
    const model = modelManagers(history([trade([1, 2])]));

    expect(model.trades).toBe(1);
    expect(model.managers.get('u1')?.trades).toBe(1);
    expect(model.managers.get('u2')?.trades).toBe(1);
    expect(model.managers.get('u3')?.trades).toBe(0);
  });

  it('names every manager in the league, including one who has never traded', () => {
    // The whole point of seeding the roll from the season table rather than
    // from the feed: the quietest manager appears in no transaction at all.
    const model = modelManagers(history([trade([1, 2])]));

    expect([...model.managers.keys()].sort()).toEqual(['u1', 'u2', 'u3', 'u4']);
    expect(model.managers.get('u4')?.trades).toBe(0);
  });

  it('keys identity on the manager, not the roster he happened to hold', () => {
    // Ada is roster 1 in both seasons here, but the model must never be reading
    // the roster id — swapping the table proves which one it used.
    const swapped: TransactionHistory = {
      transactions: [trade([1, 2], '2024'), trade([2, 3], '2025')],
      seasons: ['2024', '2025'],
      managers: new Map([
        // In 2024 roster 1 was Cy, not Ada.
        [
          '2024',
          new Map([
            [1, { userId: 'u3', name: 'Cy', teamName: 'Cy' }],
            [2, { userId: 'u2', name: 'Ben', teamName: 'Ben' }],
          ]),
        ],
        ['2025', TABLE('2025')],
      ]),
      truncated: false,
    };

    const model = modelManagers(swapped);

    expect(model.managers.get('u3')?.trades).toBe(2);
    expect(model.managers.get('u1')?.trades).toBe(0);
  });

  it('skips a trade with an orphan team rather than guessing at it', () => {
    const model = modelManagers(history([trade([1, 9]), trade([1, 2])]));

    expect(model.trades).toBe(1);
    expect(model.unattributed).toBe(1);
    expect(model.managers.get('u1')?.trades).toBe(1);
  });

  it('ignores a failed transaction', () => {
    const model = modelManagers(
      history([tx({ type: 'trade', rosterIds: [1, 2], succeeded: false })]),
    );

    expect(model.trades).toBe(0);
  });

  it('counts a three-way trade for all three sides, and each pairing in it', () => {
    const model = modelManagers(history([trade([1, 2, 3])]));

    expect(model.trades).toBe(1);
    expect(model.managers.get('u1')?.trades).toBe(1);
    expect(model.managers.get('u1')?.partners.get('u2')?.trades).toBe(1);
    expect(model.managers.get('u1')?.partners.get('u3')?.trades).toBe(1);
  });

  it('counts wire claims from adds, and never from a drop', () => {
    const model = modelManagers(
      history([
        tx({ type: 'waiver', rosterIds: [1], adds: new Map([['p1', 1]]) }),
        tx({ type: 'free_agent', rosterIds: [1], adds: new Map([['p2', 1]]) }),
        tx({ type: 'free_agent', rosterIds: [2], drops: new Map([['p3', 2]]) }),
      ]),
    );

    expect(model.managers.get('u1')?.claims).toBe(2);
    expect(model.managers.get('u2')?.claims).toBe(0);
    // A claim is not a trade, on either side of the model.
    expect(model.trades).toBe(0);
  });

  it('counts picks acquired and spent from the sides of a trade', () => {
    const model = modelManagers(
      history([
        tx({
          type: 'trade',
          rosterIds: [1, 2],
          picks: [
            { season: '2026', round: 1, originalRosterId: 2, fromRosterId: 2, toRosterId: 1 },
          ],
        }),
      ]),
    );

    expect(model.managers.get('u1')?.picksAcquired).toBe(1);
    expect(model.managers.get('u2')?.picksSpent).toBe(1);
  });

  it('records the earliest season each manager traded in', () => {
    const model = modelManagers(
      history([trade([1, 2], '2025'), trade([1, 3], '2023')], ['2023', '2025']),
    );

    expect(model.managers.get('u1')?.firstTraded).toBe('2023');
    expect(model.managers.get('u2')?.firstTraded).toBe('2025');
    expect(model.seasons).toEqual(['2023', '2025']);
  });

  it('counts every season a manager was here, traded or not', () => {
    const model = modelManagers(history([trade([1, 2])], ['2023', '2024', '2025']));

    expect(model.managers.get('u1')?.seasons).toBe(3);
    // Dee has never traded, and three seasons of not trading is the evidence.
    expect(model.managers.get('u4')?.seasons).toBe(3);
  });

  it('names the rosters the league table gives no owner', () => {
    const model = modelManagers(history([]));

    expect([...model.orphans]).toEqual([9]);
    expect(model.rosters.has(9)).toBe(false);
  });

  it('measures the league in manager-seasons, not by headcount', () => {
    /*
      The roll used to be a headcount, so a manager who played one season of two
      and left pulled the league's rate down as hard as one who played both —
      and that rate is the denominator every other manager is measured against.
    */
    const model = modelManagers({
      transactions: [trade([1, 2], '2024'), trade([1, 2], '2025')],
      seasons: ['2024', '2025'],
      managers: new Map([
        ['2024', owned('u1', 'u2', 'gone')],
        ['2025', owned('u1', 'u2', 'u3')],
      ]),
      truncated: false,
    });

    expect(model.managers.get('gone')?.seasons).toBe(1);
    expect(model.managers.get('u1')?.seasons).toBe(2);
    // Four participations over six manager-seasons — not over four managers,
    // which would have read this league as trading half again as often.
    expect(model.tradesPerSeason).toBeCloseTo(4 / 6, 6);
  });

  it('is empty and harmless with no history at all', () => {
    const model = modelManagers(undefined);

    expect(model.trades).toBe(0);
    expect(model.meanTrades).toBe(0);
    expect(model.tradesPerSeason).toBe(0);
    expect(appetite(model, 'u1').value).toBe(1);
  });
});

describe('appetite', () => {
  it('is exactly 1.0 for everybody in a league that has never traded', () => {
    // The property the whole feature rests on: a first-season league is ranked
    // today the way it was before any of this existed.
    const model = modelManagers(history([]));

    for (const userId of model.managers.keys()) {
      const learned = appetite(model, userId);
      expect(learned.value).toBe(1);
      expect(learned.observations).toBe(0);
    }
  });

  it('rates a busy manager above a quiet one', () => {
    const trades = [
      trade([1, 2]),
      trade([1, 3]),
      trade([1, 4]),
      trade([1, 2]),
      trade([1, 3]),
      trade([2, 3]),
    ];
    const model = modelManagers(history(trades));

    const busy = appetite(model, 'u1');
    const quiet = appetite(model, 'u4');

    expect(busy.value).toBeGreaterThan(1);
    expect(quiet.value).toBeLessThan(1);
    expect(busy.observations).toBe(5);
  });

  it('gives a manager who has never traded a factor below one', () => {
    /*
      The case `learn(k / m, 1, k, c)` gets wrong: shrinking on his own count
      would weight the clearest evidence in the feed at zero and hand him 1.0.
      Here the weight comes from the league's exposure instead.
    */
    const many = Array.from({ length: 20 }, () => trade([1, 2]));
    const model = modelManagers(history(many));

    const never = appetite(model, 'u4');

    expect(never.observations).toBe(0);
    expect(never.value).toBeLessThan(1);
  });

  it('shrinks harder the less the league has traded', () => {
    // Same relative rate in both leagues; only the evidence differs. The thin
    // league's factor must sit closer to 1.0, and by nothing that looks like a
    // threshold.
    const thin = modelManagers(history([trade([1, 2]), trade([1, 3])]));
    const thick = modelManagers(
      history(Array.from({ length: 30 }, (_, i) => trade([1, 2 + (i % 3)]))),
    );

    const near = appetite(thin, 'u1').value - 1;
    const far = appetite(thick, 'u1').value - 1;

    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(near);
  });

  it('reports the manager’s own trades as the evidence, not the league’s mean', () => {
    const model = modelManagers(history([trade([1, 2]), trade([1, 3])]));

    // What the reader is shown is his count; what the weight is built from is
    // the league's exposure. They are deliberately different numbers.
    expect(appetite(model, 'u1').observations).toBe(2);
    expect(appetite(model, 'u1').weight).toBeLessThan(1);
  });

  it('is 1.0 for a manager the model has never heard of', () => {
    const model = modelManagers(history([trade([1, 2])]));

    expect(appetite(model, 'nobody').value).toBe(1);
    expect(appetite(model, null).value).toBe(1);
  });

  it('measures a manager against his own tenure, not the whole league span', () => {
    /*
      Ben and Dee have completed exactly three trades each. Ben took four
      seasons over it and Dee did it in one, having joined this year — she is
      the busiest trader in the league right now and he is its quietest.

      Against a four-season total they are the same number, and Dee was demoted
      for having arrived late: three trades against a mean of 4.5 reads as
      two-thirds of average, and the card then told her so out loud.
    */
    const veterans = ['2023', '2024', '2025'].flatMap((season) => [
      trade([1, 2], season),
      trade([1, 3], season),
    ]);
    const model = modelManagers({
      transactions: [
        ...veterans,
        ...Array.from({ length: 3 }, () => trade([1, 4], '2026')),
      ],
      seasons: ['2023', '2024', '2025', '2026'],
      managers: new Map([
        ['2023', owned('u1', 'u2', 'u3')],
        ['2024', owned('u1', 'u2', 'u3')],
        ['2025', owned('u1', 'u2', 'u3')],
        ['2026', owned('u1', 'u2', 'u3', 'u4')],
      ]),
      truncated: false,
    });

    expect(model.managers.get('u2')?.trades).toBe(3);
    expect(model.managers.get('u4')?.trades).toBe(3);
    // Thirteen manager-seasons behind eighteen participations, and Dee is
    // measured against one season of that rate rather than four.
    expect(expectedTrades(model, model.managers.get('u4')!)).toBeCloseTo(18 / 13, 6);
    expect(appetite(model, 'u4').value).toBeGreaterThan(1);
    expect(appetite(model, 'u2').value).toBeLessThan(1);
  });
});

describe('appetiteFor', () => {
  it('ranks a roster nobody owns below a manager who does answer', () => {
    /*
      An unowned team is not an unknown one. Handing it the prior ranked it at
      the league's average acceptance, which put the team that may have nobody
      reading the message above every real manager who trades below average.
    */
    const model = modelManagers(
      history([...Array.from({ length: 8 }, () => trade([1, 2])), trade([1, 3])]),
    );

    expect(appetiteFor(model, 9).value).toBeLessThan(1);
    // Cy has traded once in a league averaging four and a half. Once is more
    // than nobody.
    expect(appetiteFor(model, 9).value).toBeLessThan(appetiteFor(model, 3).value);
  });

  it('resolves an owned roster to its manager', () => {
    const model = modelManagers(history(Array.from({ length: 8 }, () => trade([1, 2]))));

    expect(appetiteFor(model, 1).value).toBe(appetite(model, 'u1').value);
  });

  it('is 1.0 for a roster this walk never saw, and in a league with no trades', () => {
    // A roster missing from the table is nothing known; an unowned one in a
    // league that has never traded has nothing to be demoted against.
    const busy = modelManagers(history(Array.from({ length: 8 }, () => trade([1, 2]))));
    const quiet = modelManagers(history([]));

    expect(appetiteFor(busy, 99).value).toBe(1);
    expect(appetiteFor(quiet, 9).value).toBe(1);
  });
});

describe('managerFor', () => {
  it('resolves a current-season roster id to its manager', () => {
    const model = modelManagers(history([trade([1, 2])]));

    expect(managerFor(model, 1)?.userId).toBe('u1');
    // The orphan roster resolves to nobody rather than to a guess.
    expect(managerFor(model, 9)).toBeNull();
  });

  it('resolves against the newest season, whatever order the map arrives in', () => {
    const model = modelManagers({
      transactions: [],
      seasons: [],
      managers: new Map([
        ['2023', new Map([[1, { userId: 'old', name: 'Old', teamName: 'Old' }]])],
        ['2026', new Map([[1, { userId: 'now', name: 'Now', teamName: 'Now' }]])],
      ]),
      truncated: false,
    });

    expect(managerFor(model, 1)?.userId).toBe('now');
  });
});

describe('partnership', () => {
  it('counts what a pair has done and flags the league’s strongest', () => {
    const model = modelManagers(
      history([trade([1, 2]), trade([1, 2]), trade([1, 2]), trade([3, 4])]),
    );

    const top = partnership(model, 'u1', 'u2');
    expect(top?.trades).toBe(3);
    expect(top?.strongest).toBe(true);

    const lesser = partnership(model, 'u3', 'u4');
    expect(lesser?.trades).toBe(1);
    expect(lesser?.strongest).toBe(false);
  });

  it('is null for a pair that has never traded, and for a manager with himself', () => {
    const model = modelManagers(history([trade([1, 2])]));

    expect(partnership(model, 'u1', 'u3')).toBeNull();
    expect(partnership(model, 'u1', 'u1')).toBeNull();
    expect(partnership(model, 'u1', null)).toBeNull();
  });

  it('dates a pair from when both had traded, not from the league’s first season', () => {
    const model = modelManagers(
      history([trade([1, 3], '2023'), trade([1, 2], '2025'), trade([1, 2], '2025')], [
        '2023',
        '2025',
      ]),
    );

    // Ada goes back to 2023, but she and Ben have only been trading since 2025.
    expect(partnership(model, 'u1', 'u2')?.since).toBe('2025');
  });

  it('dates a pair from their own first trade, not from when both had started', () => {
    /*
      Both were trading in 2023 — with other people. Taking the later of the two
      first-traded seasons dated the pair from a season they never traded in,
      and the card stated it as a fact about their shared history.
    */
    const model = modelManagers(
      history(
        [
          trade([1, 3], '2023'),
          trade([2, 4], '2023'),
          trade([1, 2], '2026'),
          trade([1, 2], '2026'),
        ],
        ['2023', '2026'],
      ),
    );

    expect(model.managers.get('u1')?.firstTraded).toBe('2023');
    expect(model.managers.get('u2')?.firstTraded).toBe('2023');
    expect(partnership(model, 'u1', 'u2')?.since).toBe('2026');
  });
});
