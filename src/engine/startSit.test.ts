import { describe, expect, it } from 'vitest';
import { startSit } from './startSit';
import { canStart } from './availability';
import type { InjuryStatus, LineupSlot, Player, Position } from '../types';
import type { ValuedPlayer } from './rosterValue';

function entry(
  id: string,
  position: Position,
  winNowValue: number,
  injury?: InjuryStatus,
): ValuedPlayer {
  const player: Player = {
    id,
    name: id.toUpperCase(),
    position,
    team: 'FA',
    age: 25,
    yearsExp: 3,
    injury,
    platformIds: { sleeper: id },
  };
  return {
    player,
    value: winNowValue,
    marketValue: winNowValue,
    winNowValue,
    valued: true,
    available: canStart(player),
  };
}

const ids = (plan: ReturnType<typeof startSit>) =>
  plan.lineup.map((a) => a.entry?.player.id ?? null);

const SLOTS: LineupSlot[] = ['QB', 'RB', 'WR', 'FLEX'];

describe('startSit', () => {
  it('reports no changes when the set lineup is already the best one', () => {
    const entries = [
      entry('qb1', 'QB', 900),
      entry('rb1', 'RB', 800),
      entry('wr1', 'WR', 700),
      entry('wr2', 'WR', 600),
      entry('rb2', 'RB', 100),
    ];

    const plan = startSit({
      entries,
      startingSlots: SLOTS,
      setLineup: ['qb1', 'rb1', 'wr1', 'wr2'],
    });

    expect(plan.changes).toEqual([]);
    expect(plan.gain).toBe(0);
    expect(plan.unset).toBe(false);
  });

  it('does not invent changes when the same players sit in different slots', () => {
    // wr1 and wr2 swapped between WR and FLEX. Same lineup, same value — a
    // slot-by-slot diff against the greedy arrangement would report two.
    const entries = [
      entry('qb1', 'QB', 900),
      entry('rb1', 'RB', 800),
      entry('wr1', 'WR', 700),
      entry('wr2', 'WR', 600),
    ];

    const plan = startSit({
      entries,
      startingSlots: SLOTS,
      setLineup: ['qb1', 'rb1', 'wr2', 'wr1'],
    });

    expect(plan.changes).toEqual([]);
    expect(ids(plan)).toEqual(['qb1', 'rb1', 'wr2', 'wr1']);
  });

  it('benches a starter who is out this week, though the season model starts him', () => {
    const entries = [
      entry('qb1', 'QB', 900),
      entry('rb1', 'RB', 800),
      entry('wr1', 'WR', 700, { status: 'out' }),
      entry('wr2', 'WR', 600),
      entry('wr3', 'WR', 500),
    ];

    const plan = startSit({
      entries,
      startingSlots: SLOTS,
      setLineup: ['qb1', 'rb1', 'wr1', 'wr2'],
    });

    expect(plan.lineup.some((a) => a.entry?.player.id === 'wr1')).toBe(false);
    const change = plan.changes.find((c) => c.sit?.player.id === 'wr1');
    expect(change?.cause).toBe('sidelined');
    expect(change?.status).toBe('out');
    expect(change?.start?.player.id).toBe('wr3');
  });

  it('starts a questionable player and flags him instead', () => {
    const entries = [
      entry('qb1', 'QB', 900),
      entry('rb1', 'RB', 800),
      entry('wr1', 'WR', 700, { status: 'questionable' }),
      entry('wr2', 'WR', 600),
      entry('wr3', 'WR', 500),
    ];

    const plan = startSit({
      entries,
      startingSlots: SLOTS,
      setLineup: ['qb1', 'rb1', 'wr1', 'wr2'],
    });

    expect(plan.changes).toEqual([]);
    expect(plan.watch.map((w) => w.player.id)).toEqual(['wr1']);
  });

  it('fills an empty slot and charges the whole starter to the gain', () => {
    const entries = [
      entry('qb1', 'QB', 900),
      entry('rb1', 'RB', 800),
      entry('wr1', 'WR', 700),
      entry('wr2', 'WR', 600),
    ];

    const plan = startSit({
      entries,
      startingSlots: SLOTS,
      setLineup: ['qb1', 'rb1', 'wr1', null],
    });

    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]).toMatchObject({
      slot: 'FLEX',
      cause: 'empty',
      sit: null,
      gain: 600,
    });
    expect(plan.changes[0].start?.player.id).toBe('wr2');
    expect(plan.gain).toBe(600);
  });

  it('names a starter who is no longer on the roster', () => {
    const entries = [
      entry('qb1', 'QB', 900),
      entry('rb1', 'RB', 800),
      entry('wr1', 'WR', 700),
      entry('wr2', 'WR', 600),
    ];

    const plan = startSit({
      entries,
      startingSlots: SLOTS,
      // 'gone' was traded away and is not in `entries` any more.
      setLineup: ['qb1', 'rb1', 'gone', 'wr2'],
    });

    const change = plan.changes.find((c) => c.slot === 'WR');
    expect(change?.cause).toBe('dropped');
    expect(change?.sit).toBeNull();
    expect(change?.start?.player.id).toBe('wr1');
  });

  it('counts a sidelined starter as nothing when valuing the set lineup', () => {
    const entries = [
      entry('qb1', 'QB', 900),
      entry('rb1', 'RB', 800),
      entry('wr1', 'WR', 700, { status: 'ir' }),
      entry('wr2', 'WR', 600),
    ];

    const plan = startSit({
      entries,
      startingSlots: SLOTS,
      setLineup: ['qb1', 'rb1', 'wr1', 'wr2'],
    });

    // A man on injured reserve scores nothing on Sunday, so the lineup he is in
    // is worth the other three.
    expect(plan.setValue).toBe(900 + 800 + 600);
  });

  it('fills an empty slot without disturbing the man in the superflex', () => {
    // The QB slot is empty and the only started QB is in the superflex. Moving
    // him up and refilling behind him is legal and scores the same, so the
    // recommendation leaves him alone and asks for one change, not two.
    const slots: LineupSlot[] = ['QB', 'RB', 'SUPER_FLEX'];
    const entries = [
      entry('qb1', 'QB', 900),
      entry('qb2', 'QB', 500),
      entry('rb1', 'RB', 800),
    ];

    const plan = startSit({
      entries,
      startingSlots: slots,
      setLineup: [null, 'rb1', 'qb1'],
    });

    expect(ids(plan)).toEqual(['qb2', 'rb1', 'qb1']);
    expect(plan.changes).toHaveLength(1);
    expect(plan.gain).toBe(500);
    expect(plan.changes.reduce((sum, c) => sum + c.gain, 0)).toBe(plan.gain);
  });

  it('keeps row gains summing to the headline gain when a starter has to move', () => {
    // The only running back is in the FLEX and the RB slot is empty, so he has
    // to move up and a receiver joins behind him. One row tidies, one adds.
    const entries = [entry('rb1', 'RB', 800), entry('wr1', 'WR', 700)];

    const plan = startSit({
      entries,
      startingSlots: ['RB', 'FLEX'],
      setLineup: [null, 'rb1'],
    });

    expect(ids(plan)).toEqual(['rb1', 'wr1']);
    expect(plan.gain).toBe(700);
    expect(plan.changes.reduce((sum, c) => sum + c.gain, 0)).toBe(plan.gain);
    // rb1 is not benched — he moves — so no row claims he is being sat down.
    const moved = plan.changes.find((c) => c.sit?.player.id === 'rb1');
    expect(moved?.sitStays).toBe(true);
    expect(plan.changes.find((c) => c.slot === 'RB')?.startIsNew).toBe(false);
  });

  it('recommends rather than corrects when no lineup has been set', () => {
    const entries = [entry('qb1', 'QB', 900), entry('rb1', 'RB', 800)];

    const plan = startSit({ entries, startingSlots: SLOTS, setLineup: [] });

    expect(plan.unset).toBe(true);
    expect(plan.changes).toEqual([]);
    expect(ids(plan)).toEqual(['qb1', 'rb1', null, null]);
  });

  it('ranks the changes by what they are worth', () => {
    const entries = [
      entry('qb1', 'QB', 900),
      entry('rb1', 'RB', 800),
      entry('wr1', 'WR', 700),
      entry('wr2', 'WR', 650),
      entry('rb2', 'RB', 640),
      entry('wr3', 'WR', 10),
    ];

    const plan = startSit({
      entries,
      startingSlots: SLOTS,
      // Both the WR and the FLEX are wrong; the WR slot costs more.
      setLineup: ['qb1', 'rb1', 'wr3', 'rb2'],
    });

    expect(plan.changes.map((c) => c.slot)).toEqual(['WR', 'FLEX']);
    expect(plan.changes[0].gain).toBeGreaterThan(plan.changes[1].gain);
  });

  it('leaves a slot empty rather than starting someone ineligible for it', () => {
    const entries = [entry('wr1', 'WR', 700)];

    const plan = startSit({
      entries,
      startingSlots: ['QB', 'WR'],
      setLineup: [null, 'wr1'],
    });

    expect(ids(plan)).toEqual([null, 'wr1']);
    // Nothing to recommend for the QB slot, and no pretending otherwise.
    expect(plan.changes).toEqual([]);
  });
});
