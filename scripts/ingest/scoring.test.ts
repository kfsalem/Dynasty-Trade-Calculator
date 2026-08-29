import { describe, expect, it } from 'vitest';
import { reduceScoring } from './scoring';
import { SCORING_COLUMNS } from '../../src/data/types';
import type { Crosswalk } from './crosswalk';

const crosswalk: Crosswalk = {
  byGsis: new Map([
    ['00-0000001', 's1'],
    ['00-0000002', 's2'],
    ['00-0000003', 's3'],
  ]),
  byPfr: new Map(),
  byEspn: new Map(),
  rows: 3,
};

const meta = { season: 2025, source: 'test', generatedAt: '2026-08-28T00:00:00.000Z' };

/** Every column the reducer requires, so a case only states what it cares about. */
const COLUMNS = [
  'player_id', 'player_display_name', 'position', 'season', 'week', 'season_type', 'team', 'targets',
  'receptions', 'receiving_yards', 'receiving_tds', 'rushing_yards', 'rushing_tds',
  'passing_yards', 'passing_tds', 'passing_interceptions', 'receiving_40', 'rushing_40',
  'passing_40', 'fumbles_lost_total', 'completions', 'attempts', 'carries', 'sacks_suffered',
  'fumbles_total', 'passing_first_downs', 'rushing_first_downs', 'receiving_first_downs',
  'receiving_2pt_conversions', 'rushing_2pt_conversions', 'passing_2pt_conversions',
  'fumble_recovery_tds', 'special_teams_tds', 'kickoff_return_yards', 'punt_return_yards',
  'fg_made', 'fg_made_0_19', 'fg_made_20_29', 'fg_made_30_39', 'fg_made_40_49',
  'fg_made_50_59', 'fg_made_60_', 'fg_missed', 'pat_made', 'pat_missed',
];

function csv(rows: Record<string, string | number>[]): string {
  const body = rows.map((row) => COLUMNS.map((c) => String(row[c] ?? 0)).join(','));
  return [COLUMNS.join(','), ...body].join('\n');
}

const base = {
  player_id: '00-0000001',
  player_display_name: 'A Receiver',
  position: 'WR',
  season: 2025,
  week: 1,
  season_type: 'REG',
  team: 'KC',
};

const index = (column: (typeof SCORING_COLUMNS)[number]) => SCORING_COLUMNS.indexOf(column);

describe('reduceScoring', () => {
  it('keeps the stat columns a scoring rule reads', () => {
    const { file } = reduceScoring(
      csv([{ ...base, receptions: 6, receiving_yards: 118, receiving_tds: 1, targets: 8 }]),
      crosswalk,
      meta,
    );

    const [row] = file.players.s1.weeks;
    expect(row[0]).toBe(1);
    expect(row[index('receptions')]).toBe(6);
    expect(row[index('recYards')]).toBe(118);
    expect(row[index('recTds')]).toBe(1);
  });

  /**
   * The trimming is what keeps the file inside a budget every visitor pays: a
   * receiver's row stops before the kicking columns start.
   */
  it('drops trailing zeros, so a receiver carries no kicking columns', () => {
    const { file } = reduceScoring(
      csv([{ ...base, receptions: 4, receiving_yards: 40, targets: 6 }]),
      crosswalk,
      meta,
    );

    const [row] = file.players.s1.weeks;
    expect(row.length).toBeLessThan(SCORING_COLUMNS.length);
    expect(row.length).toBe(index('recYards') + 1);
  });

  it('keeps kickers, who have a scoring line and no target share', () => {
    const { file } = reduceScoring(
      csv([
        {
          ...base,
          player_id: '00-0000002',
          player_display_name: 'A Kicker',
          position: 'K',
          fg_made: 2,
          fg_made_40_49: 1,
          fg_made_50_59: 1,
          pat_made: 3,
        },
      ]),
      crosswalk,
      meta,
    );

    const [row] = file.players.s2.weeks;
    expect(row[index('fgMade40_49')]).toBe(1);
    expect(row[index('patMade')]).toBe(3);
  });

  it('skips a week in which nothing scoreable happened', () => {
    // Not the same as a zero: an absent week already means "no row" everywhere
    // else in public/data, and a player who did not appear and one who appeared
    // and did nothing are both worth zero points anyway.
    const { file } = reduceScoring(
      csv([
        { ...base, week: 1, receptions: 3, receiving_yards: 30 },
        { ...base, week: 2, targets: 2 },
      ]),
      crosswalk,
      meta,
    );

    expect(file.players.s1.weeks.map((w) => w[0])).toEqual([1]);
  });

  it('ignores the postseason, like every other dataset here', () => {
    const { file } = reduceScoring(
      csv([{ ...base, season_type: 'POST', receptions: 9, receiving_yards: 140 }]),
      crosswalk,
      meta,
    );

    expect(file.players.s1).toBeUndefined();
  });

  it('drops a player with no Sleeper id rather than inventing one', () => {
    const { file } = reduceScoring(
      csv([{ ...base, player_id: '00-9999999', receptions: 5, receiving_yards: 50 }]),
      crosswalk,
      meta,
    );

    expect(Object.keys(file.players)).toEqual([]);
  });

  it('declares the column order the app reads', () => {
    const { file } = reduceScoring(
      csv([{ ...base, receptions: 1, receiving_yards: 10 }]),
      crosswalk,
      meta,
    );

    expect(file.columns).toEqual(SCORING_COLUMNS);
  });

  it('reports the newest week it saw', () => {
    const { file } = reduceScoring(
      csv([
        { ...base, week: 1, receptions: 3, receiving_yards: 30 },
        { ...base, week: 7, receptions: 5, receiving_yards: 61 },
      ]),
      crosswalk,
      meta,
    );

    expect(file.throughWeek).toBe(7);
  });

  it('fails loudly if the source drops a column a rule depends on', () => {
    // The alternative is shipping a column of zeros that the scoring engine
    // would faithfully multiply by the league's own rules.
    const withoutFumbles = COLUMNS.filter((c) => c !== 'fumbles_lost_total');
    const header = withoutFumbles.join(',');
    const row = withoutFumbles.map(() => '0').join(',');

    expect(() => reduceScoring(`${header}\n${row}`, crosswalk, meta)).toThrow(
      /fumbles_lost_total/,
    );
  });
});
