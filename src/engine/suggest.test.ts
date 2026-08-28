import { describe, expect, it } from 'vitest';
import {
  WINDOW_WEIGHTS,
  movableAssets,
  suggestTrades,
  windowWeights,
  type SuggestContext,
} from './suggest';
import type { RoleTrend, RoleTrends } from './roleTrend';
import { analyzeTeam, type ContentionProfile } from './analysis';
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

/** The same league, plus a bench receiver too cheap to register as surplus. */
const WITH_BENCH: Spec[] = COMPLEMENTARY.map((spec) =>
  spec.rosterId === 1
    ? { ...spec, players: [...spec.players, ['wr3', 'WR', 300, 24] as Spec['players'][number]] }
    : spec,
);

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

/**
 * A role trend, as `roleTrend.ts` would have produced it.
 *
 * Built by hand rather than run through `roleTrends` so these tests are about
 * what the suggestion engine does with a trend, not about how one is detected.
 */
function trend(
  ctx: SuggestContext,
  playerId: string,
  rosterId: number,
  gap: number,
  overrides: Partial<RoleTrend> = {},
): RoleTrend {
  return {
    player: ctx.players.get(playerId) as Player,
    rosterId,
    gap,
    base: 1000,
    factor: gap > 0 ? 1.1 : 0.9,
    games: 5,
    reasons: [{ label: 'snaps', from: 0.35, to: 0.7 }],
    thin: false,
    // Clearing the headroom gate is what puts a row on a list at all, so a
    // hand-built trend has to look like one that did: role ranked above price
    // on the buy side, below it on the sell side.
    pricing:
      gap > 0
        ? { role: 0.8, price: 0.4, headroom: 0.4 }
        : { role: 0.4, price: 0.8, headroom: -0.4 },
    ...overrides,
  };
}

const trends = (buyLow: RoleTrend[], sellHigh: RoleTrend[] = []): RoleTrends => ({
  buyLow,
  sellHigh,
  applied: true,
});

describe('movableAssets with role trends', () => {
  it('offers a starter whose price has outlived his role', () => {
    // t1_wr1 is a 25-year-old starter on a juggernaut: not surplus, not past an
    // age cliff, and so invisible to every existing rule. Selling high is the
    // one reason a manager would move him, which is exactly the gap R7 fills.
    const base = world(COMPLEMENTARY, 1200);
    const ctx: SuggestContext = {
      ...base,
      trends: trends([], [trend(base, 't1_wr1', 1, -400)]),
    };
    const summary = ctx.summaries.find((s) => s.rosterId === 1) as RosterSummary;
    const analysis = analyzeTeam(1, ctx.summaries, settings);

    expect(movableAssets(analysis!, summary, base, 8).map((a) => a.id)).not.toContain('t1_wr1');
    expect(movableAssets(analysis!, summary, ctx, 8).map((a) => a.id)).toContain('t1_wr1');
  });

  it('offers a benched riser the surplus test misses', () => {
    // The surplus test is a *value* test — it asks who would out-rank a weakest
    // starter elsewhere. t1_wr3 is worth 300 and clears nobody, so he is not
    // surplus; a role that has grown while his price has not is precisely the
    // case that test cannot see.
    const base = world(WITH_BENCH, 1200);
    const ctx: SuggestContext = { ...base, trends: trends([trend(base, 't1_wr3', 1, 250)]) };
    const summary = ctx.summaries.find((s) => s.rosterId === 1) as RosterSummary;
    const analysis = analyzeTeam(1, ctx.summaries, settings);

    expect(analysis!.surpluses.map((s) => s.player.id)).not.toContain('t1_wr3');
    expect(movableAssets(analysis!, summary, base, 8).map((a) => a.id)).not.toContain('t1_wr3');
    expect(movableAssets(analysis!, summary, ctx, 8).map((a) => a.id)).toContain('t1_wr3');
  });

  it('will not sell a riser who is already in the lineup', () => {
    // Nobody trades away the back who just took over their backfield. That he
    // is underpriced is the *acquiring* side's edge, not a reason his manager
    // parts with him.
    const base = world(COMPLEMENTARY, 1200);
    const ctx: SuggestContext = { ...base, trends: trends([trend(base, 't1_wr1', 1, 400)]) };
    const summary = ctx.summaries.find((s) => s.rosterId === 1) as RosterSummary;
    const analysis = analyzeTeam(1, ctx.summaries, settings);

    expect(summary.starterIds.has('t1_wr1')).toBe(true);
    expect(movableAssets(analysis!, summary, ctx, 8).map((a) => a.id)).not.toContain('t1_wr1');
  });
});

