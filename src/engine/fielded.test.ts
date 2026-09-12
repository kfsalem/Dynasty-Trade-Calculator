import { describe, expect, it } from 'vitest';
import { fieldedStanding, leagueFielded } from './fielded';
import { summarizeRoster } from './rosterValue';
import type { LineupSlot, Player, PlayerValue, Position, Roster } from '../types';
import { makePlayer, makeRoster, makeSettings, makeValue } from './testFixtures';

const SLOTS: LineupSlot[] = ['QB', 'RB', 'WR'];
const settings = makeSettings(SLOTS, { teamCount: 3 });

/**
 * Three teams, each with a starter at every slot and one spare receiver.
 *
 * `set` names the ids this team has published as its lineup, in slot order, so
 * a test can field the best eleven or something worse without touching values.
 */
function world(
  teams: { values: [number, number, number, number]; set: 'best' | 'stale' | 'none' }[],
) {
  const players = new Map<string, Player>();
  const values = new Map<string, PlayerValue>();
  const rosters: Roster[] = [];
  const shape: Position[] = ['QB', 'RB', 'WR', 'WR'];

  teams.forEach((team, t) => {
    const ids = shape.map((position, i) => {
      const id = `t${t + 1}_${position}${i}`;
      players.set(id, makePlayer(id, position, 25));
      values.set(id, makeValue(id, team.values[i]));
      return id;
    });

    const setLineup =
      team.set === 'none'
        ? []
        : team.set === 'best'
          ? [ids[0], ids[1], ids[2]]
          : // The spare receiver started over the good one: a stale lineup.
            [ids[0], ids[1], ids[3]];

    rosters.push({ ...makeRoster(t + 1, ids), setLineup });
  });

  const summaries = rosters.map((r) => summarizeRoster(r, players, values, settings));
  return { rosters, summaries };
}

describe('leagueFielded', () => {
  it('separates what a roster can field from what its manager has set', () => {
    const { rosters, summaries } = world([
      { values: [1000, 900, 800, 100], set: 'stale' },
      { values: [950, 850, 750, 50], set: 'best' },
    ]);

    const all = leagueFielded(rosters, summaries, SLOTS, null);

    expect(all[0]).toEqual({ rosterId: 1, ceiling: 2700, fielded: 2000, unset: false });
    expect(all[1]).toEqual({ rosterId: 2, ceiling: 2550, fielded: 2550, unset: false });
  });

  it('reports a roster with no published lineup as unset rather than as zero', () => {
    const { rosters, summaries } = world([{ values: [1000, 900, 800, 100], set: 'none' }]);

    expect(leagueFielded(rosters, summaries, SLOTS, null)[0]).toMatchObject({
      ceiling: 2700,
      unset: true,
    });
  });

  it('counts a man on bye out of both numbers, so benching him is not a shortfall', () => {
    const { rosters, summaries } = world([{ values: [1000, 900, 800, 100], set: 'best' }]);
    // Every fixture player carries the same team code, so this sits the lot.
    const off = new Set(['FA']);

    const [team] = leagueFielded(rosters, summaries, SLOTS, off);

    expect(team.ceiling).toBe(0);
    expect(team.fielded).toBe(0);
  });
});

describe('fieldedStanding', () => {
  /**
   * The case the whole thing exists for: the best roster in the league is
   * fielding the least of anyone in it.
   */
  const stale = () =>
    world([
      { values: [1000, 900, 800, 100], set: 'stale' }, // ceiling 2700, fielding 2000
      { values: [950, 850, 750, 50], set: 'best' }, //    ceiling 2550, fielding 2550
      { values: [900, 800, 700, 50], set: 'best' }, //    ceiling 2400, fielding 2400
    ]);

  it('ranks the ceiling and the set lineup separately', () => {
    const { rosters, summaries } = stale();
    const standing = fieldedStanding(1, leagueFielded(rosters, summaries, SLOTS, null));

    expect(standing).toMatchObject({
      ceiling: 2700,
      fielded: 2000,
      gap: 700,
      ceilingRank: 1,
      fieldedRank: 3,
      ranked: 3,
      teamCount: 3,
      unset: false,
    });
  });

  it('reports no gap for a manager already fielding his best', () => {
    const { rosters, summaries } = stale();
    const standing = fieldedStanding(2, leagueFielded(rosters, summaries, SLOTS, null));

    expect(standing?.gap).toBe(0);
    expect(standing?.ceilingRank).toBe(2);
    expect(standing?.fieldedRank).toBe(1);
  });

  it('leaves a team with no lineup out of the fielded ranking entirely', () => {
    const { rosters, summaries } = world([
      { values: [1000, 900, 800, 100], set: 'none' },
      { values: [950, 850, 750, 50], set: 'best' },
      { values: [900, 800, 700, 50], set: 'best' },
    ]);
    const all = leagueFielded(rosters, summaries, SLOTS, null);

    // The unset team is not fielding zero — it is unknown, and ranking it last
    // would flatter the two below it by exactly what the app does not know.
    expect(fieldedStanding(2, all)).toMatchObject({ fieldedRank: 1, ranked: 2, teamCount: 3 });
    expect(fieldedStanding(3, all)).toMatchObject({ fieldedRank: 2, ranked: 2 });

    // Its own standing says so rather than inventing a place for it.
    expect(fieldedStanding(1, all)).toMatchObject({ unset: true, fieldedRank: 0, ranked: 2 });
  });

  it('is null for a team that is not in the league', () => {
    const { rosters, summaries } = stale();
    expect(fieldedStanding(99, leagueFielded(rosters, summaries, SLOTS, null))).toBeNull();
  });
});
