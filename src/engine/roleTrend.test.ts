import { describe, expect, it } from 'vitest';
import type { Player, PlayerValue } from '../types';
import type { RosterSummary } from './rosterValue';
import type { SnapShare } from './snapShare';
import { activityFactor, roleShift } from './activityFactor';
import { MIN_GAMES, MIN_HEADROOM, MIN_SHARE, roleTrends, trendsForRoster } from './roleTrend';
import { makePlayer, makeValue } from './testFixtures';

/** First argument is the prior window; `season` spans both and is display-only. */
const snaps = (prior: number, recent: number, recentGames = 4): SnapShare => ({
  season: (8 * prior + 4 * recent) / 12,
  recent,
  prior,
  delta: recent - prior,
  games: 12,
  recentGames,
  priorGames: 8,
});

/**
 * The rest of the position, so a percentile means something.
 *
 * `rolePricing` ranks a player's role against his price *within his position*,
 * and a pool of one or two players has no ranks to speak of — everyone comes out
 * at 0 or 1 and the headroom gate answers on noise. So every fixture gets a
 * background ladder of backs nobody rosters, priced and used **in step**: the
 * cheapest plays least, the dearest plays most.
 *
 * In step is the important part. It makes the background perfectly, boringly
 * fairly priced, so a subject's headroom is entirely a statement about the
 * subject. A test player at the 30th percentile of price who plays like the 75th
 * has +0.45 of headroom because of where he sits, not because of how the
 * scenery was arranged.
 */
const BACKGROUND = 21;

function background(): { values: Map<string, PlayerValue>; snaps: Map<string, SnapShare> } {
  const values = new Map<string, PlayerValue>();
  const snapMap = new Map<string, SnapShare>();

  for (let i = 0; i < BACKGROUND; i++) {
    const at = i / (BACKGROUND - 1);
    const id = `bg${i}`;
    values.set(id, makeValue(id, 200 + at * 8800, 'RB'));
    // Flat: background players are scenery, and a mover among them would show
    // up in the lists beside the subject under test.
    const share = 0.1 + at * 0.8;
    snapMap.set(id, snaps(share, share));
  }

  return { values, snaps: snapMap };
}

/**
 * One roster of players, each with a value and an optional snap move.
 *
 * Ages are 29 by default: the age weight is near its ceiling there, so a given
 * snap move produces a factor large enough that these tests are about the
 * ranking rather than about whether anything cleared the floor at all.
 */
function league(
  players: { id: string; value: number; move?: [from: number, to: number, games?: number]; age?: number }[],
  rosterId = 1,
) {
  const { values, snaps: snapMap } = background();
  const entries: RosterSummary['players'] = [];

  for (const p of players) {
    const player: Player = makePlayer(p.id, 'RB', p.age ?? 29);
    values.set(p.id, makeValue(p.id, p.value, 'RB'));
    entries.push({ player, value: p.value, marketValue: p.value, valued: true });
    if (p.move) snapMap.set(p.id, snaps(p.move[0], p.move[1], p.move[2]));
  }

  const summary = { rosterId, players: entries } as RosterSummary;
  return { summaries: [summary], values, snaps: snapMap };
}