describe('suggestTrades', () => {
  it('states the role evidence behind an incoming player', () => {
    const base = world(COMPLEMENTARY, 1200);
    const ctx: SuggestContext = { ...base, trends: trends([trend(base, 't2_rb', 2, 620)]) };

    const { trades } = suggestTrades(1, ctx);
    const acquiring = trades.find((t) => t.get.some((a) => a.id === 't2_rb'));

    expect(acquiring).toBeDefined();
    const line = acquiring!.rationale.find((l) => l.includes('playing more than his price'));
    // The claim is worthless without the sample behind it: a usage number with
    // no games attached is not something anyone should trade on.
    expect(line).toContain('70% snaps, up from 35% over 5 games');
    expect(line).toContain('620');
  });

  it('caveats a trend drawn from a short window', () => {
    const base = world(COMPLEMENTARY, 1200);
    const ctx: SuggestContext = {
      ...base,
      trends: trends([trend(base, 't2_rb', 2, 620, { games: 3, thin: true })]),
    };

    const { trades } = suggestTrades(1, ctx);
    const acquiring = trades.find((t) => t.get.some((a) => a.id === 't2_rb'));

    expect(acquiring!.rationale.some((l) => l.includes('a short window'))).toBe(true);
  });

  it('is unchanged when no trend data is available at all', () => {
    // The static activity files are allowed to fail to load, and a league that
    // cannot value a role change must still be able to suggest a trade.
    const ctx = world(COMPLEMENTARY, 1200);

    expect(suggestTrades(1, { ...ctx, trends: undefined }).trades.map((t) => t.id)).toEqual(
      suggestTrades(1, ctx).trades.map((t) => t.id),
    );
  });

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

describe('windowWeights', () => {
  const profile = (
    nowShare: number,
    youthShare: number,
    season: ContentionProfile['season'] = null,
  ): ContentionProfile => ({
    nowScore: 0,
    futureScore: 0,
    nowRank: 1,
    futureRank: 1,
    retainedShare: 1,
    teamCount: 10,
    nowShare,
    youthShare,
    quadrant: 'danger',
    label: '',
    advice: '',
    season,
  });

  /** A season signal at a chosen point of a 14-week regular season. */
  const outlook = (playoffOdds: number, weeksPlayed: number): ContentionProfile['season'] => ({
    playoffOdds,
    weeksPlayed,
    weeksTotal: 14,
    weeksLeft: 14 - weeksPlayed,
    weight: weeksPlayed / 14,
    conviction: (weeksPlayed / 14) * Math.abs(playoffOdds - 0.5) * 2,
  });

  it('reproduces the quadrant table exactly at the corners', () => {
    // The continuous form must not quietly re-tune the model. An unambiguous
    // juggernaut and an unambiguous danger-zone team are scored precisely as
    // they were; only the ground between them changes.
    expect(windowWeights(profile(1, 1)).now).toBeCloseTo(WINDOW_WEIGHTS.juggernaut.now, 10);
    expect(windowWeights(profile(1, 0)).now).toBeCloseTo(WINDOW_WEIGHTS.win_now.now, 10);
    expect(windowWeights(profile(0, 1)).now).toBeCloseTo(WINDOW_WEIGHTS.rebuilding.now, 10);
    expect(windowWeights(profile(0, 0)).now).toBeCloseTo(WINDOW_WEIGHTS.danger.now, 10);
  });

  it('gives a mid-table team a balanced window instead of a rebuild mandate', () => {
    /**
     * The regression. Reading the quadrant alone, the sixth-placed roster in a
     * ten-team league was weighted 0.35 on the present and the fifth-placed one
     * 0.9 — a two-and-a-half-fold difference between two teams a few percent
     * apart. Nothing about them justifies it, and it decided which trades each
     * was offered.
     */
    const middle = windowWeights(profile(0.5, 0.5));

    expect(middle.now).toBeCloseTo(0.575, 10);
    expect(middle.now + middle.future).toBeCloseTo(1, 10);

    // And the step across the median is gone: two teams either side of it are
    // now weighted almost identically.
    const justAbove = windowWeights(profile(0.55, 0.5)).now;
    const justBelow = windowWeights(profile(0.45, 0.5)).now;
    expect(Math.abs(justAbove - justBelow)).toBeLessThan(0.08);
  });

  it('still weights the present more the stronger a roster is', () => {
    // Monotone in strength at every age, or the quadrant labels would describe
    // an ordering the weights do not follow.
    for (const youth of [0, 0.5, 1]) {
      expect(windowWeights(profile(0.8, youth)).now).toBeGreaterThan(
        windowWeights(profile(0.2, youth)).now,
      );
    }
  });

  it('is not monotone in age at the bottom, exactly as the table is not', () => {
    // A strong roster gets more of its score from the present the older it is:
    // that is what a closing window means. A *weak* one does not, because the
    // anti-tanking floor holds the danger zone at 0.35 while a rebuilder sits
    // at 0.4 — an old bad team has less reason to chase this year than a young
    // bad team has to stay watchable. Interpolation inherits that shape rather
    // than smoothing it away, and this pins the inheritance.
    expect(windowWeights(profile(1, 0)).now).toBeGreaterThan(windowWeights(profile(1, 1)).now);
    expect(windowWeights(profile(0, 0)).now).toBeLessThan(windowWeights(profile(0, 1)).now);
  });

  it('never drops the present below the anti-tanking floor', () => {
    for (let strong = 0; strong <= 1.0001; strong += 0.1) {
      for (let young = 0; young <= 1.0001; young += 0.1) {
        expect(windowWeights(profile(Math.min(strong, 1), Math.min(young, 1))).now)
          .toBeGreaterThanOrEqual(0.35);
      }
    }
  });

  /*
    #66, one layer below the advice. A roster that grades as a contender and
    whose season is mathematically gone was weighted 0.9 on the present, so the
    engine recommended it buy. The weights and the advice read the same signal
    off the same object precisely so they cannot disagree about this.
  */
  it('stops weighting the present for a contender whose season is gone', () => {
    const paper = windowWeights(profile(1, 0)).now;
    const dead = windowWeights(profile(1, 0, outlook(0.04, 10))).now;

    expect(paper).toBeCloseTo(WINDOW_WEIGHTS.win_now.now, 10);
    expect(dead).toBeLessThan(paper);
    // Pulled most of the way to the danger-zone corner, not merely nudged.
    expect(dead).toBeLessThan(0.6);
  });

  it('keeps weighting the present for a rebuilder whose season is live', () => {
    const paper = windowWeights(profile(0, 1)).now;
    const live = windowWeights(profile(0, 1, outlook(0.92, 10))).now;

    expect(paper).toBeCloseTo(WINDOW_WEIGHTS.rebuilding.now, 10);
    expect(live).toBeGreaterThan(paper);
  });

  it('ignores the odds before a game has been played', () => {
    // Week zero: the simulation is a restatement of roster strength, so
    // blending it in would count the same projection twice.
    const preseason = windowWeights(profile(1, 0, outlook(0.5, 0))).now;
    expect(preseason).toBeCloseTo(WINDOW_WEIGHTS.win_now.now, 10);
  });

  it('moves continuously as the season goes on', () => {
    // No week may be a cliff, which is the same property the bilinear form
    // exists to give the quadrant.
    const at = (week: number) => windowWeights(profile(1, 0, outlook(0.04, week))).now;
    for (let week = 1; week <= 14; week++) {
      expect(at(week)).toBeLessThan(at(week - 1));
      expect(Math.abs(at(week) - at(week - 1))).toBeLessThan(0.06);
    }
  });

  it('never leaves the range the quadrant table defines', () => {
    // The floor and ceiling of the table are `danger` (0.35) and `win_now`
    // (0.9) — not `juggernaut`, which sits inside them at 0.65 because a team
    // that is strong *and* young can afford to care about both.
    const corners = Object.values(WINDOW_WEIGHTS).map((w) => w.now);
    const floor = Math.min(...corners);
    const ceiling = Math.max(...corners);

    for (const odds of [0, 0.25, 0.5, 0.75, 1]) {
      for (const week of [0, 7, 14]) {
        for (const strong of [0, 0.5, 1]) {
          const now = windowWeights(profile(strong, 0.5, outlook(odds, week))).now;
          expect(now).toBeGreaterThanOrEqual(floor - 1e-9);
          expect(now).toBeLessThanOrEqual(ceiling + 1e-9);
        }
      }
    }
  });
});