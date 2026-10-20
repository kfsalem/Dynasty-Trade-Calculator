import { describe, expect, it } from 'vitest';
import { MATCHUP_SPREAD, matchupOdds, normalCdf, opponentOf, winChance } from './matchup';
import type { LineupSlot, Player, Position } from '../types';
import type { ValuedPlayer } from './rosterValue';

function entry(id: string, position: Position, team = 'KC'): ValuedPlayer {
  const player: Player = {
    id,
    name: id.toUpperCase(),
    position,
    team,
    age: 25,
    yearsExp: 3,
    platformIds: { sleeper: id },
  };
  return { player, value: 0, marketValue: 0, winNowValue: 0, valued: true, onTaxi: false, available: true };
}

const SLOTS: LineupSlot[] = ['QB', 'WR'];

const mine = [entry('qb1', 'QB', 'KC'), entry('wr1', 'WR', 'KC'), entry('wr2', 'WR', 'BUF')];
const theirs = [entry('qb2', 'QB', 'DAL'), entry('wr3', 'WR', 'DAL'), entry('wr4', 'WR', 'NYG')];

const projected = new Map([
  ['qb1', 20],
  ['wr1', 15],
  ['wr2', 10],
  ['qb2', 18],
  ['wr3', 12],
  ['wr4', 8],
]);

const base = {
  me: { rosterId: 1, entries: mine, setLineup: ['qb1', 'wr1'] },
  them: { rosterId: 2, entries: theirs, setLineup: ['qb2', 'wr3'] },
  startingSlots: SLOTS,
  projected,
};

describe('normalCdf', () => {
  it('matches the standard normal at known points', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1)).toBeCloseTo(0.841345, 5);
    expect(normalCdf(-1.96)).toBeCloseTo(0.024998, 5);
  });
});

describe('winChance', () => {
  it('reads the measured spread: a 10-point favourite wins about three in five', () => {
    expect(winChance(10)).toBeCloseTo(normalCdf(10 / MATCHUP_SPREAD), 6);
    expect(winChance(10)).toBeGreaterThan(0.59);
    expect(winChance(10)).toBeLessThan(0.61);
    expect(winChance(-10)).toBeCloseTo(1 - winChance(10), 6);
  });

  it('grows surer as the week is played, and is certain once it is over', () => {
    expect(winChance(10, 0.25)).toBeGreaterThan(winChance(10));
    expect(winChance(10, 0)).toBe(1);
    expect(winChance(-10, 0)).toBe(0);
    expect(winChance(0, 0)).toBe(0.5);
  });
});

describe('matchupOdds', () => {
  it('prices both best lineups before kickoff', () => {
    const odds = matchupOdds(base);

    expect(odds.me.expected).toBe(35);
    expect(odds.them.expected).toBe(30);
    expect(odds.chance).toBeCloseTo(winChance(5), 6);
    expect(odds.asSet).toBeNull();
    expect(odds.underway).toBe(false);
  });

  it('says when the opponent has set a worse lineup than his best', () => {
    const odds = matchupOdds({ ...base, them: { ...base.them, setLineup: ['qb2', 'wr4'] } });

    expect(odds.them.expected).toBe(30);
    expect(odds.asSet).toEqual({ expected: 26, chance: winChance(9) });
  });

  it('does not price an opponent who has set no lineup as scoring nothing', () => {
    const odds = matchupOdds({ ...base, them: { ...base.them, setLineup: [] } });

    expect(odds.themUnset).toBe(true);
    expect(odds.asSet).toBeNull();
    expect(odds.them.expected).toBe(30);
  });

  it('counts a finished game at what was scored, and narrows the spread', () => {
    const odds = matchupOdds({
      ...base,
      started: new Set(['KC']),
      finished: new Set(['KC']),
      live: new Map([
        ['qb1', 31],
        ['wr1', 2],
      ]),
    });

    expect(odds.me.expected).toBe(33);
    expect(odds.me.scored).toBe(33);
    expect(odds.underway).toBe(true);
    // 35 of 65 projected points are final, so 30/65 are left to play.
    expect(odds.chance).toBeCloseTo(winChance(3, 30 / 65), 6);
  });

  it('calls the week final only when every starter on both sides has finished', () => {
    const live = new Map([
      ['qb1', 20],
      ['wr1', 10],
      ['qb2', 25],
      ['wr3', 9],
    ]);
    const partly = matchupOdds({ ...base, started: new Set(['KC', 'DAL']), finished: new Set(['KC']), live });
    expect(partly.final).toBe(false);

    const done = matchupOdds({
      ...base,
      started: new Set(['KC', 'DAL', 'BUF', 'NYG']),
      finished: new Set(['KC', 'DAL', 'BUF', 'NYG']),
      live,
    });
    expect(done.final).toBe(true);
    expect(done.me.expected).toBe(30);
    expect(done.them.expected).toBe(34);
    expect(done.chance).toBe(0);
  });

  it('keeps a game in progress at its projection until the points pass it', () => {
    const odds = matchupOdds({
      ...base,
      started: new Set(['KC']),
      finished: new Set(),
      live: new Map([
        ['qb1', 4],
        ['wr1', 22],
      ]),
    });

    // qb1: max(4, 20) = 20. wr1: max(22, 15) = 22. Nothing is final yet.
    expect(odds.me.expected).toBe(42);
    expect(odds.me.scored).toBe(0);
    expect(odds.chance).toBeCloseTo(winChance(12), 6);
  });

  it('cannot bring in a bench player whose game has started', () => {
    // wr2 (BUF) is the better receiver this week, but BUF has kicked off.
    const odds = matchupOdds({
      ...base,
      projected: new Map([...projected, ['wr2', 25]]),
      started: new Set(['BUF']),
    });

    expect(odds.me.plan.lineup.map((a) => a.entry?.player.id)).toEqual(['qb1', 'wr1']);
  });
});

describe('opponentOf', () => {
  it('finds the other side of the fixture, from either end', () => {
    const fixtures = [{ rosterIds: [1, 4] as [number, number] }, { rosterIds: [2, 3] as [number, number] }];
    expect(opponentOf(fixtures, 1)).toBe(4);
    expect(opponentOf(fixtures, 3)).toBe(2);
    expect(opponentOf(fixtures, 9)).toBeNull();
  });
});
