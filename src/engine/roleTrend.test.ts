import { describe, expect, it } from 'vitest';
import type { Player, PlayerValue } from '../types';
import type { RosterSummary } from './rosterValue';
import type { SnapShare } from './snapShare';
import { activityFactor } from './activityFactor';
import { MIN_GAMES, roleTrends, trendsForRoster } from './roleTrend';
import { makePlayer, makeValue } from './testFixtures';

const snaps = (season: number, recent: number, recentGames = 4): SnapShare => ({
  season,
  recent,
  delta: recent - season,
  games: 12,
  recentGames,
});

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
  const values = new Map<string, PlayerValue>();
  const snapMap = new Map<string, SnapShare>();
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
    const { summaries, values, snaps } = league([
      { id: 'star', value: 6000, move: [0.55, 0.68] },
      { id: 'scrub', value: 300, move: [0.1, 0.9] },
    ]);

    const trends = roleTrends({ summaries, values, snaps, current: true });

    expect(trends.buyLow.map((t) => t.player.id)).toEqual(['star', 'scrub']);
    // ...even though the scrub moved much further in share and in percent.
    expect(trends.buyLow[1].factor).toBeGreaterThan(trends.buyLow[0].factor);
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
