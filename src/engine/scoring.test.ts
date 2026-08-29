import { describe, expect, it } from 'vitest';
import { SCORING_COLUMNS } from '../data/types';
import { classifyRules, scoreStatLine, scoreWeeks, statLine } from './scoring';
import type { ScoringSettings } from '../types';

/** Build a row the way the ingest does: positional, trailing zeros trimmed. */
function row(stats: Partial<Record<(typeof SCORING_COLUMNS)[number], number>>): number[] {
  const full = SCORING_COLUMNS.map((column) => stats[column] ?? 0);
  let end = full.length;
  while (end > 0 && full[end - 1] === 0) end--;
  return full.slice(0, end);
}

const PPR: ScoringSettings = {
  rec: 1,
  rec_yd: 0.1,
  rec_td: 6,
  rush_yd: 0.1,
  rush_td: 6,
  pass_yd: 0.04,
  pass_td: 4,
  pass_int: -2,
  fum_lost: -2,
};

describe('statLine', () => {
  it('reads a trimmed row back as zeros, not as missing', () => {
    const line = statLine(row({ week: 4, receptions: 5, recYards: 61 }));

    expect(line.receptions).toBe(5);
    expect(line.recYards).toBe(61);
    // Every kicking column was trimmed off the end of that row.
    expect(line.patMade).toBe(0);
    expect(line.fgMade50_59).toBe(0);
  });

  it('reads an untrimmed row identically', () => {
    const trimmed = statLine(row({ receptions: 3 }));
    const padded = statLine(SCORING_COLUMNS.map((c) => (c === 'receptions' ? 3 : 0)));

    expect(trimmed).toEqual(padded);
  });
});

describe('scoreStatLine', () => {
  it('scores a plain PPR line', () => {
    const line = statLine(row({ receptions: 6, recYards: 118, recTds: 1 }));
    expect(scoreStatLine(line, 'WR', PPR)).toBe(23.8);
  });

  /**
   * The defect this whole issue is about. The app read `rec` and nothing else,
   * so a tight end in a TE-premium league was priced as though the premium did
   * not exist.
   */
  it('pays the TE premium, and only to tight ends', () => {
    const line = statLine(row({ receptions: 6, recYards: 60 }));
    const tePremium: ScoringSettings = { ...PPR, bonus_rec_te: 0.5 };

    expect(scoreStatLine(line, 'TE', tePremium)).toBe(15);
    expect(scoreStatLine(line, 'WR', tePremium)).toBe(12);
  });

  it('pays six-point passing touchdowns where the league says six', () => {
    const line = statLine(row({ passYards: 250, passTds: 3 }));

    expect(scoreStatLine(line, 'QB', PPR)).toBe(22);
    expect(scoreStatLine(line, 'QB', { ...PPR, pass_td: 6 })).toBe(28);
  });

  it('pays a milestone bonus once, however far past it the player goes', () => {
    const scoring: ScoringSettings = { ...PPR, bonus_rush_yd_100: 3 };

    expect(scoreStatLine(statLine(row({ rushYards: 99 })), 'RB', scoring)).toBe(9.9);
    expect(scoreStatLine(statLine(row({ rushYards: 100 })), 'RB', scoring)).toBe(13);
    expect(scoreStatLine(statLine(row({ rushYards: 220 })), 'RB', scoring)).toBe(25);
  });

  it('adds the two nflverse buckets that make up Sleeper one 50+ rule', () => {
    const line = statLine(row({ fgMade50_59: 1, fgMade60: 1 }));
    expect(scoreStatLine(line, 'K', { fgm_50p: 5 })).toBe(10);
  });

  /**
   * A rule with no column contributes nothing rather than a guess. The absence
   * is the honest answer; `classifyRules` is what stops it being a silent one.
   */
  it('ignores a rule it cannot compute rather than inventing a number', () => {
    const line = statLine(row({ recTds: 1, receptions: 1, recYards: 55 }));

    expect(scoreStatLine(line, 'WR', { rec_td: 6, rec: 1, rec_yd: 0.1 })).toBe(12.5);
    // The 50-yard touchdown bonus is real, published, and unknowable from a
    // weekly total — so it is not paid.
    expect(scoreStatLine(line, 'WR', { rec_td: 6, rec: 1, rec_yd: 0.1, rec_td_50p: 2 })).toBe(12.5);
  });

  it('rounds to the cent, because a per-yard rule makes float error visible', () => {
    // 219 x 0.04 is 8.760000000000001 in IEEE 754, and Sleeper says 8.76.
    expect(scoreStatLine(statLine(row({ passYards: 219 })), 'QB', { pass_yd: 0.04 })).toBe(8.76);
  });

  it('scores a zero line at zero under any rulebook', () => {
    expect(scoreStatLine(statLine(row({})), 'WR', PPR)).toBe(0);
  });

  it('is unmoved by rules the league has switched off', () => {
    const line = statLine(row({ receptions: 4, recYards: 40 }));

    expect(scoreStatLine(line, 'TE', { ...PPR, bonus_rec_te: 0 })).toBe(
      scoreStatLine(line, 'TE', PPR),
    );
  });
});

describe('scoreWeeks', () => {
  it('totals a run of weeks', () => {
    const weeks = [
      // 4 + 4.0 = 8
      row({ week: 1, receptions: 4, recYards: 40 }),
      // 6 + 7.5 + 6 = 19.5
      row({ week: 2, receptions: 6, recYards: 75, recTds: 1 }),
    ];
    expect(scoreWeeks(weeks, 'WR', PPR)).toBe(27.5);
  });

  it('is zero for a player with no weeks', () => {
    expect(scoreWeeks([], 'WR', PPR)).toBe(0);
  });
});

describe('classifyRules', () => {
  it('ignores rules the league scores at zero', () => {
    // Sleeper publishes all 148 keys for every league, most of them zero.
    // Reporting an unused rule as an unsupported feature would bury the real
    // list in noise.
    const coverage = classifyRules({ rec: 1, rec_td_50p: 0, idp_tkl: 0 });

    expect(coverage.supported).toEqual(['rec']);
    expect(coverage.unreachable).toEqual([]);
    expect(coverage.defensive).toEqual([]);
  });

  it('names a long-touchdown bonus as unreachable rather than unsupported', () => {
    const coverage = classifyRules({ rec: 1, rec_td_50p: 2, pass_int_td: -2 });

    expect(coverage.unreachable).toEqual(['pass_int_td', 'rec_td_50p']);
    expect(coverage.unknown).toEqual([]);
  });

  /**
   * A league scoring its defense is not being short-changed by this engine —
   * the app does not value DEF or IDP at all (#10). Counting fifty defensive
   * rules as gaps would drown the handful that actually cost a skill player
   * points.
   */
  it('sets defensive rules aside instead of counting them as gaps', () => {
    const coverage = classifyRules({
      rec: 1,
      pts_allow_0: 10,
      idp_tkl_solo: 1,
      def_st_td: 6,
      sack: 1,
      int: 2,
      safe: 2,
    });

    expect(coverage.unreachable).toEqual([]);
    expect(coverage.unknown).toEqual([]);
    expect(coverage.defensive).toContain('pts_allow_0');
    expect(coverage.defensive).toContain('idp_tkl_solo');
    expect(coverage.defensive).toContain('sack');
  });

  it('reports a rule it has never heard of as unknown', () => {
    // Sleeper adds scoring keys without notice, and the honest answer to a new
    // one is to say it is not being scored.
    expect(classifyRules({ rec: 1, some_new_rule_2027: 3 }).unknown).toEqual([
      'some_new_rule_2027',
    ]);
  });
});
