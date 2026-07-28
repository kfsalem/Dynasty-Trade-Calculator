import { describe, expect, it } from 'vitest';
import { movableAssets, suggestTrades, type SuggestContext } from './suggest';
import { analyzeTeam } from './analysis';
import { summarizeRoster, type RosterSummary } from './rosterValue';
import type { DraftPick, LineupSlot, Player, PlayerValue, Position, Roster } from '../types';
import {
  makeLeague,
  makePick,
  makePlayer,
  makeRoster,
  makeSettings,
  makeValue,
} from './testFixtures';

const SLOTS: LineupSlot[] = ['QB', 'RB', 'WR'];
const settings = makeSettings(SLOTS, { teamCount: 4, draftRounds: 2 });

interface Spec {
  rosterId: number;
  /** [id suffix, position, value, age] per player. */
  players: [string, Position, number, number][];
}

/**
 * A four-team league built to contain exactly one obviously good trade.
 *
 * Team 1 (us) is a juggernaut with a stranded WR on the bench and a hole at RB.
 * Team 2 is in the danger zone with one valuable, aging RB and nothing else.
 * Those two needs are complementary, and no other pairing is.
 */
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

describe('movableAssets', () => {
  it('offers picks from a contender, since picks are what a contender spends', () => {
    const ctx = world(COMPLEMENTARY, 1200);
    const summary = ctx.summaries.find((s) => s.rosterId === 1) as RosterSummary;
    const analysis = analyzeTeam(1, ctx.summaries, settings);
    const assets = movableAssets(analysis!, summary, ctx, 5);

    expect(analysis!.contention.quadrant).toBe('juggernaut');
    expect(assets.some((a) => a.kind === 'pick')).toBe(true);
    // The stranded WR2 is surplus; the starters are not on offer.
    expect(assets.filter((a) => a.kind === 'player').map((a) => a.id)).toEqual(['t1_wr2']);
  });

  it('offers aging starters from a rebuilder, and never their picks', () => {
    const ctx = world(COMPLEMENTARY, 1200);
    const summary = ctx.summaries.find((s) => s.rosterId === 2) as RosterSummary;
    const analysis = analyzeTeam(2, ctx.summaries, settings);
    const assets = movableAssets(analysis!, summary, ctx, 5);

    expect(analysis!.contention.quadrant).toBe('danger');
    expect(assets.some((a) => a.kind === 'pick')).toBe(false);
    // RB is 29 (cliff 26) and the WR is 30 (cliff 28); the QB at 30 is not yet
    // past the QB cliff of 33, so he stays put.
    expect(assets.map((a) => a.id).sort()).toEqual(['t2_rb', 't2_wr']);
  });
});

