import { describe, expect, it } from 'vitest';
import { adviseBid, budgetLeft, modelBids, priceFor, BID_PRIOR } from './bids';
import { makeHistory, makeRoster, makeSettings } from './testFixtures';
import type { LeagueTransaction, TransactionHistory } from '../platforms/types';
import type { LineupSlot, Position, WaiverSettings } from '../types';

const FAAB: WaiverSettings = { type: 2, budget: 100, minBid: null };
const ROLLING: WaiverSettings = { type: 0, budget: 100, minBid: null };

let seq = 0;

/** One winning claim: this much, for a player at this position. */
const claim = (
  playerId: string,
  bid: number,
  season = '2025',
  overrides: Partial<LeagueTransaction> = {},
): LeagueTransaction => ({
  id: `t${seq++}`,
  season,
  week: 3,
  type: 'waiver',
  succeeded: true,
  created: seq,
  rosterIds: [1],
  adds: new Map([[playerId, 1]]),
  drops: new Map(),
  picks: [],
  budget: [],
  bid,
  ...overrides,
});

/** A history whose every season ran the same waiver rules. */
function history(
  transactions: LeagueTransaction[],
  positions: Record<string, Position>,
  waivers: Record<string, WaiverSettings> = { '2025': FAAB },
): TransactionHistory {
  return makeHistory({
    transactions,
    seasons: Object.keys(waivers).sort().reverse(),
    waivers: new Map(Object.entries(waivers)),
    positions: new Map(Object.entries(positions)) as Map<string, Position>,
  });
}

const SLOTS: LineupSlot[] = ['QB', 'RB', 'WR', 'TE'];
const faabLeague = makeSettings(SLOTS, { waivers: FAAB });

describe('modelBids', () => {
  it('learns a mean bid per position, as a share of the budget', () => {
    const model = modelBids(
      history(
        [claim('rb1', 20), claim('rb2', 10), claim('wr1', 4)],
        { rb1: 'RB', rb2: 'RB', wr1: 'WR' },
      ),
      faabLeague,
    );

    expect(model.observations).toBe(3);
    expect(model.byPosition.get('RB')?.share).toBeCloseTo(0.15);
    expect(model.byPosition.get('WR')?.share).toBeCloseTo(0.04);
    expect(model.leagueShare).toBeCloseTo(34 / 300);
  });

  it("normalises each bid against the budget of its own season, not today's", () => {
    // The same $20 out of $50 is twice the claim that $20 out of $100 is, and a
    // league really does change its budget: the Eternal Rebuild went from $100
    // rolling waivers to a $150 FAAB between 2023 and 2024.
    const model = modelBids(
      history(
        [claim('rb1', 20, '2025'), claim('rb2', 20, '2024')],
        { rb1: 'RB', rb2: 'RB' },
        { '2025': FAAB, '2024': { type: 2, budget: 50, minBid: null } },
      ),
      faabLeague,
    );

    // 0.20 and 0.40, not one number twice.
    expect(model.byPosition.get('RB')?.share).toBeCloseTo(0.3);
  });

  it('ignores a season that did not run FAAB at all', () => {
    const model = modelBids(
      history(
        [claim('rb1', 20, '2025'), claim('rb2', 99, '2024')],
        { rb1: 'RB', rb2: 'RB' },
        { '2025': FAAB, '2024': ROLLING },
      ),
      faabLeague,
    );

    expect(model.observations).toBe(1);
    expect(model.seasons).toEqual(['2025']);
    expect(model.byPosition.get('RB')?.share).toBeCloseTo(0.2);
  });

  it('ignores a losing bid, which is a different quantity', () => {
    const model = modelBids(
      history(
        [claim('rb1', 20), claim('rb2', 60, '2025', { succeeded: false })],
        { rb1: 'RB', rb2: 'RB' },
      ),
      faabLeague,
    );

    expect(model.observations).toBe(1);
    expect(model.byPosition.get('RB')?.share).toBeCloseTo(0.2);
  });

  it('ignores a claim that brought back two players, which cannot be priced', () => {
    const two = claim('rb1', 60, '2025', {
      adds: new Map([
        ['rb1', 1],
        ['rb2', 1],
      ]),
    });
    const model = modelBids(history([claim('rb3', 20), two], { rb1: 'RB', rb2: 'RB', rb3: 'RB' }), faabLeague);

    expect(model.observations).toBe(1);
    expect(model.byPosition.get('RB')?.share).toBeCloseTo(0.2);
  });

  it('ignores a player the platform can no longer place', () => {
    const model = modelBids(history([claim('rb1', 20), claim('gone', 80)], { rb1: 'RB' }), faabLeague);

    expect(model.observations).toBe(1);
  });

  it('reports no budget at all in a league that does not run FAAB', () => {
    const model = modelBids(
      history([claim('rb1', 20)], { rb1: 'RB' }),
      makeSettings(SLOTS, { waivers: ROLLING }),
    );

    expect(model.budget).toBeNull();
    expect(priceFor(model, 'RB')).toBeNull();
  });

  it('survives a league with no transaction history at all', () => {
    const model = modelBids(undefined, faabLeague);

    expect(model.observations).toBe(0);
    expect(model.budget).toBe(100);
    expect(priceFor(model, 'RB')).toBeNull();
  });
});

