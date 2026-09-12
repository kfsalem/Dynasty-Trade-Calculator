import { describe, expect, it } from 'vitest';
import { analyzeTeam, positionalStarterValue } from './analysis';
import {
  bareSlots,
  fragility,
  slotOccupants,
  slotStrengths,
  starterDepth,
} from './rosterDepth';
import { summarizeRoster, type RosterSummary } from './rosterValue';
import type {
  LeagueSettings,
  LineupSlot,
  Player,
  PlayerValue,
  Position,
  Roster,
} from '../types';
import { makePlayer, makeRoster, makeSettings, makeValue } from './testFixtures';

/**
 * Build a league from a list of per-roster values at one position.
 *
 * Every player is the same age and position, so nothing here can be explained
 * by decay or by eligibility — the only thing that varies is how a roster's
 * value is distributed across its slots, which is the whole subject.
 */
function league(
  slots: LineupSlot[],
  teams: number[][],
  position: Position = 'WR',
): { summaries: RosterSummary[]; settings: LeagueSettings } {
  const players = new Map<string, Player>();
  const values = new Map<string, PlayerValue>();
  const rosters: Roster[] = [];
  const settings = makeSettings(slots, { teamCount: teams.length });

  teams.forEach((team, t) => {
    const ids: string[] = [];
    team.forEach((value, i) => {
      const id = `t${t + 1}_${i}`;
      players.set(id, makePlayer(id, position, 25));
      values.set(id, makeValue(id, value));
      ids.push(id);
    });
    rosters.push(makeRoster(t + 1, ids));
  });

  return {
    summaries: rosters.map((r) => summarizeRoster(r, players, values, settings)),
    settings,
  };
}

/**
 * A roster of named players at chosen positions, valued as given.
 *
 * A `null` value leaves the player out of the value map entirely, which is what
 * a kicker or a defence actually is here — not priced at zero, but absent.
 */
function roster(
  slots: LineupSlot[],
  men: [string, Position, number | null][],
): { summary: RosterSummary; slots: LineupSlot[]; settings: LeagueSettings } {
  const players = new Map<string, Player>();
  const values = new Map<string, PlayerValue>();
  const settings = makeSettings(slots);

  for (const [id, position, value] of men) {
    players.set(id, makePlayer(id, position, 25));
    if (value !== null) values.set(id, makeValue(id, value));
  }

  return {
    summary: summarizeRoster(
      makeRoster(1, men.map(([id]) => id)),
      players,
      values,
      settings,
    ),
    slots,
    settings,
  };
}

describe('slotOccupants', () => {
  it('drops the ordinal when a slot kind appears once', () => {
    const { summary } = roster(['QB', 'RB'], [
      ['qb', 'QB', 900],
      ['rb', 'RB', 500],
    ]);

    expect(slotOccupants(summary.lineup).map((s) => s.label).sort()).toEqual(['QB', 'RB']);
  });

  it('ranks repeats by win-now value, not by the order the filler used', () => {
    const { summary } = roster(['WR', 'WR', 'WR'], [
      ['a', 'WR', 400],
      ['b', 'WR', 900],
      ['c', 'WR', 650],
    ]);

    expect(
      slotOccupants(summary.lineup).map((s) => [s.label, s.entry?.player.id, s.value]),
    ).toEqual([
      ['WR1', 'b', 900],
      ['WR2', 'c', 650],
      ['WR3', 'a', 400],
    ]);
  });

  it('sorts an unfilled slot to the bottom and reports it as worth nothing', () => {
    const { summary } = roster(['WR', 'WR'], [['a', 'WR', 700]]);

    expect(slotOccupants(summary.lineup).map((s) => [s.label, s.entry, s.value])).toEqual([
      ['WR1', expect.objectContaining({ value: 700 }), 700],
      ['WR2', null, 0],
    ]);
  });
});