describe('suggestTrades', () => {
  it('finds the complementary trade across contention windows', () => {
    const ctx = world(COMPLEMENTARY);
    const result = suggestTrades(1, ctx);

    expect(result.trades.length).toBeGreaterThan(0);
    const top = result.trades[0];
    expect(top.partnerRosterId).toBe(2);
    expect(top.give.map((a) => a.id)).toEqual(['t1_wr2']);
    expect(top.get.map((a) => a.id)).toEqual(['t2_rb']);
  });

  it('accepts a trade the partner loses on today, when they are rebuilding', () => {
    const ctx = world(COMPLEMENTARY);
    const top = suggestTrades(1, ctx).trades[0];

    // The whole point of the window model: their starting lineup gets worse,
    // their three-year outlook gets much better, and they take the deal.
    expect(top.theirBenefit.now).toBeLessThan(0);
    expect(top.theirBenefit.future).toBeGreaterThan(0);
    expect(top.theirBenefit.total).toBeGreaterThan(0);
  });

  it('frames a pick-less offer to a rebuilder as getting younger', () => {
    // No picks exist here, so the "collect picks" argument is unavailable and
    // the age argument has to carry the case on its own.
    const top = suggestTrades(1, world(COMPLEMENTARY)).trades[0];
    expect(top.whyTheySayYes.join(' ')).toContain('4 years younger');
  });

  it('never describes a team with a heading-cased quadrant label', () => {
    const ctx = world(COMPLEMENTARY, 1200);
    for (const trade of suggestTrades(1, ctx, { maxResults: 20 }).trades) {
      const text = [...trade.whyTheySayYes, ...trade.rationale].join(' ');
      expect(text).not.toMatch(/is (danger zone|window closing|rebuilding on schedule|juggernaut)\b/);
    }
  });

  it('requires both sides to gain', () => {
    const ctx = world(COMPLEMENTARY, 1200);
    for (const trade of suggestTrades(1, ctx, { maxResults: 20 }).trades) {
      expect(trade.myBenefit.total).toBeGreaterThan(0);
      expect(trade.theirBenefit.total).toBeGreaterThan(0);
    }
  });

  it('never offers a player out of our own starting lineup while contending', () => {
    const ctx = world(COMPLEMENTARY, 1200);
    const summary = ctx.summaries.find((s) => s.rosterId === 1) as RosterSummary;

    for (const trade of suggestTrades(1, ctx, { maxResults: 20 }).trades) {
      for (const asset of trade.give) {
        if (asset.kind === 'player') expect(summary.starterIds.has(asset.id)).toBe(false);
      }
    }
  });

  it('explains every suggestion from the other manager’s side', () => {
    const ctx = world(COMPLEMENTARY, 1200);
    const result = suggestTrades(1, ctx, { maxResults: 20 });

    expect(result.trades.length).toBeGreaterThan(0);
    for (const trade of result.trades) {
      expect(trade.whyTheySayYes.length).toBeGreaterThan(0);
      expect(trade.rationale.length).toBeGreaterThan(0);
    }
  });

  it('keeps every suggested package inside the fairness tolerance', () => {
    const ctx = world(COMPLEMENTARY, 1200);
    for (const trade of suggestTrades(1, ctx, { maxResults: 20 }).trades) {
      expect(trade.analysis.valueDifferencePct).toBeLessThanOrEqual(0.1);
    }
  });

  it('adds a pick to close a gap that players alone cannot', () => {
    // Their RB is worth 1200 more than our WR, so a straight swap is 23% off
    // and gets rejected. Our 2028 2nd is worth exactly the difference.
    const gapped: Spec[] = [
      {
        rosterId: 1,
        players: [
          ['qb', 'QB', 5000, 25],
          ['wr1', 'WR', 5000, 25],
          ['wr2', 'WR', 4000, 25],
          ['rb', 'RB', 500, 25],
        ],
      },
      {
        rosterId: 2,
        players: [
          ['rb', 'RB', 5200, 29],
          ['qb', 'QB', 500, 30],
          ['wr', 'WR', 500, 30],
        ],
      },
      COMPLEMENTARY[2],
      COMPLEMENTARY[3],
    ];

    const withoutPicks = suggestTrades(1, world(gapped));
    expect(withoutPicks.trades).toHaveLength(0);
    expect(withoutPicks.note).toContain("didn't load");

    const withPicks = suggestTrades(1, world(gapped, 3600));
    const swap = withPicks.trades.find(
      (t) => t.get.length === 1 && t.get[0].id === 't2_rb',
    );

    expect(swap).toBeDefined();
    expect(swap!.give.map((a) => a.id)).toEqual(['t1_wr2', '2027-2-1']);
    expect(swap!.analysis.valueDifferencePct).toBeLessThanOrEqual(0.1);
  });

  it('drops offers too small to be worth proposing', () => {
    const ctx = world(COMPLEMENTARY, 1200);

    // Every side must gain at least this share of its own starting value.
    const strict = suggestTrades(1, ctx, { minBenefitShare: 0.5, maxResults: 20 });
    expect(strict.trades).toHaveLength(0);
    expect(strict.note).toContain('too small');

    const normal = suggestTrades(1, ctx, { maxResults: 20 });
    expect(normal.trades.length).toBeGreaterThan(0);
    for (const trade of normal.trades) {
      const [mySide, theirSide] = trade.analysis.sides;
      expect(trade.myBenefit.total).toBeGreaterThanOrEqual(
        mySide.starterValueBefore * 0.005,
      );
      expect(trade.theirBenefit.total).toBeGreaterThanOrEqual(
        theirSide.starterValueBefore * 0.005,
      );
    }
  });

  it('collapses one swap balanced several ways into a single idea', () => {
    const ctx = world(COMPLEMENTARY, 1200);
    const seen = new Set<string>();

    for (const trade of suggestTrades(1, ctx, { maxResults: 20 }).trades) {
      const players = (assets: typeof trade.give) =>
        assets.filter((a) => a.kind === 'player').map((a) => a.id).sort().join(',');
      const key = `${trade.partnerRosterId}:${players(trade.give)}>${players(trade.get)}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('spreads suggestions across partners rather than one team’s variations', () => {
    const ctx = world(COMPLEMENTARY, 1200);
    const result = suggestTrades(1, ctx, { maxResults: 20, perPartner: 1 });
    const partners = result.trades.map((t) => t.partnerRosterId);

    expect(new Set(partners).size).toBe(partners.length);
  });

  it('reports how many packages it searched, and why none worked', () => {
    // One team, alone, with nothing to trade against.
    const ctx = world([COMPLEMENTARY[0]]);
    const result = suggestTrades(1, ctx);

    expect(result.trades).toHaveLength(0);
    expect(result.considered).toBe(0);
    expect(result.note).toBeTruthy();
  });

  it('says so plainly when a roster has nothing spare', () => {
    const lean: Spec[] = [
      {
        rosterId: 1,
        players: [
          ['qb', 'QB', 100, 25],
          ['rb', 'RB', 100, 25],
          ['wr', 'WR', 100, 25],
        ],
      },
      COMPLEMENTARY[2],
      COMPLEMENTARY[3],
    ];

    const result = suggestTrades(1, world(lean));
    expect(result.trades).toHaveLength(0);
    expect(result.note).toContain('Nothing on your roster is spare');
  });

  it('returns nothing for a roster that is not in the league', () => {
    const result = suggestTrades(99, world(COMPLEMENTARY));
    expect(result.trades).toHaveLength(0);
    expect(result.note).toContain('no longer in this league');
  });
});
