import { describe, expect, it } from 'vitest';
import { bestLineup, valuePlayers, type ValuedPlayer } from './rosterValue';
import type { LineupSlot, Player, PlayerValue, Position } from '../types';
import { makeValue } from './testFixtures';

function player(id: string, position: Position, name = id): Player {
  return {
    id,
    name,
    position,
    team: 'FA',
    age: 25,
    yearsExp: 3,
    platformIds: { sleeper: id },
  };
}

function entry(
  id: string,
  position: Position,
  value: number,
  marketValue = value,
): ValuedPlayer {
  return { player: player(id, position), value, marketValue, valued: true };
}

const names = (lineup: ReturnType<typeof bestLineup>) =>
  lineup.map((a) => a.entry?.player.id ?? null);

describe('bestLineup', () => {
  it('fills dedicated slots before flex, so a flex cannot steal a needed starter', () => {
    // Only two WRs exist. Both WR slots must be filled before FLEX takes one.
    const entries = [
      entry('wr1', 'WR', 900),
      entry('wr2', 'WR', 800),
      entry('rb1', 'RB', 700),
    ];
    const slots: LineupSlot[] = ['WR', 'WR', 'FLEX'];

    expect(names(bestLineup(entries, slots))).toEqual(['wr1', 'wr2', 'rb1']);
  });

  it('gives SUPER_FLEX the best remaining player, not necessarily a QB', () => {
    const entries = [
      entry('qb1', 'QB', 950),
      entry('rb1', 'RB', 900),
      entry('qb2', 'QB', 200),
    ];
    const slots: LineupSlot[] = ['QB', 'RB', 'SUPER_FLEX'];

    // QB slot takes qb1, RB slot takes rb1, SF is left choosing qb2 (only one left).
    expect(names(bestLineup(entries, slots))).toEqual(['qb1', 'rb1', 'qb2']);
  });

  it('prefers a strong second QB in SUPER_FLEX over a weak flex option', () => {
    const entries = [
      entry('qb1', 'QB', 950),
      entry('qb2', 'QB', 800),
      entry('rb1', 'RB', 700),
      entry('rb2', 'RB', 100),
    ];
    const slots: LineupSlot[] = ['QB', 'RB', 'SUPER_FLEX'];

    expect(names(bestLineup(entries, slots))).toEqual(['qb1', 'rb1', 'qb2']);
  });

  it('never starts the same player twice', () => {
    const entries = [entry('wr1', 'WR', 900)];
    const slots: LineupSlot[] = ['WR', 'FLEX', 'SUPER_FLEX'];

    const result = names(bestLineup(entries, slots));
    expect(result).toEqual(['wr1', null, null]);
  });

  it('leaves a slot empty when no eligible player exists', () => {
    const entries = [entry('wr1', 'WR', 900)];
    const slots: LineupSlot[] = ['QB', 'WR'];

    expect(names(bestLineup(entries, slots))).toEqual([null, 'wr1']);
  });

  it('excludes QBs from a standard FLEX', () => {
    const entries = [entry('qb1', 'QB', 999), entry('te1', 'TE', 100)];
    const slots: LineupSlot[] = ['FLEX'];

    expect(names(bestLineup(entries, slots))).toEqual(['te1']);
  });

  it('returns assignments in the league slot order, not fill order', () => {
    const entries = [entry('qb1', 'QB', 900), entry('rb1', 'RB', 800)];
    const slots: LineupSlot[] = ['SUPER_FLEX', 'RB'];

    const result = bestLineup(entries, slots);
    expect(result.map((a) => a.slot)).toEqual(['SUPER_FLEX', 'RB']);
    // RB slot is more restrictive so it fills first, taking rb1; SF gets qb1.
    expect(names(result)).toEqual(['qb1', 'rb1']);
  });

  it('breaks a value tie on market value, not on the order players arrived in', () => {
    // Two players a league-adjusted valuation cannot separate, but the market
    // can. The FLEX must take the better asset regardless of list order —
    // whichever it takes becomes a starter count, which sets replacement level.
    const cheap = entry('cheap', 'RB', 400, 900);
    const rich = entry('rich', 'WR', 400, 3100);
    const slots: LineupSlot[] = ['FLEX'];

    expect(names(bestLineup([cheap, rich], slots))).toEqual(['rich']);
    expect(names(bestLineup([rich, cheap], slots))).toEqual(['rich']);
  });

  it('is a total order, so identical players still sort deterministically', () => {
    // Two players alike on every number we have. Some answer has to be picked;
    // it must be the *same* answer each time, or the starter counts it feeds
    // become a function of input ordering.
    const a = entry('aaa', 'RB', 400, 900);
    const b = entry('bbb', 'WR', 400, 900);
    const slots: LineupSlot[] = ['FLEX'];

    expect(names(bestLineup([a, b], slots))).toEqual(names(bestLineup([b, a], slots)));
  });

  it('fills REC_FLEX before FLEX, since WR/TE is the narrower slot', () => {
    const entries = [
      entry('wr1', 'WR', 900),
      entry('rb1', 'RB', 890),
      entry('rb2', 'RB', 500),
    ];
    const slots: LineupSlot[] = ['FLEX', 'REC_FLEX'];

    // REC_FLEX must take wr1 (its only option); FLEX then takes the best RB.
    expect(names(bestLineup(entries, slots))).toEqual(['rb1', 'wr1']);
  });
});

describe('valuePlayers', () => {
  const players = new Map<string, Player>([
    ['a', player('a', 'WR')],
    ['b', player('b', 'RB')],
  ]);
  const values = new Map<string, PlayerValue>([['a', makeValue('a', 500, 'WR')]]);

  it('sorts by value descending and flags unvalued players', () => {
    const result = valuePlayers(['b', 'a'], players, values);
    expect(result.map((r) => r.player.id)).toEqual(['a', 'b']);
    expect(result[0].valued).toBe(true);
    expect(result[1].valued).toBe(false);
    expect(result[1].value).toBe(0);
  });

  it('skips ids missing from the player index', () => {
    expect(valuePlayers(['a', 'ghost'], players, values)).toHaveLength(1);
  });
});
