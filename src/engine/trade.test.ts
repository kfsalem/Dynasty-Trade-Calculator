import { describe, expect, it } from 'vitest';
import { evaluateTrade, type TradeContext } from './trade';
import type { DraftPick, Player, PlayerValue } from '../types';
import {
  makeLeague,
  makePick,
  makePlayer,
  makeRoster,
  makeSettings,
  makeValue,
} from './testFixtures';

/**
 * Two teams, one QB + two WR slots each, so lineup effects are easy to reason
 * about.
 *
 * Team 1 has three startable WRs for two slots (surplus WR) and a replacement-
 * level QB. Team 2 has two startable QBs for one slot (surplus QB) and cannot
 * fill its second WR slot. That mirrored surplus is what makes a mutually
 * beneficial trade possible at all.
 */
function context(overrides: { picks?: DraftPick[] } = {}): TradeContext {
  const players = new Map<string, Player>([
    ['qb_elite', makePlayer('qb_elite', 'QB', 26)],
    ['qb_good', makePlayer('qb_good', 'QB', 27)],
    ['qb_bad', makePlayer('qb_bad', 'QB', 33)],
    ['wr_a', makePlayer('wr_a', 'WR', 24)],
    ['wr_b', makePlayer('wr_b', 'WR', 25)],
    ['wr_c', makePlayer('wr_c', 'WR', 26)],
    ['wr_d', makePlayer('wr_d', 'WR', 31)],
    ['rb_old', makePlayer('rb_old', 'RB', 29)],
  ]);

  const values = new Map<string, PlayerValue>([
    ['qb_elite', makeValue('qb_elite', 9000)],
    ['qb_good', makeValue('qb_good', 5000)],
    ['qb_bad', makeValue('qb_bad', 500)],
    ['wr_a', makeValue('wr_a', 8000)],
    ['wr_b', makeValue('wr_b', 7000)],
    ['wr_c', makeValue('wr_c', 6000)],
    ['wr_d', makeValue('wr_d', 1000)],
    ['rb_old', makeValue('rb_old', 3000)],
  ]);

  const settings = makeSettings(['QB', 'WR', 'WR']);
  const league = makeLeague(
    [
      makeRoster(1, ['qb_bad', 'wr_a', 'wr_b', 'wr_c']),
      makeRoster(2, ['qb_elite', 'qb_good', 'wr_d', 'rb_old']),
    ],
    settings,
  );

  return { league, players, values, picks: overrides.picks ?? [] };
}

