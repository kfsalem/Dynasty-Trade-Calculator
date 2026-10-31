import { describe, expect, it } from 'vitest';
import { tradesForPlayer, type SuggestContext, type TradeAsset } from './suggest';
import { summarizeRoster, type RosterSummary } from './rosterValue';
import type {
  DraftPick,
  LeagueSettings,
  LineupSlot,
  Player,
  PlayerValue,
  Position,
  Roster,
} from '../types';
import {
  makeLeague,
  makePick,
  makePlayer,
  makeRoster,
  makeSettings,
  makeValue,
} from './testFixtures';

/*
  The search around one player (#165). The league is `suggest.test.ts`'s
  four-team world, which holds exactly one obviously good trade — so the
  pinned search can be checked against the open search's own answer.
*/
const SLOTS: LineupSlot[] = ['QB', 'RB', 'WR'];
const settings = makeSettings(SLOTS, { teamCount: 4, draftRounds: 2 });

interface Spec {
  rosterId: number;
  /** [id suffix, position, value, age] per player. */
  players: [string, Position, number, number][];
}

function world(specs: Spec[], pickValue = 0) {
  const players = new Map<string, Player>();
  const values = new Map<string, PlayerValue>();
  const rosters: Roster[] = [];

  for (const spec of specs) {
    const ids: string[] = [];
    for (const [suffix, position, value, age] of spec.players) {
      const id = `t${spec.rosterId}_${suffix}`;
      players.set(id, makePlayer(id, position, age));
      values.set(id, makeValue(id, value));
      ids.push(id);
    }
    rosters.push(makeRoster(spec.rosterId, ids));
  }

  const league = makeLeague(rosters, settings);
  const summaries: RosterSummary[] = rosters
    .map((r) => summarizeRoster(r, players, values, settings))
    .sort((a, b) => b.starterValue - a.starterValue);

  const picks: DraftPick[] =
    pickValue > 0
      ? rosters.flatMap((roster) =>
          ['2027', '2028'].flatMap((season) =>
            [1, 2].map((round) =>
              // A 2nd is worth a third of a 1st, which is roughly the real shape.
              makePick(
                `${season}-${round}-${roster.rosterId}`,
                season,
                round,
                roster.rosterId,
                round === 1 ? pickValue : Math.round(pickValue / 3),
              ),
            ),
          ),
        )
      : [];

  const ctx: SuggestContext = { league, players, values, picks, summaries };
  return ctx;
}

const COMPLEMENTARY: Spec[] = [
  // Us: strong and young, but the WR2 is stranded and RB is a hole.
  {
    rosterId: 1,
    players: [
      ['qb', 'QB', 5000, 25],
      ['wr1', 'WR', 5000, 25],
      ['wr2', 'WR', 4000, 25],
      ['rb', 'RB', 500, 25],
    ],
  },
  // Danger zone: one real asset, and he is old.
  {
    rosterId: 2,
    players: [
      ['rb', 'RB', 4000, 29],
      ['qb', 'QB', 500, 30],
      ['wr', 'WR', 500, 30],
    ],
  },
  {
    rosterId: 3,
    players: [
      ['qb', 'QB', 3000, 24],
      ['rb', 'RB', 3000, 24],
      ['wr', 'WR', 3000, 24],
    ],
  },
  {
    rosterId: 4,
    players: [
      ['qb', 'QB', 2000, 24],
      ['rb', 'RB', 2000, 24],
      ['wr', 'WR', 2000, 24],
    ],
  },
];

const underRules = (
  ctx: SuggestContext,
  overrides: Partial<LeagueSettings>,
): SuggestContext => ({
  ...ctx,
  league: { ...ctx.league, settings: { ...ctx.league.settings, ...overrides } },
});

describe('trades built around one player (#165)', () => {
  const marketOf = (assets: TradeAsset[]) => assets.reduce((n, a) => n + a.marketValue, 0);

  it('buys: finds what his manager would take for him', () => {
    // The league's one good trade, reached from the player rather than the roster.
    const result = tradesForPlayer(1, 't2_rb', world(COMPLEMENTARY));

    expect(result.direction).toBe('buy');
    expect(result.trades.length).toBeGreaterThan(0);
    for (const trade of result.trades) {
      expect(trade.partnerRosterId).toBe(2);
      expect(trade.get.map((a) => a.id)).toContain('t2_rb');
    }
    expect(result.trades.some((t) => t.give.some((a) => a.id === 't1_wr2'))).toBe(true);
  });

  it('buys: lists the cheapest package first', () => {
    const { trades } = tradesForPlayer(1, 't2_rb', world(COMPLEMENTARY, 1200));
    const costs = trades.map((t) => marketOf(t.give));
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
  });

  it('sells: finds the rosters he helps, one best offer each', () => {
    const result = tradesForPlayer(1, 't1_wr2', world(COMPLEMENTARY, 1200));

    expect(result.direction).toBe('sell');
    expect(result.trades.length).toBeGreaterThan(0);
    const partners = result.trades.map((t) => t.partnerRosterId);
    expect(new Set(partners).size).toBe(partners.length);
    for (const trade of result.trades) expect(trade.give.map((a) => a.id)).toContain('t1_wr2');
    // Ranked by what he does for them.
    const theirs = result.trades.map((t) => t.theirBenefit.total);
    expect(theirs).toEqual([...theirs].sort((a, b) => b - a));
  });

  it('holds every package to the same bar as Trade ideas', () => {
    for (const result of [
      tradesForPlayer(1, 't2_rb', world(COMPLEMENTARY, 1200)),
      tradesForPlayer(1, 't1_wr2', world(COMPLEMENTARY, 1200)),
    ]) {
      for (const trade of result.trades) {
        expect(trade.myBenefit.total).toBeGreaterThan(0);
        expect(trade.theirBenefit.total).toBeGreaterThan(0);
        expect(trade.whyTheySayYes.length).toBeGreaterThan(0);
      }
    }
  });

  it('never spends a pick in a league that forbids trading them', () => {
    const ctx = underRules(world(COMPLEMENTARY, 1200), { pickTrading: false });
    for (const id of ['t2_rb', 't1_wr2']) {
      for (const trade of tradesForPlayer(1, id, ctx).trades) {
        expect([...trade.give, ...trade.get].every((a) => a.kind === 'player')).toBe(true);
      }
    }
  });

  it('obeys the rules that stop every search, and says which way it was asked', () => {
    const result = tradesForPlayer(
      1,
      't2_rb',
      underRules(world(COMPLEMENTARY), { tradesDisabled: true }),
    );
    expect(result.trades).toEqual([]);
    expect(result.note).toMatch(/trading switched off/);
    expect(result.direction).toBe('buy');
  });

  it('says so when he is on no roster', () => {
    const result = tradesForPlayer(1, 'nobody', world(COMPLEMENTARY));
    expect(result.trades).toEqual([]);
    expect(result.note).toMatch(/not on a roster/);
  });

  it('counts what it tried when nothing clears the bar', () => {
    // Pick trading off and no picks: our only spare is wr2, and trading it
    // for team 3's starting QB leaves team 3 without a quarterback.
    const ctx = underRules(world(COMPLEMENTARY), { pickTrading: false });
    const result = tradesForPlayer(1, 't3_qb', ctx);
    expect(result.trades).toEqual([]);
    expect(result.considered).toBeGreaterThan(0);
    expect(result.note).toMatch(/Searched \d+ packages around/);
  });
});
