import { describe, expect, it } from 'vitest';
import { wireUpgrades } from './wire';
import { bestLineup, type ValuedPlayer } from './rosterValue';
import { canStart } from './availability';
import { makePlayer, makeValue } from './testFixtures';
import type { FreeAgent, FreeAgentBoard } from './freeAgents';
import type { InjuryStatus, LineupSlot, Position } from '../types';

const SLOTS: LineupSlot[] = ['QB', 'RB', 'WR', 'FLEX'];

function entry(
  id: string,
  position: Position,
  winNowValue: number,
  dynasty = winNowValue,
): ValuedPlayer {
  const player = makePlayer(id, position);
  return {
    player,
    value: dynasty,
    marketValue: winNowValue,
    winNowValue,
    valued: true,
    available: canStart(player),
  };
}

function agent(
  id: string,
  position: Position,
  winNowValue: number | null,
  { team = 'KC', injury }: { team?: string; injury?: InjuryStatus } = {},
): FreeAgent {
  const player = { ...makePlayer(id, position, 25, injury), team };
  return {
    player,
    value:
      winNowValue === null
        ? null
        : makeValue(id, winNowValue, position, winNowValue, winNowValue, winNowValue),
    snaps: undefined,
    usage: undefined,
    adjustment: undefined,
  };
}

const board = (...priced: FreeAgent[]): FreeAgentBoard => ({
  priced,
  unpriced: [],
  all: priced,
});

/** A roster whose worst asset is deliberately not its worst starter. */
const roster = (): ValuedPlayer[] => [
  entry('qb1', 'QB', 900),
  entry('rb1', 'RB', 800),
  entry('wr1', 'WR', 700),
  entry('wr2', 'WR', 600),
  // Bench. The rookie is worth more as an asset than the veteran body, which is
  // what makes the drop pick meaningful rather than incidental.
  entry('rook', 'WR', 10, 500),
  entry('spare', 'WR', 40, 20),
];

const lineupFor = (entries: ValuedPlayer[]) => bestLineup(entries, SLOTS);

describe('wireUpgrades', () => {
  it('offers a free agent who clearly beats the man in the slot', () => {
    const entries = roster();
    const upgrades = wireUpgrades({
      lineup: lineupFor(entries),
      entries,
      board: board(agent('fa_qb', 'QB', 1400)),
    });

    expect(upgrades).toHaveLength(1);
    expect(upgrades[0].add.player.id).toBe('fa_qb');
    expect(upgrades[0].replaces.player.id).toBe('qb1');
    expect(upgrades[0].slot).toBe('QB');
  });

  /*
    The same bar an internal swap has to clear. A waiver claim costs a roster
    spot on top of being noise, so a 3% upgrade is worse advice here than it
    would be on the bench — and the real league had exactly that case.
  */
  it('stays quiet about a free agent who is barely better', () => {
    const entries = roster();
    const upgrades = wireUpgrades({
      lineup: lineupFor(entries),
      entries,
      board: board(agent('fa_qb', 'QB', 930)),
    });

    expect(upgrades).toHaveLength(0);
  });

  it('names the cheapest asset to drop, not the worst starter', () => {
    const entries = roster();
    const [upgrade] = wireUpgrades({
      lineup: lineupFor(entries),
      entries,
      board: board(agent('fa_qb', 'QB', 1400)),
    });

    // `spare` is worth 20 as an asset and `rook` 500, even though the rookie
    // does less this Sunday. A drop is permanent, so it is an asset decision.
    expect(upgrade.drop?.player.id).toBe('spare');
  });

  it('never offers one player for two slots', () => {
    const entries = roster();
    // Good enough to beat both receivers, but he is one man.
    const upgrades = wireUpgrades({
      lineup: lineupFor(entries),
      entries,
      board: board(agent('fa_wr', 'WR', 1500)),
    });

    expect(upgrades).toHaveLength(1);
  });

  it('never nominates the same body as the drop twice', () => {
    const entries = roster();
    const upgrades = wireUpgrades({
      lineup: lineupFor(entries),
      entries,
      board: board(agent('fa_qb', 'QB', 1400), agent('fa_wr', 'WR', 1500)),
    });

    expect(upgrades).toHaveLength(2);
    const drops = upgrades.map((u) => u.drop?.player.id);
    expect(new Set(drops).size).toBe(drops.length);
  });

  it('leaves unpriced free agents out entirely', () => {
    const entries = roster();
    // Three quarters of a real wire has no published value, and #10's rule is
    // that this is not the same as being worth nothing. Claiming he beats a
    // starter would mean inventing the number the claim rests on.
    const upgrades = wireUpgrades({
      lineup: lineupFor(entries),
      entries,
      board: board(agent('nobody', 'QB', null)),
    });

    expect(upgrades).toHaveLength(0);
  });

  it('will not offer a man who cannot play this week', () => {
    const entries = roster();
    const hurt = wireUpgrades({
      lineup: lineupFor(entries),
      entries,
      board: board(agent('fa_qb', 'QB', 1400, { injury: { status: 'out' } })),
    });
    expect(hurt).toHaveLength(0);

    const bye = wireUpgrades({
      lineup: lineupFor(entries),
      entries,
      board: board(agent('fa_qb', 'QB', 1400, { team: 'LAR' })),
      byeTeams: new Set(['LAR']),
    });
    expect(bye).toHaveLength(0);
  });

  it('says nothing at all before the wire has loaded', () => {
    const entries = roster();
    expect(
      wireUpgrades({ lineup: lineupFor(entries), entries, board: undefined }),
    ).toEqual([]);
  });

  it('reports no spare body rather than inventing one', () => {
    // Every rostered player is in the lineup, so a claim really does cost a
    // choice the app is not entitled to make.
    const entries = [
      entry('qb1', 'QB', 900),
      entry('rb1', 'RB', 800),
      entry('wr1', 'WR', 700),
      entry('wr2', 'WR', 600),
    ];
    const [upgrade] = wireUpgrades({
      lineup: lineupFor(entries),
      entries,
      board: board(agent('fa_qb', 'QB', 1400)),
    });

    expect(upgrade.drop).toBeNull();
  });
});
