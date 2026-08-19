import { describe, expect, it } from 'vitest';
import { freeAgentBoard, playingTime } from './freeAgents';
import { valueLeague } from './replacement';
import { makePlayer, makeRoster, makeSettings, makeValue } from './testFixtures';
import type { Player, PlayerValue } from '../types';
import type { SnapShare } from './snapShare';

const share = (recent: number | null, season = recent ?? 0): SnapShare => ({
  season,
  recent,
  prior: null,
  delta: null,
  games: 4,
  recentGames: recent === null ? 0 : 4,
  priorGames: 0,
});

/**
 * A role that has just changed, which is the only thing `activityFactor` reads.
 * The *level* of a snap share is already in a player's market price; the move
 * between two windows is what the market has not caught up with yet.
 */
const moving = (from: number, to: number): SnapShare => ({
  season: (from + to) / 2,
  recent: to,
  prior: from,
  delta: to - from,
  games: 8,
  recentGames: 4,
  priorGames: 4,
});

const settings = makeSettings(['QB', 'RB', 'WR', 'FLEX']);

const rostered = new Map<string, Player>([
  ['qb1', makePlayer('qb1', 'QB')],
  ['rb1', makePlayer('rb1', 'RB')],
  ['wr1', makePlayer('wr1', 'WR')],
  ['wr2', makePlayer('wr2', 'WR')],
]);

const freeAgents = new Map<string, Player>([
  ['fa_wr', makePlayer('fa_wr', 'WR')],
  ['fa_rb', makePlayer('fa_rb', 'RB')],
  ['fa_playing', makePlayer('fa_playing', 'WR')],
  ['fa_benched', makePlayer('fa_benched', 'WR')],
  ['fa_unknown', makePlayer('fa_unknown', 'WR')],
]);

/** FantasyCalc prices some free agents and has never heard of most of them. */
const market = new Map<string, PlayerValue>([
  ['qb1', makeValue('qb1', 5000, 'QB')],
  ['rb1', makeValue('rb1', 4000, 'RB')],
  ['wr1', makeValue('wr1', 3000, 'WR')],
  ['wr2', makeValue('wr2', 2000, 'WR')],
  ['fa_wr', makeValue('fa_wr', 900, 'WR')],
  ['fa_rb', makeValue('fa_rb', 600, 'RB')],
]);

const rosters = [makeRoster(1, ['qb1', 'rb1', 'wr1', 'wr2'])];

const board = (snaps?: Map<string, SnapShare>, current = false) =>
  freeAgentBoard({
    freeAgents,
    market,
    levels: valueLeague(rosters, rostered, market, settings).levels,
    snaps,
    usage: undefined,
    current,
  });

describe('freeAgentBoard', () => {
  it('splits the wire into what the market prices and what it does not', () => {
    const { priced, unpriced } = board();

    expect(priced.map((entry) => entry.player.id)).toEqual(['fa_wr', 'fa_rb']);
    // FantasyCalc's universe is about one league's worth of players, so most of
    // the wire is outside it — 74% of it on the real test league.
    expect(unpriced.map((entry) => entry.player.id).sort()).toEqual([
      'fa_benched',
      'fa_playing',
      'fa_unknown',
    ]);
  });

  it('never reports an unpriced player as worth zero', () => {
    // Zero is a claim. `UnvaluedCell` is what renders the absence.
    for (const entry of board().unpriced) expect(entry.value).toBeNull();
  });

  it('prices free agents on the same scale as the rostered players', () => {
    const { priced } = board();
    const adjusted = valueLeague(rosters, rostered, market, settings);

    // Same replacement levels, same curve — so the two numbers are comparable
    // without conversion, which is the whole point of reusing the levels.
    const wr = priced.find((entry) => entry.player.id === 'fa_wr');
    expect(wr?.value?.value).toBeCloseTo(
      (900 * 900) / (900 + (adjusted.levels.WR?.value ?? 0)),
      6,
    );
  });

  it('orders the unpriced by who is actually playing', () => {
    const snaps = new Map<string, SnapShare>([
      ['fa_benched', share(0.12)],
      ['fa_playing', share(0.78)],
    ]);

    // fa_unknown has no snap record at all and goes last — below a man playing
    // 12% of snaps, because 12% is evidence and nothing is not.
    expect(board(snaps).unpriced.map((entry) => entry.player.id)).toEqual([
      'fa_playing',
      'fa_benched',
      'fa_unknown',
    ]);
  });

  it('ranks a man on the field now above one who was on it in October', () => {
    const snaps = new Map<string, SnapShare>([
      // A starter, but not lately — five games in the middle of the season.
      ['fa_benched', share(null, 0.98)],
      // Playing far less, and playing it this week.
      ['fa_playing', share(0.3)],
    ]);

    // Ordering on a bare share put the first man top, because `season` is the
    // mean over the games he *appeared in*. Recency is a separate tier, so the
    // higher number does not outrank the more current one.
    expect(board(snaps).unpriced.map((entry) => entry.player.id)).toEqual([
      'fa_playing',
      'fa_benched',
      'fa_unknown',
    ]);
  });

  it('still ranks the stale ones against each other by share', () => {
    const snaps = new Map<string, SnapShare>([
      ['fa_benched', share(null, 0.4)],
      ['fa_playing', share(null, 0.9)],
    ]);

    expect(board(snaps).unpriced.map((entry) => entry.player.id)).toEqual([
      'fa_playing',
      'fa_benched',
      'fa_unknown',
    ]);
  });

  it('leaves the market untouched out of season, as the pricing rule requires', () => {
    const snaps = new Map<string, SnapShare>([['fa_wr', moving(0.3, 0.9)]]);

    // `current: false` — the market has had months to absorb the role, so the
    // factor is exactly 1 and the value is the plain replacement-adjusted one.
    const off = board(snaps, false).priced.find((e) => e.player.id === 'fa_wr');
    const live = board(snaps, true).priced.find((e) => e.player.id === 'fa_wr');

    expect(off?.adjustment).toBeUndefined();
    expect(live?.value?.value).not.toBe(off?.value?.value);
  });

  it('moves no replacement level and no rostered value', () => {
    // The property the whole seam exists for. Free agents live in their own
    // field of `LeagueBundle` and are never handed to `valueLeague`, so pricing
    // the wire cannot reach back into the rostered pool — not by convention,
    // but because the data never gets there.
    const before = valueLeague(rosters, rostered, market, settings);
    const levelsBefore = structuredClone(before.levels);
    const valuesBefore = new Map(before.values);
    const marketBefore = structuredClone([...market.entries()]);

    freeAgentBoard({
      freeAgents,
      market,
      levels: before.levels,
      snaps: new Map([['fa_wr', moving(0.2, 0.95)]]),
      usage: undefined,
      current: true,
    });

    const after = valueLeague(rosters, rostered, market, settings);

    expect(after.levels).toEqual(levelsBefore);
    expect(before.levels).toEqual(levelsBefore);
    expect([...market.entries()]).toEqual(marketBefore);
    for (const [id, value] of after.values) {
      expect(value).toEqual(valuesBefore.get(id));
    }
  });
});

describe('playingTime', () => {
  it('reports the recent window, and says that is what it is', () => {
    expect(playingTime(share(0.5, 0.9))).toEqual({ share: 0.5, recent: true });
  });

  it('falls back to the season, and says that is what it is', () => {
    expect(playingTime(share(null, 0.9))).toEqual({ share: 0.9, recent: false });
  });

  it('is null when there is no snap record at all', () => {
    expect(playingTime(undefined)).toBeNull();
  });
});