describe('priceFor', () => {
  it('shrinks a thin position toward the league rate', () => {
    const model = modelBids(
      history(
        [
          claim('rb1', 40),
          ...Array.from({ length: 20 }, (_, i) => claim(`wr${i}`, 5)),
        ],
        { rb1: 'RB', ...Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`wr${i}`, 'WR'])) },
      ),
      faabLeague,
    );

    const rb = priceFor(model, 'RB')!;
    // One observation against a prior of seven: mostly the league's rate.
    expect(rb.weight).toBeCloseTo(1 / (1 + BID_PRIOR));
    expect(rb.value).toBeGreaterThan(model.leagueShare * 100);
    expect(rb.value).toBeLessThan(40);
  });

  it('gives a position nobody has ever claimed the league rate, at no weight', () => {
    const model = modelBids(history([claim('rb1', 20)], { rb1: 'RB' }), faabLeague);

    const te = priceFor(model, 'TE')!;
    expect(te.weight).toBe(0);
    expect(te.value).toBeCloseTo(model.leagueShare * 100);
    expect(te.observations).toBe(0);
  });

  it('carries the evidence into dollars without changing it', () => {
    const model = modelBids(
      history([claim('rb1', 20), claim('rb2', 30)], { rb1: 'RB', rb2: 'RB' }),
      faabLeague,
    );

    const rb = priceFor(model, 'RB')!;
    expect(rb.observations).toBe(2);
    expect(rb.prior).toBeCloseTo(model.leagueShare * 100);
  });
});

describe('budgetLeft', () => {
  const model = modelBids(history([claim('rb1', 20)], { rb1: 'RB' }), faabLeague);

  it('subtracts what the manager has spent', () => {
    const roster = { ...makeRoster(1, []), faabUsed: 30 };
    expect(budgetLeft(model, roster)).toBe(70);
  });

  it('reports more than the budget for a manager who acquired FAAB in a trade', () => {
    // Not a guard against bad data: one roster of the four-season test league
    // really does read -20 against a $150 league, and has $170 to spend.
    const roster = { ...makeRoster(1, []), faabUsed: -20 };
    expect(budgetLeft(model, roster)).toBe(120);
  });

  it('says nothing when the platform does not publish what he has spent', () => {
    expect(budgetLeft(model, makeRoster(1, []))).toBeNull();
  });
});

describe('adviseBid', () => {
  const model = modelBids(
    history(
      Array.from({ length: 10 }, (_, i) => claim(`rb${i}`, 20)),
      Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`rb${i}`, 'RB'])),
    ),
    faabLeague,
  );

  it('gives whole dollars', () => {
    const advice = adviseBid(model, 'RB', { ...makeRoster(1, []), faabUsed: 0 })!;
    expect(Number.isInteger(advice.dollars)).toBe(true);
    expect(advice.dollars).toBe(20);
  });

  it('never recommends less than the league says is legal', () => {
    const withMin = modelBids(
      history([claim('k1', 1)], { k1: 'K' }),
      makeSettings(SLOTS, { waivers: { type: 2, budget: 100, minBid: 5 } }),
    );

    const advice = adviseBid(withMin, 'K', { ...makeRoster(1, []), faabUsed: 0 })!;
    expect(advice.dollars).toBe(5);
  });

  it('says the price is past what this manager has, rather than quietly lowering it', () => {
    const advice = adviseBid(model, 'RB', { ...makeRoster(1, []), faabUsed: 95 })!;

    expect(advice.dollars).toBe(20);
    expect(advice.remaining).toBe(5);
    expect(advice.beyondBudget).toBe(true);
  });

  it('claims nothing about a budget the platform does not publish', () => {
    const advice = adviseBid(model, 'RB', makeRoster(1, []))!;

    expect(advice.remaining).toBeNull();
    expect(advice.beyondBudget).toBe(false);
  });

  it('gives no advice at all in a league that does not run FAAB', () => {
    const rolling = modelBids(history([claim('rb1', 20)], { rb1: 'RB' }), makeSettings(SLOTS, { waivers: ROLLING }));

    expect(adviseBid(rolling, 'RB', makeRoster(1, []))).toBeNull();
  });
});
