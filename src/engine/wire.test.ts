import { describe, expect, it } from 'vitest';
import { wireUpgrades, type WireInput } from './wire';
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
    onTaxi: false,
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

/**
 * Claims against a roster that is exactly full, taxi and IR empty — the case
 * every test here was written for, where each claim has to name a drop.
 */
const claims = (input: Omit<WireInput, 'roster' | 'activeLimit'>) =>
  wireUpgrades({
    ...input,
    roster: { playerIds: input.entries.map((e) => e.player.id), taxiIds: [], reserveIds: [] },
    activeLimit: input.entries.length,
  });

describe('wireUpgrades', () => {
  it('offers a free agent who clearly beats the man in the slot', () => {
    const entries = roster();
    const upgrades = claims({
      lineup: lineupFor(entries),
      entries,
      board: board(agent('fa_qb', 'QB', 1400)),
    });

    expect(upgrades).toHaveLength(1);
    expect(upgrades[0].add.player.id).toBe('fa_qb');
    expect(upgrades[0].replaces?.player.id).toBe('qb1');
    expect(upgrades[0].slot).toBe('QB');
  });

  /*
    The same bar an internal swap has to clear. A waiver claim costs a roster
    spot on top of being noise, so a 3% upgrade is worse advice here than it
    would be on the bench — and the real league had exactly that case.
  */
  it('stays quiet about a free agent who is barely better', () => {
    const entries = roster();
    const upgrades = claims({
      lineup: lineupFor(entries),
      entries,
      board: board(agent('fa_qb', 'QB', 930)),
    });

    expect(upgrades).toHaveLength(0);
  });

  it('names the cheapest asset to drop, not the worst starter', () => {
    const entries = roster();
    const [upgrade] = claims({
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
    const upgrades = claims({
      lineup: lineupFor(entries),
      entries,
      board: board(agent('fa_wr', 'WR', 1500)),
    });

    expect(upgrades).toHaveLength(1);
  });

  it('never nominates the same body as the drop twice', () => {
    const entries = roster();
    const upgrades = claims({
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
    const upgrades = claims({
      lineup: lineupFor(entries),
      entries,
      board: board(agent('nobody', 'QB', null)),
    });

    expect(upgrades).toHaveLength(0);
  });

  it('will not offer a man who cannot play this week', () => {
    const entries = roster();
    const hurt = claims({
      lineup: lineupFor(entries),
      entries,
      board: board(agent('fa_qb', 'QB', 1400, { injury: { status: 'out' } })),
    });
    expect(hurt).toHaveLength(0);

    const bye = claims({
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
      claims({ lineup: lineupFor(entries), entries, board: undefined }),
    ).toEqual([]);
  });

  it('drops the displaced starter when nobody else is on the bench', () => {
    // Every rostered player starts, so the only body that stops starting is the
    // quarterback the claim replaces — and he is the one to cut.
    const entries = [
      entry('qb1', 'QB', 900),
      entry('rb1', 'RB', 800),
      entry('wr1', 'WR', 700),
      entry('wr2', 'WR', 600),
    ];
    const [upgrade] = claims({
      lineup: lineupFor(entries),
      entries,
      board: board(agent('fa_qb', 'QB', 1400)),
    });

    expect(upgrade.drop?.player.id).toBe('qb1');
    expect(upgrade.room).toBe(false);
  });
});

describe('wireUpgrades — who makes room', () => {
  const entries = [
    ...roster(),
    // On IR and on the taxi squad: cheaper assets than anyone above, and
    // useless as drops, because neither frees a spot a claimed player can use.
    entry('hurt', 'RB', 5, 5),
    entry('taxi', 'WR', 3, 3),
  ];
  const input = (activeLimit: number) => ({
    lineup: lineupFor(entries),
    entries,
    board: board(agent('fa_qb', 'QB', 1400)),
    roster: {
      playerIds: entries.map((e) => e.player.id),
      taxiIds: ['taxi'],
      reserveIds: ['hurt'],
    },
    activeLimit,
  });

  it('never drops a player on IR or the taxi squad', () => {
    // Six active players against a limit of six: full, so somebody goes — and
    // it is the cheapest *active* body, not the injured one.
    const [upgrade] = wireUpgrades(input(6));

    expect(upgrade.room).toBe(false);
    expect(upgrade.drop?.player.id).toBe('spare');
  });

  it('names no drop when an open spot takes the claim', () => {
    const [upgrade] = wireUpgrades(input(7));

    expect(upgrade.room).toBe(true);
    expect(upgrade.drop).toBeNull();
  });

  it('spends an open spot on the best claim and drops for the next', () => {
    const upgrades = wireUpgrades({
      ...input(7),
      board: board(agent('fa_qb', 'QB', 1400), agent('fa_rb', 'RB', 1300)),
    });

    expect(upgrades.map((u) => u.room)).toEqual([true, false]);
    expect(upgrades[0].drop).toBeNull();
    expect(upgrades[1].drop?.player.id).toBe('spare');
  });
});

describe('wireUpgrades on projections (#149)', () => {
  const lineupOn = (entries: ValuedPlayer[], projected: Map<string, number>) =>
    bestLineup(
      entries.map((e) => ({ ...e, winNowValue: projected.get(e.player.id) ?? 0 })),
      SLOTS,
    );
  const entries = roster();
  const projected = new Map([
    ['qb1', 18],
    ['rb1', 14],
    ['wr1', 12],
    ['wr2', 8],
    ['rook', 2],
    ['spare', 3],
  ]);

  it('offers an unpriced free agent when his projection clearly beats a starter', () => {
    const [upgrade] = claims({
      lineup: lineupOn(entries, projected),
      entries,
      board: { priced: [], unpriced: [agent('fa_wr', 'WR', null)], all: [agent('fa_wr', 'WR', null)] },
      projected: new Map([...projected, ['fa_wr', 14]]),
    });

    expect(upgrade.add.player.id).toBe('fa_wr');
    expect(upgrade.replaces?.player.id).toBe('wr2');
    expect(upgrade.chance).toBeGreaterThan(0.6);
  });

  it('says nothing about a free agent only a point or two better', () => {
    const upgrades = claims({
      lineup: lineupOn(entries, projected),
      entries,
      board: board(agent('fa_wr', 'WR', 5000)),
      projected: new Map([...projected, ['fa_wr', 9.5]]),
    });

    expect(upgrades).toEqual([]);
  });

  it('keeps the value rule when there are no projections: unpriced agents stay out', () => {
    const upgrades = claims({
      lineup: lineupFor(entries),
      entries,
      board: { priced: [], unpriced: [agent('fa_wr', 'WR', null)], all: [agent('fa_wr', 'WR', null)] },
    });

    expect(upgrades).toEqual([]);
  });
});

describe('wireUpgrades — empty slots and games under way (#152)', () => {
  const defAgent = (id: string, team: string) => agent(id, 'DEF' as Position, null, { team });
  const slots: LineupSlot[] = ['QB', 'RB', 'WR', 'FLEX', 'DEF'];
  const entries = roster();
  const projected = new Map([
    ['qb1', 18],
    ['rb1', 14],
    ['wr1', 12],
    ['wr2', 8],
    ['rook', 2],
    ['spare', 3],
    ['bal', 9.5],
    ['chi', 8.4],
  ]);
  const lineup = bestLineup(
    entries.map((e) => ({ ...e, winNowValue: projected.get(e.player.id) ?? 0 })),
    slots,
  );
  const wire = { priced: [], unpriced: [defAgent('bal', 'BAL'), defAgent('chi', 'CHI')], all: [defAgent('bal', 'BAL'), defAgent('chi', 'CHI')] };

  it('fills a slot nobody on the roster can play, with the best one available', () => {
    // No defence rostered: the slot is empty, and used to be skipped outright.
    expect(lineup[4].entry).toBeNull();
    const upgrades = wireUpgrades({
      lineup,
      entries,
      board: wire,
      projected,
      roster: { playerIds: entries.map((e) => e.player.id), taxiIds: [], reserveIds: [] },
      activeLimit: entries.length + 2,
    });
    const def = upgrades.find((u) => u.slot === 'DEF');

    expect(def?.add.player.id).toBe('bal');
    expect(def?.replaces).toBeNull();
    expect(def?.room).toBe(true);
  });

  it('does not offer a free agent whose game has kicked off', () => {
    const upgrades = wireUpgrades({
      lineup,
      entries,
      board: wire,
      projected,
      locked: new Set(['BAL']),
      roster: { playerIds: entries.map((e) => e.player.id), taxiIds: [], reserveIds: [] },
      activeLimit: entries.length + 2,
    });

    expect(upgrades.find((u) => u.slot === 'DEF')?.add.player.id).toBe('chi');
  });

  it('does not try to replace a starter whose game has kicked off', () => {
    const lineupWithDef = bestLineup(
      [...entries, entry('hou', 'DEF', 0)].map((e) => ({
        ...e,
        player: e.player.id === 'hou' ? { ...e.player, team: 'HOU' } : e.player,
        winNowValue: e.player.id === 'hou' ? 6.5 : (projected.get(e.player.id) ?? 0),
      })),
      slots,
    );
    const upgrades = wireUpgrades({
      lineup: lineupWithDef,
      entries,
      board: wire,
      projected,
      locked: new Set(['HOU']),
      roster: { playerIds: entries.map((e) => e.player.id), taxiIds: [], reserveIds: [] },
      activeLimit: entries.length + 2,
    });

    expect(upgrades.some((u) => u.slot === 'DEF')).toBe(false);
  });
});
