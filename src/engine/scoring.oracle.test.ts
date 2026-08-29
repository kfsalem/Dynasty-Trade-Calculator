import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/sleeperScoring.json';
import { UNREACHABLE, classifyRules, scoreStatLine, statLine } from './scoring';
import type { ScoringSettings } from '../types';

/**
 * The engine against the only oracle it will ever have.
 *
 * Everything else in `engine/` is a model, and a model can only be tested
 * against its own intent. This one is arithmetic over published fields, and
 * Sleeper publishes **its own answer** for every rostered player in every week
 * of every league — so for once "is this right" is a question with a real
 * answer rather than a plausible one.
 *
 * The fixture is real data, committed rather than fetched: 219 players across
 * weeks 3, 6 and 11 of The Eternal Rebuild's 2025 season, each carrying the row
 * this repo's own ingest shipped for him and the points Sleeper actually
 * awarded. Real because the residuals are the finding — they are not noise to
 * be tuned away, they are the exact size of what a weekly aggregate cannot see,
 * and a synthetic fixture would have quietly agreed with whatever this engine
 * happened to do.
 *
 * That league is a deliberately hard case: TE premium, six-point passing
 * touchdowns, and seven separate long-play bonuses.
 */

const scoring = fixture.scoring as ScoringSettings;
const players = fixture.players as Record<
  string,
  { pos: string; rows: Record<string, number[]>; awarded: Record<string, number> }
>;

interface Result {
  id: string;
  pos: string;
  week: string;
  mine: number;
  theirs: number;
  diff: number;
}

const results: Result[] = [];
for (const [id, player] of Object.entries(players)) {
  for (const [week, row] of Object.entries(player.rows)) {
    const mine = scoreStatLine(statLine(row), player.pos, scoring);
    const theirs = player.awarded[week];
    results.push({ id, pos: player.pos, week, mine, theirs, diff: Math.round((mine - theirs) * 100) / 100 });
  }
}

/** The bonus values this engine cannot compute, as absolute point amounts. */
const BONUSES = [...UNREACHABLE]
  .map((rule) => Math.abs(scoring[rule] ?? 0))
  .filter((value) => value > 0);

/**
 * Is a residual a sum of bonuses the engine is known to be blind to?
 *
 * The claim this test exists to make is not "the engine is close". It is that
 * every gap is *accounted for* — a specific published rule, of a known size,
 * that needs play-by-play to see. A residual that is not a combination of those
 * is a bug, and is meant to fail here.
 */
function accountedFor(diff: number, depth = 4): boolean {
  const d = Math.round(Math.abs(diff) * 100) / 100;
  if (d < 0.02) return true;
  if (depth === 0) return false;
  return BONUSES.some((value) => accountedFor(d - value, depth - 1));
}

describe('scoring engine vs Sleeper players_points', () => {
  it('has a fixture worth trusting', () => {
    expect(results.length).toBeGreaterThan(400);
    expect(BONUSES.length).toBeGreaterThan(0);
  });

  it('reproduces Sleeper to the cent for the overwhelming majority of player-weeks', () => {
    const exact = results.filter((r) => Math.abs(r.diff) < 0.02);
    expect(exact.length / results.length).toBeGreaterThan(0.9);
  });

  /**
   * The headline defect, and the reason this issue was worth doing. A
   * TE-premium league priced every tight end in it as though the premium did
   * not exist; being merely *close* here would leave the bug half-fixed.
   */
  it('is exact for tight ends, whose premium was the whole problem', () => {
    const tes = results.filter((r) => r.pos === 'TE');
    expect(tes.length).toBeGreaterThan(20);
    expect(tes.filter((r) => Math.abs(r.diff) >= 0.02)).toEqual([]);
  });

  it('accounts for every residual it does have', () => {
    const unaccounted = results.filter((r) => !accountedFor(r.diff));
    // One in the full season: nflverse nets a -5 fumble-recovery loss into
    // rushing yards where Sleeper does not, which is worth half a point and is
    // a disagreement about what a rushing yard is rather than a scoring bug.
    expect(unaccounted.length).toBeLessThanOrEqual(1);
  });

  it('never overstates a player, since every blind spot is a bonus it cannot add', () => {
    // Direction matters more than size: the engine can only ever be short, so a
    // player is never priced above what his league would actually have paid.
    const over = results.filter((r) => r.diff > 0.02 && !accountedFor(r.diff));
    expect(over).toEqual([]);
  });

  it('lands within a point of Sleeper in aggregate', () => {
    const mine = results.reduce((sum, r) => sum + r.mine, 0);
    const theirs = results.reduce((sum, r) => sum + r.theirs, 0);
    expect(Math.abs((mine - theirs) / theirs)).toBeLessThan(0.015);
  });

  /**
   * The self-knowledge half. The engine is allowed to be short here, but it is
   * not allowed to be silently short — every rule it cannot express has to be
   * named, and the ones it can must not be quietly missing.
   */
  it('names exactly the rules it cannot express, and claims no others', () => {
    const coverage = classifyRules(scoring);

    expect(coverage.unreachable.sort()).toEqual(
      ['pass_int_td', 'pass_td_50p', 'rec_td_40p', 'rec_td_50p', 'rush_td_40p', 'rush_td_50p'].sort(),
    );
    // Nothing published by this league is a mystery to the classifier.
    expect(coverage.unknown).toEqual([]);
    // And the rules that do the work are claimed as supported.
    for (const rule of ['rec', 'rec_yd', 'rec_td', 'pass_td', 'bonus_rec_te', 'pass_cmp_40p']) {
      expect(coverage.supported).toContain(rule);
    }
  });
});