describe('evaluateTrade', () => {
  it('reports raw net value for both sides', () => {
    const ctx = context();
    const result = evaluateTrade(
      { rosterId: 1, playerIds: ['wr_c'], pickIds: [] },
      { rosterId: 2, playerIds: ['rb_old'], pickIds: [] },
      ctx,
    );

    // Team 1 sends 6000, receives 3000.
    expect(result.sides[0].outgoingValue).toBe(6000);
    expect(result.sides[0].incomingValue).toBe(3000);
    expect(result.sides[0].netValue).toBe(-3000);
    expect(result.sides[1].netValue).toBe(3000);
    expect(result.favors).toBe(2);
  });

  it('flags a trade that wins on value but weakens the starting lineup', () => {
    const ctx = context();
    // Team 1 turns its WR3 (a non-starter, since only 2 WR slots exist) into a
    // bench RB. Raw value drops, but the lineup is untouched.
    const benchSwap = evaluateTrade(
      { rosterId: 1, playerIds: ['wr_c'], pickIds: [] },
      { rosterId: 2, playerIds: ['rb_old'], pickIds: [] },
      ctx,
    );
    expect(benchSwap.sides[0].vorsDelta).toBe(0);

    // Now team 1 sends a genuine starter for the same bench RB.
    const starterSwap = evaluateTrade(
      { rosterId: 1, playerIds: ['wr_a'], pickIds: [] },
      { rosterId: 2, playerIds: ['rb_old'], pickIds: [] },
      ctx,
    );
    // wr_a (8000) leaves the lineup, wr_c (6000) is promoted: -2000.
    expect(starterSwap.sides[0].vorsDelta).toBe(-2000);
    expect(starterSwap.sides[0].warnings).toContain(
      'Starting lineup gets weaker despite the incoming value.',
    );
  });

  it('recognises a trade where both teams improve their starters', () => {
    const ctx = context();
    // Surplus for surplus: team 1's third WR (bench) for team 2's second QB
    // (bench). Each asset walks into a starting slot on the other roster.
    const result = evaluateTrade(
      { rosterId: 1, playerIds: ['wr_c'], pickIds: [] },
      { rosterId: 2, playerIds: ['qb_good'], pickIds: [] },
      ctx,
    );

    // Team 1: qb_bad (500) upgraded to qb_good (5000).
    expect(result.sides[0].vorsDelta).toBe(4500);
    // Team 2: an empty WR slot filled by wr_c (6000).
    expect(result.sides[1].vorsDelta).toBe(6000);
    expect(result.summary).toContain('Both teams improve');
  });

  it('nets a positional downgrade against filling an empty slot', () => {
    const ctx = context();
    // Team 2 ships its best QB but finally fills a vacant WR slot.
    const result = evaluateTrade(
      { rosterId: 1, playerIds: ['wr_c'], pickIds: [] },
      { rosterId: 2, playerIds: ['qb_elite'], pickIds: [] },
      ctx,
    );

    // QB drops 9000 -> 5000 (-4000); the empty WR slot gains wr_c (+6000).
    expect(result.sides[1].vorsDelta).toBe(2000);
  });

  it('does not call a trade mutual when one side downgrades its lineup', () => {
    const ctx = context();
    // Team 1 ships a starting WR for a bench RB — a clear lineup downgrade.
    const result = evaluateTrade(
      { rosterId: 1, playerIds: ['wr_a'], pickIds: [] },
      { rosterId: 2, playerIds: ['rb_old'], pickIds: [] },
      ctx,
    );

    expect(result.sides[0].vorsDelta).toBeLessThan(0);
    expect(result.summary).not.toContain('Both teams improve');
  });

  it('rates an even trade as fair and picks no winner', () => {
    const ctx = context();
    const result = evaluateTrade(
      { rosterId: 1, playerIds: ['wr_b'], pickIds: [] },
      { rosterId: 2, playerIds: ['qb_elite'], pickIds: [] },
      ctx,
    );
    // 7000 vs 9000 is a 22% gap.
    expect(result.fairnessRating).toBe('unfair');

    const even = evaluateTrade(
      { rosterId: 1, playerIds: ['wr_a'], pickIds: [] },
      { rosterId: 2, playerIds: ['qb_elite'], pickIds: [] },
      ctx,
    );
    // 8000 vs 9000 is an 11% gap.
    expect(even.fairnessRating).toBe('slightly_unfair');
  });

  it('counts pick value but keeps picks out of lineup strength', () => {
    const picks: DraftPick[] = [
      makePick('2027-1-2', '2027', 1, 2, 4000),
    ];
    const ctx = context({ picks });

    const result = evaluateTrade(
      { rosterId: 1, playerIds: ['wr_a'], pickIds: [] },
      { rosterId: 2, playerIds: [], pickIds: ['2027-1-2'] },
      ctx,
    );

    expect(result.sides[0].incomingValue).toBe(4000);
    // Team 1 gave up a starter for a pick, so its lineup got worse even though
    // it received real value. This is the contender/rebuilder tension.
    expect(result.sides[0].vorsDelta).toBeLessThan(0);
    expect(result.sides[1].vorsDelta).toBeGreaterThan(0);
  });

  it('warns when incoming players are past the positional age cliff', () => {
    const ctx = context();
    const result = evaluateTrade(
      { rosterId: 1, playerIds: ['wr_c'], pickIds: [] },
      { rosterId: 2, playerIds: ['rb_old'], pickIds: [] },
      ctx,
    );
    // rb_old is 29, past the RB cliff of 26.
    expect(result.sides[0].warnings.join(' ')).toContain('age cliff');
  });

  it('warns when an incoming player cannot fill a slot this season', () => {
    // The lineup maths already prices him at nothing. It prices him at nothing
    // in a number that could equally mean he is a bad player, and the two facts
    // a manager wants before accepting are that he is hurt and how badly.
    const ctx = context();
    ctx.players.set('wr_hurt', makePlayer('wr_hurt', 'WR', 25, { status: 'ir' }));
    ctx.values.set('wr_hurt', makeValue('wr_hurt', 8000));
    ctx.league.rosters[1].playerIds.push('wr_hurt');

    // wr_a for wr_hurt: two receivers priced identically, one of whom plays.
    const result = evaluateTrade(
      { rosterId: 1, playerIds: ['wr_a'], pickIds: [] },
      { rosterId: 2, playerIds: ['wr_hurt'], pickIds: [] },
      ctx,
    );

    const warning = result.sides[0].warnings.join(' ');
    expect(warning).toContain('cannot fill a starting slot this season');
    expect(warning).toContain('on injured reserve');

    // And the arithmetic agrees with the sentence. Dead even on raw value, and
    // the lineup drops by the whole gap between the starter who left and the
    // bench receiver who replaces him.
    expect(result.sides[0].netValue).toBe(0);
    expect(result.sides[0].vorsDelta).toBe(-2000); // wr_a 8,000 out, wr_c 6,000 in
    expect(result.sides[0].warnings.join(' ')).toContain('Starting lineup gets weaker');
  });

  it('names a week-to-week knock without discounting anything for it', () => {
    const ctx = context();
    ctx.players.set(
      'wr_knock',
      makePlayer('wr_knock', 'WR', 25, { status: 'questionable' }),
    );
    ctx.values.set('wr_knock', makeValue('wr_knock', 6000));
    ctx.league.rosters[1].playerIds.push('wr_knock');

    const result = evaluateTrade(
      { rosterId: 1, playerIds: ['wr_c'], pickIds: [] },
      { rosterId: 2, playerIds: ['wr_knock'], pickIds: [] },
      ctx,
    );

    const warning = result.sides[0].warnings.join(' ');
    expect(warning).toContain('Week to week');
    expect(warning).not.toContain('cannot fill a starting slot');
    // Straight swap of equals: he starts, so nothing moves.
    expect(result.sides[0].vorsDelta).toBe(0);
  });

  it('warns when a side ships most of its pick capital', () => {
    const picks: DraftPick[] = [
      makePick('2027-1-1', '2027', 1, 1, 4000),
      makePick('2027-2-1', '2027', 2, 1, 1000),
    ];
    const ctx = context({ picks });

    const result = evaluateTrade(
      { rosterId: 1, playerIds: [], pickIds: ['2027-1-1'] },
      { rosterId: 2, playerIds: ['wr_d'], pickIds: [] },
      ctx,
    );
    expect(result.sides[0].warnings.join(' ')).toContain('pick capital');
  });

  it('counts taxi and IR slots toward the roster limit', () => {
    // roster_positions covers starters + bench only. A league with taxi and IR
    // allowances legitimately rosters more than that, and warning about it on
    // every trade would make the warning worthless.
    const ctx = context();
    ctx.league.settings.allSlots = ['QB', 'WR', 'WR', 'BN'];
    ctx.league.settings.taxiSlots = 5;
    ctx.league.settings.reserveSlots = 3;

    const result = evaluateTrade(
      { rosterId: 1, playerIds: ['wr_c'], pickIds: [] },
      { rosterId: 2, playerIds: ['rb_old'], pickIds: [] },
      ctx,
    );
    // Cap is 4 + 5 + 3 = 12; both rosters are far under it.
    expect(result.sides[0].warnings.join(' ')).not.toContain('spot limit');
    expect(result.sides[1].warnings.join(' ')).not.toContain('spot limit');
  });

  it('does not warn about roster size when a trade removes players', () => {
    const ctx = context();
    // Tiny cap, but team 1 sends two and receives one — it shrinks.
    ctx.league.settings.allSlots = ['QB'];
    ctx.league.settings.taxiSlots = 0;
    ctx.league.settings.reserveSlots = 0;

    const result = evaluateTrade(
      { rosterId: 1, playerIds: ['wr_b', 'wr_c'], pickIds: [] },
      { rosterId: 2, playerIds: ['rb_old'], pickIds: [] },
      ctx,
    );
    expect(result.sides[0].warnings.join(' ')).not.toContain('spot limit');
    // Team 2 gained a net player and is over its 1-spot cap.
    expect(result.sides[1].warnings.join(' ')).toContain('spot limit');
  });

  it('throws on an unknown roster rather than silently valuing nothing', () => {
    const ctx = context();
    expect(() =>
      evaluateTrade(
        { rosterId: 99, playerIds: [], pickIds: [] },
        { rosterId: 2, playerIds: [], pickIds: [] },
        ctx,
      ),
    ).toThrow(/Unknown roster/);
  });
});
