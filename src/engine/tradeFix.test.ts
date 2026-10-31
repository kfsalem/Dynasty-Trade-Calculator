import { describe, expect, it } from 'vitest';
import { fixTrade, isFair } from './tradeFix';
import type { TradeContext } from './trade';
import type { DraftPick, LeagueSettings, Player, PlayerValue } from '../types';
import {
  makeLeague,
  makePick,
  makePlayer,
  makeRoster,
  makeSettings,
  makeValue,
} from './testFixtures';

/** The two rosters of `trade.test.ts`, with market values that make the arithmetic plain. */
function context(
  overrides: { picks?: DraftPick[]; settings?: Partial<LeagueSettings> } = {},
): TradeContext {
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
  const values = new Map<string, PlayerValue>(
    (
      [
        ['qb_elite', 9000],
        ['qb_good', 5000],
        ['qb_bad', 500],
        ['wr_a', 8000],
        ['wr_b', 7000],
        ['wr_c', 6000],
        ['wr_d', 1000],
        ['rb_old', 3000],
      ] as const
    ).map(([id, value]) => [id, makeValue(id, value)]),
  );
  const league = makeLeague(
    [
      makeRoster(1, ['qb_bad', 'wr_a', 'wr_b', 'wr_c']),
      makeRoster(2, ['qb_elite', 'qb_good', 'wr_d', 'rb_old']),
    ],
    makeSettings(['QB', 'WR', 'WR'], overrides.settings),
  );
  return { league, players, values, picks: overrides.picks ?? [] };
}

const side = (rosterId: number, playerIds: string[], pickIds: string[] = []) => ({
  rosterId,
  playerIds,
  pickIds,
});

describe('fixTrade', () => {
  it('has the side sending less add the asset that evens it', () => {
    // 8000 for 5000: 37.5% apart. Team 2 adding its 3000 RB makes it level.
    const result = fixTrade(side(1, ['wr_a']), side(2, ['qb_good']), context());

    expect(result.fixes[0]).toMatchObject({ kind: 'add', rosterId: 2, adds: { id: 'rb_old' } });
    expect(result.fixes[0].sides).toEqual([side(1, ['wr_a']), side(2, ['qb_good', 'rb_old'])]);
    expect(result.fixes[0].analysis.valueDifferencePct).toBe(0);
    expect(result.fixes.every((fix) => isFair(fix.analysis))).toBe(true);
  });

  it('offers a pick from the lighter side, and never one from a league that forbids them', () => {
    const picks = [makePick('2027-2-2', '2027', 2, 2, 2800)];
    const withPicks = fixTrade(side(1, ['wr_a']), side(2, ['qb_good']), context({ picks }));
    expect(withPicks.fixes.map((fix) => fix.adds?.id)).toContain('2027-2-2');

    const banned = fixTrade(
      side(1, ['wr_a']),
      side(2, ['qb_good']),
      context({ picks, settings: { pickTrading: false } }),
    );
    expect(banned.fixes.map((fix) => fix.adds?.id)).not.toContain('2027-2-2');
  });

  it('has the side sending more take one back, or swap it for something cheaper', () => {
    // 14000 for 8000. Keeping wr_c levels it; sending qb_bad instead lands at 6%.
    const result = fixTrade(
      side(1, ['wr_a', 'wr_c']),
      side(2, ['qb_good', 'rb_old']),
      context(),
    );

    expect(result.fixes[0]).toMatchObject({ kind: 'remove', rosterId: 1, removes: { id: 'wr_c' } });
    const swap = result.fixes.find((fix) => fix.kind === 'swap');
    expect(swap).toMatchObject({ removes: { id: 'wr_c' }, adds: { id: 'qb_bad' } });
    expect(swap?.sides[0]).toEqual(side(1, ['wr_a', 'qb_bad']));
  });

  it('puts single changes before swaps, and offers at most three', () => {
    const picks = [
      makePick('p1', '2027', 1, 1, 6000),
      makePick('p2', '2027', 2, 1, 5800),
      makePick('p3', '2028', 1, 1, 5900),
    ];
    const result = fixTrade(
      side(1, ['wr_a', 'wr_c']),
      side(2, ['qb_good', 'rb_old']),
      context({ picks }),
    );
    expect(result.fixes.length).toBeLessThanOrEqual(3);
    const order = result.fixes.map((fix) => fix.kind);
    expect(order.indexOf('swap')).toBeGreaterThan(order.lastIndexOf('remove'));
  });

  it('never takes back the only asset a side sends', () => {
    const result = fixTrade(side(1, ['wr_a']), side(2, ['qb_good']), context());
    expect(result.fixes.some((fix) => fix.kind === 'remove')).toBe(false);
  });

  it('says how close it got when no single change works', () => {
    // 8000 for 1000. Team 2's nearest addition, its 9000 QB, overshoots to 20%.
    const result = fixTrade(side(1, ['wr_a']), side(2, ['wr_d']), context());
    expect(result.fixes).toEqual([]);
    expect(result.closest?.kind).toBe('add');
    expect(result.closest?.pct).toBeCloseTo(0.2);
    expect(result.rosterBlocked).toBe(false);
  });

  it('will not fill a roster past its limit, and says that is why', () => {
    // A four-man limit. Team 2 adding its RB sends team 1 a fifth player.
    const result = fixTrade(
      side(1, ['wr_a']),
      side(2, ['qb_good']),
      context({ settings: { allSlots: ['QB', 'WR', 'WR', 'BN'] } }),
    );
    expect(result.fixes.some((fix) => fix.adds?.id === 'rb_old')).toBe(false);
    expect(result.rosterBlocked).toBe(true);
  });

  it('states what a fix costs the conceding side in its starting lineup', () => {
    // 15000 for 5000. Team 2 adding qb_elite makes it 14000, fair, but sends
    // away the QB it starts, which the trade as built did not.
    const result = fixTrade(side(1, ['wr_a', 'wr_b']), side(2, ['qb_good']), context());
    const elite = result.fixes.find((fix) => fix.adds?.id === 'qb_elite');
    expect(elite).toBeDefined();
    expect(elite?.lineupCost).toBeGreaterThan(0);
  });
});