describe('roleTrends', () => {
  it('splits risers from fallers', () => {
    const { summaries, values, snaps } = league([
      { id: 'up', value: 3000, move: [0.3, 0.7] },
      { id: 'down', value: 3000, move: [0.7, 0.3] },
      { id: 'flat', value: 3000 },
    ]);

    const trends = roleTrends({ summaries, values, snaps, current: true });

    expect(trends.buyLow.map((t) => t.player.id)).toEqual(['up']);
    expect(trends.sellHigh.map((t) => t.player.id)).toEqual(['down']);
    expect(trends.buyLow[0].gap).toBeGreaterThan(0);
    expect(trends.sellHigh[0].gap).toBeLessThan(0);
  });

  it('ranks by value points rather than by percentage', () => {
    // The whole point of the list. A 20% move on a bench body is a bigger
    // percentage and a smaller opportunity than a modest move on a starter,
    // and a list that leads with the bench body is one nobody acts on.
    //
    // Both subjects clear the headroom gate on purpose — this test is about
    // what orders the survivors, and it would prove nothing if the gate were
    // quietly doing the ordering.
    const { summaries, values, snaps } = league([
      { id: 'star', value: 6000, move: [0.55, 0.85] },
      { id: 'scrub', value: 300, move: [0.1, 0.9] },
    ]);

    const trends = roleTrends({ summaries, values, snaps, current: true });

    expect(trends.buyLow.map((t) => t.player.id)).toEqual(['star', 'scrub']);
    // ...even though the scrub moved much further in share and in percent.
    expect(trends.buyLow[1].factor).toBeGreaterThan(trends.buyLow[0].factor);
    for (const trend of trends.buyLow) {
      expect(trend.pricing.headroom).toBeGreaterThanOrEqual(MIN_HEADROOM);
    }
  });

  it('drops a rise that his price has already accounted for', () => {
    /**
     * The Gibbs case, and the reason this gate exists.
     *
     * Jahmyr Gibbs went from 64% of the snaps to 76% over the last month of
     * 2025 — a real move, correctly detected. He is also the second-most
     * expensive asset in dynasty football, and no reading of the market has it
     * failing to notice that he is a workhorse. The old list ranked him its
     * largest buy-low anyway, because it compared him only against himself.
     *
     * `priced` here is the shape: top of the position on price, top of the
     * position on usage, rising. `underpriced` moved by exactly the same amount
     * from exactly the same place, and costs a fraction as much.
     */
    const { summaries, values, snaps } = league([
      { id: 'priced', value: 9500, move: [0.64, 0.76] },
      { id: 'underpriced', value: 2000, move: [0.64, 0.76] },
    ]);

    const trends = roleTrends({ summaries, values, snaps, current: true });

    expect(trends.buyLow.map((t) => t.player.id)).toEqual(['underpriced']);
    // And not because the move went unnoticed — it is the same move, and on the
    // more expensive player it is worth far more value points. Points alone is
    // precisely the ranking that gets this wrong.
    const priced = roleShift(makePlayer('priced', 'RB', 29), { snaps: snaps.get('priced') });
    expect(priced.factor).toBeGreaterThan(1);
  });

  it('drops a fall on a player nobody was overpaying for', () => {
    // The mirror. A cheap back losing snaps is not a sell-high, because there
    // is no high to sell into — his price already says what he is.
    const { summaries, values, snaps } = league([
      { id: 'expensive', value: 7000, move: [0.8, 0.45] },
      { id: 'already_cheap', value: 400, move: [0.8, 0.45] },
    ]);

    const trends = roleTrends({ summaries, values, snaps, current: true });

    expect(trends.sellHigh.map((t) => t.player.id)).toEqual(['expensive']);
  });

  it('needs one metric to have moved as far as the roster column demands', () => {
    /**
     * The panel and the snap column have to agree about what a move is.
     *
     * `SnapShareCell` draws its arrow at `MATERIAL_DELTA` — ten share points,
     * "roughly a rotational back going from a third of the work to half". Below
     * that the list was still happy to make a finding: Ja'Marr Chase appeared as
     * a sell-high on a five-point snap dip with flat targets, while the column
     * beside him showed nothing at all.
     *
     * The bar reads the *largest* single metric rather than the average
     * `roleShift` prices on. Averaging is right for a factor — snaps and usage
     * are two views of one change — but it buries a real move in one column
     * under a flat one beside it, which is Jonathan Taylor going 73% to 85% of
     * the carries on unchanged snaps.
     */
    const { summaries, values, snaps } = league([
      { id: 'noise', value: 2000, move: [0.5, 0.58] },
      { id: 'real', value: 2000, move: [0.5, 0.65] },
    ]);

    const trends = roleTrends({ summaries, values, snaps, current: true });

    expect(trends.buyLow.map((t) => t.player.id)).toEqual(['real']);
    // Not because the small move failed the value threshold — it clears it
    // comfortably, which is exactly why a second bar was needed.
    const priced = roleShift(makePlayer('noise', 'RB', 29), { snaps: snaps.get('noise') });
    expect(Math.abs(priced.factor - 1)).toBeGreaterThan(MIN_SHARE);
  });

  it('reports where role and price rank, so a row can justify itself', () => {
    const { summaries, values, snaps } = league([
      { id: 'up', value: 2000, move: [0.3, 0.8] },
    ]);

    const [trend] = roleTrends({ summaries, values, snaps, current: true }).buyLow;

    expect(trend.pricing.role).toBeGreaterThan(trend.pricing.price);
    expect(trend.pricing.headroom).toBeCloseTo(trend.pricing.role - trend.pricing.price, 10);
  });

  it('says nothing about a player it cannot rank', () => {
    // No snap data means no role percentile, so there is no way to know whether
    // the price already reflects him. Silence beats a guess.
    const { summaries, values, snaps } = league([
      { id: 'up', value: 2000, move: [0.3, 0.8] },
    ]);
    snaps.delete('up');

    expect(roleTrends({ summaries, values, snaps, current: true }).buyLow).toEqual([]);
  });

  it('excludes a trend with too few games to mean anything', () => {
    // Two games is a game script, not a role change.
    const { summaries, values, snaps } = league([
      { id: 'noise', value: 3000, move: [0.2, 0.9, MIN_GAMES - 1] },
    ]);

    expect(roleTrends({ summaries, values, snaps, current: true }).buyLow).toEqual([]);
  });

  it('flags a short window rather than hiding it', () => {
    const { summaries, values, snaps } = league([
      { id: 'thin', value: 3000, move: [0.3, 0.7, MIN_GAMES] },
      { id: 'full', value: 3000, move: [0.3, 0.7, 4] },
    ]);

    const byId = new Map(
      roleTrends({ summaries, values, snaps, current: true }).buyLow.map((t) => [
        t.player.id,
        t,
      ]),
    );

    expect(byId.get('thin')!.thin).toBe(true);
    expect(byId.get('full')!.thin).toBe(false);
    // Thin still counts for less, because confidence already discounted it.
    expect(byId.get('thin')!.gap).toBeLessThan(byId.get('full')!.gap);
  });

  it('does not double-count a gap already inside the value', () => {
    // In season `value` is market x replacement x factor, so recovering the
    // base means dividing the factor back out. Adding the gap to the base has
    // to land exactly on the value the rest of the app is showing.
    const { summaries, values, snaps } = league([{ id: 'up', value: 3000, move: [0.3, 0.7] }]);

    const [trend] = roleTrends({ summaries, values, snaps, current: true }).buyLow;

    expect(trend.base + trend.gap).toBeCloseTo(3000, 6);
    expect(trend.base).toBeLessThan(3000);
  });

  it('previews the gap out of season, where nothing was applied to the value', () => {
    // The role change is real and worth showing; what is not true in July is
    // that it is already in the price. So the value *is* the base, and the gap
    // is what the change would be worth rather than what it already was.
    const { summaries, values, snaps } = league([{ id: 'up', value: 3000, move: [0.3, 0.7] }]);

    const preview = roleTrends({ summaries, values, snaps, current: false });
    const live = roleTrends({ summaries, values, snaps, current: true });

    expect(preview.applied).toBe(false);
    expect(live.applied).toBe(true);
    expect(preview.buyLow[0].base).toBe(3000);
    // Same evidence and same multiplier either way — only the arithmetic that
    // turns it into points differs.
    expect(preview.buyLow[0].factor).toBe(live.buyLow[0].factor);
    expect(preview.buyLow[0].reasons).toEqual(live.buyLow[0].reasons);
  });

  it('agrees with the multiplier valuation actually applied', () => {
    // If these ever drifted, a row would claim an edge the value never had.
    const { summaries, values, snaps } = league([{ id: 'up', value: 3000, move: [0.3, 0.7] }]);
    const [trend] = roleTrends({ summaries, values, snaps, current: true }).buyLow;

    const applied = activityFactor(makePlayer('up', 'RB', 29), {
      snaps: snaps.get('up'),
      current: true,
    });

    expect(trend.factor).toBe(applied.factor);
    expect(trend.games).toBe(applied.games);
  });

  it('carries the evidence behind each entry', () => {
    const { summaries, values, snaps } = league([{ id: 'up', value: 3000, move: [0.35, 0.7, 5] }]);
    const [trend] = roleTrends({ summaries, values, snaps, current: true }).buyLow;

    expect(trend.reasons[0]).toEqual({ label: 'snaps', from: 0.35, to: 0.7 });
    expect(trend.games).toBe(5);
  });

  it('is empty, not broken, when there is no activity data at all', () => {
    const { summaries, values } = league([{ id: 'a', value: 3000 }]);
    const trends = roleTrends({ summaries, values, current: false });

    expect(trends).toEqual({ buyLow: [], sellHigh: [], applied: false });
  });

  it('caps each list independently', () => {
    const players = Array.from({ length: 12 }, (_, i) => ({
      id: `up${i}`,
      value: 1000 + i * 100,
      move: [0.3, 0.7] as [number, number],
    }));
    const { summaries, values, snaps } = league(players);

    expect(roleTrends({ summaries, values, snaps, current: true, limit: 5 }).buyLow).toHaveLength(5);
  });
});

describe('trendsForRoster', () => {
  it('narrows both lists to one team', () => {
    const a = league([{ id: 'a_up', value: 3000, move: [0.3, 0.7] }], 1);
    const b = league([{ id: 'b_down', value: 3000, move: [0.7, 0.3] }], 2);

    const trends = roleTrends({
      summaries: [...a.summaries, ...b.summaries],
      values: new Map([...a.values, ...b.values]),
      snaps: new Map([...a.snaps, ...b.snaps]),
      current: true,
    });

    expect(trendsForRoster(trends, 1).buyLow.map((t) => t.player.id)).toEqual(['a_up']);
    expect(trendsForRoster(trends, 1).sellHigh).toEqual([]);
    expect(trendsForRoster(trends, 2).sellHigh.map((t) => t.player.id)).toEqual(['b_down']);
  });
});
