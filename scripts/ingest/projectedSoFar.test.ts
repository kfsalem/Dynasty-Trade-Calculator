import { describe, expect, it } from 'vitest';
import { parseWeek, reduceProjected } from './projectedSoFar';
import { PROJECTED_COLUMNS, SCORING_COLUMNS, type ScoringFile } from '../../src/data/types';

const META = { generatedAt: '2026-10-22T00:00:00.000Z', source: 'test' };
const col = (key: string) => PROJECTED_COLUMNS.indexOf(key as (typeof PROJECTED_COLUMNS)[number]);

/** Players with the weeks they played; the stat columns do not matter here. */
const scoring = (players: Record<string, { pos: string; weeks: number[] }>): ScoringFile => ({
  generatedAt: META.generatedAt,
  season: 2026,
  throughWeek: 3,
  source: 'test',
  columns: SCORING_COLUMNS,
  players: Object.fromEntries(
    Object.entries(players).map(([id, { pos, weeks }]) => [
      id,
      { pos, team: 'DEN', weeks: weeks.map((week) => [week]) },
    ]),
  ),
});

const week = (rows: Record<string, Record<string, number | null>>) =>
  new Map(Object.entries(rows));

describe('reduceProjected', () => {
  it('sums projections over the weeks he played, and records which', () => {
    const file = reduceProjected(
      scoring({ nix: { pos: 'QB', weeks: [1, 2] } }),
      new Map([
        [1, week({ nix: { pass_td: 2, pass_yd: 240 } })],
        [2, week({ nix: { pass_td: 1.5, pass_yd: 220 } })],
        [3, week({ nix: { pass_td: 9, pass_yd: 999 } })],
      ]),
      META,
    );
    const row = file.players.nix;

    expect(row[0]).toBe((1 << 1) | (1 << 2));
    expect(row[col('pass_td')]).toBe(3.5);
    // Week 3 he did not play, so its projection is not his.
    expect(row[col('pass_yd')]).toBe(460);
  });

  it('leaves out a week he played without a projection, so both sides match', () => {
    const file = reduceProjected(
      scoring({ nix: { pos: 'QB', weeks: [1, 2] } }),
      new Map([[1, week({ nix: { pass_td: 2 } })], [2, week({})]]),
      META,
    );

    expect(file.players.nix[0]).toBe(1 << 1);
  });

  it('skips nulls, ratios and totals scored under somebody else’s rules', () => {
    const file = reduceProjected(
      scoring({ nix: { pos: 'QB', weeks: [1] } }),
      new Map([[1, week({ nix: { pass_td: 2, pass_int: null, cmp_pct: 64, pts_ppr: 19 } })]]),
      META,
    );

    expect(file.players.nix).toHaveLength(col('pass_td') + 1);
    expect(file.columns).not.toContain('cmp_pct');
    expect(file.columns).not.toContain('pts_ppr');
  });

  it('covers skill players only, as the lineup evidence does', () => {
    const file = reduceProjected(
      scoring({ k: { pos: 'K', weeks: [1] }, wr: { pos: 'WR', weeks: [1] } }),
      new Map([[1, week({ k: { fgm: 2 }, wr: { rec: 5 } })]]),
      META,
    );

    expect(Object.keys(file.players)).toEqual(['wr']);
  });

  it('takes its season and week from the scoring file it was matched against', () => {
    const file = reduceProjected(scoring({}), new Map(), META);

    expect(file.season).toBe(2026);
    expect(file.throughWeek).toBe(3);
  });
});

describe('parseWeek', () => {
  it('keys stat lines by Sleeper id', () => {
    const parsed = parseWeek(JSON.stringify([{ player_id: '11563', stats: { pass_td: 1.9 } }]));

    expect(parsed.get('11563')).toEqual({ pass_td: 1.9 });
  });

  it('calls a response that is not a list a schema failure', () => {
    expect(() => parseWeek('{"error":"nope"}')).toThrow(/not a list/);
    expect(() => parseWeek('<html>')).toThrow(/not JSON/);
  });
});
