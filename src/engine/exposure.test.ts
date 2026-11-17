import { describe, expect, it } from 'vitest';
import { exposure, type HeldRoster } from './exposure';
import type { ValuedPlayer } from './rosterValue';
import { makePlayer } from './testFixtures';
import type { Position } from '../types';

function held(id: string, value: number, position: Position = 'WR', valued = true): ValuedPlayer {
  return {
    player: makePlayer(id, position),
    value,
    marketValue: value,
    winNowValue: value,
    valued,
    onTaxi: false,
    available: true,
  };
}

function roster(leagueId: string, players: ValuedPlayer[], totalValue?: number): HeldRoster {
  return {
    leagueId,
    name: `League ${leagueId}`,
    players,
    totalValue: totalValue ?? players.reduce((sum, p) => sum + p.value, 0),
  };
}

describe('exposure (#161)', () => {
  it('lists only players on two or more rosters, with each share of that roster', () => {
    const result = exposure([
      roster('a', [held('star', 2000), held('only-a', 2000)]),
      roster('b', [held('star', 1000), held('only-b', 9000)]),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].player.id).toBe('star');
    // Largest share first: half of league a, a tenth of league b.
    expect(result[0].holdings).toEqual([
      { leagueId: 'a', name: 'League a', share: 0.5 },
      { leagueId: 'b', name: 'League b', share: 0.1 },
    ]);
    expect(result[0].weight).toBeCloseTo(0.6);
  });

  it('compares shares, not values, so a superflex price does not outweigh a 1QB one', () => {
    // The same two men; league b prices everything five times higher.
    const result = exposure([
      roster('a', [held('qb', 100, 'QB'), held('wr', 400), held('rest-a', 500)]),
      roster('b', [held('qb', 500, 'QB'), held('wr', 2000), held('rest-b', 2500)]),
    ]);

    expect(result.map((e) => e.player.id)).toEqual(['wr', 'qb']);
    expect(result[0].weight).toBeCloseTo(0.8);
    expect(result[1].weight).toBeCloseTo(0.2);
  });

  it('ranks a big share in two leagues above a sliver in four', () => {
    const filler = (n: number) => held(`filler-${n}`, 9000);
    const result = exposure([
      roster('a', [held('anchor', 3000), held('depth', 100), filler(1)]),
      roster('b', [held('anchor', 3000), held('depth', 100), filler(2)]),
      roster('c', [held('depth', 100), filler(3)]),
      roster('d', [held('depth', 100), filler(4)]),
    ]);

    expect(result.map((e) => e.player.id)).toEqual(['anchor', 'depth']);
    expect(result[1].holdings).toHaveLength(4);
  });

  it('leaves out players with no published value, who have no share to state', () => {
    const result = exposure([
      roster('a', [held('k', 0, 'K', false), held('wr', 100)]),
      roster('b', [held('k', 0, 'K', false), held('wr', 100)]),
    ]);

    expect(result.map((e) => e.player.id)).toEqual(['wr']);
  });

  it('skips a roster with nothing priced on it rather than dividing by zero', () => {
    const result = exposure([
      roster('a', [held('wr', 100)]),
      roster('b', [held('wr', 100)], 0),
    ]);

    expect(result).toEqual([]);
  });

  it('breaks ties by name, so the order does not depend on which league loaded first', () => {
    const one = [roster('a', [held('b-man', 100), held('a-man', 100)]), roster('b', [held('a-man', 100), held('b-man', 100)])];
    const two = [...one].reverse();

    expect(exposure(one).map((e) => e.player.id)).toEqual(['a-man', 'b-man']);
    expect(exposure(two).map((e) => e.player.id)).toEqual(['a-man', 'b-man']);
  });
});
