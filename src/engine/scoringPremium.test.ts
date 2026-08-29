import { describe, expect, it } from 'vitest';
import { SCORING_COLUMNS, type ScoringFile } from '../data/types';
import { marketBaseline, scoringPremium } from './scoringPremium';
import type { ScoringSettings } from '../types';

const VANILLA = marketBaseline(1);

/** A player-week row: [week, receptions, recYards, recTds, rushYards, rushTds, passYards, passTds]. */
const col = (name: (typeof SCORING_COLUMNS)[number]) => SCORING_COLUMNS.indexOf(name);

function week(stats: Partial<Record<(typeof SCORING_COLUMNS)[number], number>>): number[] {
  const full = SCORING_COLUMNS.map((c) => stats[c] ?? 0);
  let end = full.length;
  while (end > 0 && full[end - 1] === 0) end--;
  return full.slice(0, end);
}

/**
 * A league's worth of players, all identical within a position, so the ratios
 * are exactly computable by hand rather than approximately.
 */
function file(counts: Record<string, number>): ScoringFile {
  const perPosition: Record<string, Parameters<typeof week>[0]> = {
    QB: { passYards: 250, passTds: 2 },
    RB: { rushYards: 80, rushTds: 1, receptions: 3, recYards: 20 },
    WR: { receptions: 6, recYards: 80, recTds: 1 },
    TE: { receptions: 5, recYards: 50, recTds: 0 },
  };

  const players: ScoringFile['players'] = {};
  for (const [pos, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) {
      players[`${pos}${i}`] = {
        pos,
        team: 'KC',
        weeks: [week({ week: 1, ...perPosition[pos] })],
      };
    }
  }
  return {
    generatedAt: '2026-08-28T00:00:00.000Z',
    season: 2025,
    throughWeek: 1,
    source: 'test',
    columns: SCORING_COLUMNS,
    players,
  };
}

const POOL = file({ QB: 20, RB: 40, WR: 60, TE: 24 });
const STARTERS = { QB: 10, RB: 20, WR: 30, TE: 12 };

describe('scoringPremium', () => {
  /**
   * The contract that makes this safe to apply at all: a league scored the way
   * the market assumes gets no correction, and the app behaves precisely as it
   * did before it could read a rulebook.
   */
  it('finds nothing to correct in a league the market already prices', () => {
    expect(scoringPremium(POOL, VANILLA, STARTERS).measured).toBe(false);
  });

  it('finds nothing in a half-PPR league either, since ppr is a knob the market takes', () => {
    const half = scoringPremium(POOL, marketBaseline(0.5), STARTERS);
    expect(half.measured).toBe(false);
  });

  /**
   * The defect the whole issue is about, in one assertion. A TE premium lifts
   * tight ends against every other position, and the market that priced them
   * has never heard of it.
   */
  it('lifts tight ends in a TE-premium league, and only tight ends', () => {
    const premium = scoringPremium(POOL, { ...VANILLA, bonus_rec_te: 0.5 }, STARTERS);

    expect(premium.measured).toBe(true);
    expect(premium.byPosition.TE).toBeGreaterThan(1);
    for (const position of ['QB', 'RB', 'WR'] as const) {
      expect(premium.byPosition[position]).toBeLessThan(1);
    }
  });

  it('lifts quarterbacks where passing touchdowns are worth six', () => {
    const premium = scoringPremium(POOL, { ...VANILLA, pass_td: 6 }, STARTERS);

    expect(premium.byPosition.QB).toBeGreaterThan(1);
    expect(premium.byPosition.RB).toBeLessThan(1);
  });

  /**
   * Purely relative, and that is a property worth pinning: this reweights the
   * split between positions and must never inflate the league as a whole, or a
   * bonus-heavy league would simply value every player more than a plain one.
   */
  it('moves positions against each other without inflating the league', () => {
    const premium = scoringPremium(POOL, { ...VANILLA, bonus_rec_te: 0.5, pass_td: 6 }, STARTERS);
    const values = Object.values(premium.byPosition);

    expect(Math.max(...values)).toBeGreaterThan(1);
    expect(Math.min(...values)).toBeLessThan(1);
  });

  it('ignores a position nobody starts', () => {
    const premium = scoringPremium(POOL, { ...VANILLA, bonus_rec_te: 0.5 }, { TE: 12, WR: 30 });

    expect(premium.byPosition.QB).toBeUndefined();
    expect(premium.byPosition.RB).toBeUndefined();
  });

  /**
   * Kickers score nothing under the baseline, because the market's rulebook has
   * no kicking rules in it. A ratio there is a division by zero dressed as an
   * enormous premium.
   */
  it('refuses to price a position the market rulebook cannot score at all', () => {
    const withKickers: ScoringFile = {
      ...POOL,
      players: {
        ...POOL.players,
        K0: { pos: 'K', team: 'KC', weeks: [week({ week: 1, fgMade40_49: 2, patMade: 3 })] },
        K1: { pos: 'K', team: 'KC', weeks: [week({ week: 1, fgMade30_39: 2, patMade: 2 })] },
      },
    };
    const premium = scoringPremium(
      withKickers,
      { ...VANILLA, bonus_rec_te: 0.5, fgm_40_49: 4, xpm: 1 },
      { ...STARTERS, K: 1 },
    );

    expect(premium.byPosition.K).toBeUndefined();
    expect(premium.byPosition.TE).toBeGreaterThan(1);
  });

  it('measures nothing without stat lines', () => {
    expect(scoringPremium(null, { ...VANILLA, bonus_rec_te: 0.5 }, STARTERS).measured).toBe(
      false,
    );
  });

  it('measures nothing from a single position, which has nothing to be relative to', () => {
    expect(scoringPremium(POOL, { ...VANILLA, bonus_rec_te: 0.5 }, { TE: 12 }).measured).toBe(
      false,
    );
  });

  it('reports the season the stat lines came from', () => {
    expect(scoringPremium(POOL, { ...VANILLA, bonus_rec_te: 0.5 }, STARTERS).season).toBe(2025);
  });

  it('reads only the top N at a position, since deeper players fill no slot', () => {
    // Two tiers of tight end: the starters catch passes, the rest do not. A
    // premium measured over the whole pool would be diluted by players whose
    // scoring says nothing about the cost of filling a starting slot.
    const tiered: ScoringFile = {
      ...POOL,
      players: {
        ...POOL.players,
        ...Object.fromEntries(
          Array.from({ length: 30 }, (_, i) => [
            `TEdeep${i}`,
            { pos: 'TE', team: 'KC', weeks: [week({ week: 1, recYards: 5 })] },
          ]),
        ),
      },
    };

    const shallow = scoringPremium(tiered, { ...VANILLA, bonus_rec_te: 0.5 }, STARTERS);
    const deep = scoringPremium(tiered, { ...VANILLA, bonus_rec_te: 0.5 }, { ...STARTERS, TE: 40 });

    expect(shallow.byPosition.TE).toBeGreaterThan(deep.byPosition.TE as number);
  });
});