describe('slotStrengths', () => {
  /**
   * The bug this module exists to fix, as a fixture.
   *
   * Team 1 carries two elite receivers and nothing at WR3. Summed across the
   * lineup it has the *most* receiver value in the league, so the position-level
   * z-score calls it a strength. At the slot it is actually fielding, its WR3 is
   * the worst in the league by a distance.
   *
   * Both statements are arithmetically correct. Only one of them is about a
   * lineup a manager fields on a Sunday.
   */
  const hidden = () =>
    league(
      ['WR', 'WR', 'WR'],
      [
        [3000, 3000, 100], // two elite, a hole behind them — 6100
        [2000, 2000, 2000], // 6000
        [2100, 2000, 1900], // 6000
        [2000, 1900, 1800], // 5700
      ],
    );

  it('the position sum calls the roster with a hole a strength at WR', () => {
    const { summaries, settings } = hidden();

    expect(positionalStarterValue(summaries[0]).WR).toBe(6100);

    // Not merely "fails to report a weakness" — the summed measure affirmatively
    // grades the hole as a strength, because 6100 is the most receiver value in
    // the league and that is the only thing it can see.
    const wr = analyzeTeam(1, summaries, settings)?.positions.find((p) => p.position === 'WR');
    expect(wr?.verdict).toBe('strength');
  });

  it('the slot measure finds the hole the sum hides', () => {
    const { summaries } = hidden();
    const byLabel = new Map(slotStrengths(summaries[0], summaries).map((s) => [s.label, s]));

    expect(byLabel.get('WR1')?.verdict).toBe('strength');
    expect(byLabel.get('WR2')?.verdict).toBe('strength');

    const wr3 = byLabel.get('WR3');
    expect(wr3?.value).toBe(100);
    expect(wr3?.verdict).toBe('weakness');
    expect(wr3?.rank).toBe(4);
    expect(wr3?.leagueMedian).toBe(1850);
  });

  it('ranks and shares a slot against the same slot on every roster', () => {
    const { summaries } = hidden();
    const wr3 = slotStrengths(summaries[1], summaries).find((s) => s.label === 'WR3');

    // 2000 is the best WR3 in a league of [100, 2000, 1900, 1800].
    expect(wr3?.rank).toBe(1);
    expect(wr3?.share).toBe(1);
    expect(wr3?.teamCount).toBe(4);
  });

  it('reads a one-team league as exactly average rather than as an extreme', () => {
    const { summaries } = league(['WR', 'WR'], [[900, 400]]);
    const slots = slotStrengths(summaries[0], summaries);

    expect(slots.map((s) => [s.label, s.share, s.z, s.verdict])).toEqual([
      ['WR1', 0.5, 0, 'neutral'],
      ['WR2', 0.5, 0, 'neutral'],
    ]);
  });
});

describe('starterDepth', () => {
  it('measures the drop the cascade actually costs, not the man removed', () => {
    // WR takes the best receiver, FLEX takes the second. The running back is
    // benched behind them.
    const { summary, slots } = roster(['WR', 'FLEX'], [
      ['wr_a', 'WR', 1000],
      ['wr_b', 'WR', 600],
      ['rb_c', 'RB', 500],
    ]);

    const depth = starterDepth(summary, slots);
    const a = depth.find((d) => d.entry.player.id === 'wr_a');

    // Losing a 1000 receiver costs 500: WR_B slides up into the WR slot and the
    // bench back takes the FLEX behind him. The lineup loses the bottom of the
    // chain, not the top.
    expect(a?.marginalValue).toBe(500);
    expect(a?.replacement?.player.id).toBe('rb_c');
    expect(a?.uncovered).toBe(false);
  });

  it('reports a slot a current starter can slide across into as covered', () => {
    // The case a direct eligibility test gets wrong: the only other tight end
    // is already starting, in the FLEX.
    const { summary, slots } = roster(['TE', 'FLEX'], [
      ['te_a', 'TE', 800],
      ['te_b', 'TE', 500],
      ['rb_c', 'RB', 300],
    ]);

    const a = starterDepth(summary, slots).find((d) => d.entry.player.id === 'te_a');

    expect(a?.uncovered).toBe(false);
    expect(a?.marginalValue).toBe(500);
    expect(a?.replacement?.player.id).toBe('rb_c');
  });

  it('reports a slot with nothing behind it as uncovered', () => {
    const { summary, slots } = roster(['QB', 'WR'], [
      ['qb', 'QB', 900],
      ['wr', 'WR', 700],
    ]);

    const qb = starterDepth(summary, slots).find((d) => d.entry.player.id === 'qb');

    expect(qb?.uncovered).toBe(true);
    expect(qb?.marginalValue).toBe(900);
    expect(qb?.replacement).toBeNull();
  });

  it('orders starters by what their absence would cost', () => {
    const { summary, slots } = roster(['QB', 'WR', 'WR'], [
      ['qb', 'QB', 900],
      ['wr_a', 'WR', 800],
      ['wr_b', 'WR', 600],
      ['wr_c', 'WR', 550],
    ]);

    // The quarterback has nothing behind him and costs his whole value; the
    // receivers cost only the gap down to the spare.
    expect(starterDepth(summary, slots).map((d) => [d.entry.player.id, d.marginalValue])).toEqual([
      ['qb', 900],
      ['wr_a', 250],
      ['wr_b', 50],
    ]);
  });
});