describe('marketBaseline', () => {
  it('carries the reception value the market was asked for, and platform defaults elsewhere', () => {
    const baseline: ScoringSettings = marketBaseline(0.5);

    expect(baseline.rec).toBe(0.5);
    expect(baseline.pass_td).toBe(4);
    expect(baseline.bonus_rec_te).toBeUndefined();
  });

  it('has no kicking rules, because the market prices no kickers', () => {
    expect(marketBaseline(1).xpm).toBeUndefined();
    expect(marketBaseline(1).fgm_40_49).toBeUndefined();
  });
});

// Keeps the column helper honest if SCORING_COLUMNS is ever reordered.
describe('the fixture helper', () => {
  it('writes stats into the columns it names', () => {
    const row = week({ week: 3, receptions: 5 });
    expect(row[0]).toBe(3);
    expect(row[col('receptions')]).toBe(5);
  });
});

describe('the premium and the panel that explains it', () => {
  /**
   * `positionScarcity` feeds the panel that teaches the model. Its levels come
   * back on the corrected scale, so a top-of-position price read uncorrected
   * would divide two different currencies — and the panel would teach a model
   * the engine does not run, which is the failure its own comment warns about.
   */
  it('measures retained value on one scale, not two', async () => {
    const { positionScarcity, replacementLevels } = await import('./replacement');
    const { makeValue } = await import('./testFixtures');

    const values = new Map(
      Array.from({ length: 30 }, (_, i) => [
        `te${i}`,
        makeValue(`te${i}`, 3000 - i * 80, 'TE', 3000 - i * 80),
      ]),
    );
    const starters = { TE: 12, WR: 12 };
    for (let i = 0; i < 30; i++) {
      values.set(`wr${i}`, makeValue(`wr${i}`, 3000 - i * 80, 'WR', 3000 - i * 80));
    }

    const premium = { byPosition: { TE: 1.2, WR: 0.9 }, measured: true, season: 2025 };
    const levels = replacementLevels(values, starters, premium);
    const scarcity = positionScarcity(values, levels, premium);

    // The share retained is a ratio of two numbers on the same scale, so a
    // uniform correction cannot move it — that is the invariant proving the
    // panel and the engine agree.
    const uncorrected = positionScarcity(values, replacementLevels(values, starters));
    expect(scarcity.TE?.retained).toBeCloseTo(uncorrected.TE?.retained as number, 10);
  });
});