describe('fragility', () => {
  it('counts the slots with nothing behind them and the worst single loss', () => {
    const { summary, slots } = roster(['QB', 'TE', 'WR'], [
      ['qb', 'QB', 900],
      ['te', 'TE', 400],
      ['wr_a', 'WR', 700],
      ['wr_b', 'WR', 650],
    ]);

    const f = fragility(summary, slots);

    // Only the receiver has cover. The quarterback and tight end are each one
    // absence from a slot this roster cannot fill.
    expect(f.uncoveredSlots).toBe(2);
    expect(f.worstDrop).toBe(900);
    expect(f.starters.filter((s) => s.uncovered).map((s) => s.entry.player.id).sort()).toEqual([
      'qb',
      'te',
    ]);
  });

  it('reports a fully covered lineup as fragile nowhere', () => {
    const { summary, slots } = roster(['WR', 'WR'], [
      ['a', 'WR', 900],
      ['b', 'WR', 800],
      ['c', 'WR', 700],
    ]);

    expect(fragility(summary, slots).uncoveredSlots).toBe(0);
  });
});

describe('analyzeTeam, on the slot measure', () => {
  /** The same hidden hole, read end to end through the team analysis. */
  const hidden = () =>
    league(
      ['WR', 'WR', 'WR'],
      [
        [3000, 3000, 100],
        [2000, 2000, 2000],
        [2100, 2000, 1900],
        [2000, 1900, 1800],
      ],
    );

  it('names the hole the position-level verdict had no way to report', () => {
    const { summaries, settings } = hidden();
    const analysis = analyzeTeam(1, summaries, settings);

    // The old basis finds nothing wrong with this roster at all.
    expect(analysis?.weaknesses).toEqual([]);

    // The new one names the slot, and says where it ranks.
    expect(analysis?.slotWeaknesses.map((s) => s.label)).toEqual(['WR3']);
    expect(analysis?.focus.some((line) => line.includes('weakest spot is WR3'))).toBe(true);
    expect(analysis?.focus.some((line) => line.includes('4 of 4'))).toBe(true);
  });

  it('says nothing about a weak spot when every slot is in line with the league', () => {
    const { summaries, settings } = league(
      ['WR', 'WR'],
      [
        [2000, 1900],
        [2000, 1900],
        [2050, 1850],
      ],
    );
    const analysis = analyzeTeam(1, summaries, settings);

    expect(analysis?.slotWeaknesses).toEqual([]);
    expect(analysis?.focus.some((line) => line.includes('weakest spot'))).toBe(false);
  });

  it('counts a bare slot separately from a weak one', () => {
    // A strong quarterback with nobody behind him: not a weakness by any
    // measure, and still one absence from fielding a man short.
    const { summary, slots, settings } = roster(['QB', 'WR', 'WR'], [
      ['qb', 'QB', 3000],
      ['wr_a', 'WR', 900],
      ['wr_b', 'WR', 850],
      ['wr_c', 'WR', 800],
    ]);
    const analysis = analyzeTeam(1, [summary], settings);

    expect(analysis?.depth.uncoveredSlots).toBe(1);
    expect(analysis?.slotWeaknesses).toEqual([]);

    const line = analysis?.focus.find((l) => l.includes('no cover'));
    expect(line).toContain('Player qb (QB)');
    expect(line).toContain('field a man short');
    expect(fragility(summary, slots).worstDrop).toBe(3000);
  });
});

describe('fragility, against slots nobody covers on purpose', () => {
  it('does not count a bare kicker slot, which every roster in the league has', () => {
    // Nobody carries a backup kicker. Counting the raw fact would put the same
    // warning on every team every week and teach the reader to skip the line.
    const { summary, slots, settings } = roster(['QB', 'K'], [
      ['qb_a', 'QB', 3000],
      ['qb_b', 'QB', 1200],
      ['k', 'K', null],
    ]);

    // The kicker slot genuinely cannot be refilled — the fact is still reported.
    const k = starterDepth(summary, slots).find((d) => d.entry.player.id === 'k');
    expect(k?.uncovered).toBe(true);
    expect(k?.marginalValue).toBe(0);

    // It just does not count as fragility, and nothing is said about it.
    expect(fragility(summary, slots).uncoveredSlots).toBe(0);
    expect(analyzeTeam(1, [summary], settings)?.focus.some((l) => l.includes('no cover'))).toBe(
      false,
    );
  });

  it('still counts a bare slot that costs real value', () => {
    const { summary, slots } = roster(['QB', 'K'], [
      ['qb', 'QB', 3000],
      ['k', 'K', null],
    ]);

    // Same league, same bare kicker — but now the quarterback has nobody behind
    // him either, and that one is worth saying.
    const f = fragility(summary, slots);
    expect(f.uncoveredSlots).toBe(1);
    expect(bareSlots(f.starters).map((s) => s.entry.player.id)).toEqual(['qb']);
  });
});
