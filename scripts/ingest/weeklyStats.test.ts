import { describe, expect, it } from 'vitest';
import { parseCrosswalk } from './crosswalk';
import { reduceWeeklyStats } from './weeklyStats';

const CROSSWALK = parseCrosswalk(
  [
    'sleeper_id,gsis_id,pfr_id,espn_id,name',
    '7564,00-0036900,ChasJa00,4362628,JaMarr Chase',
    '4866,00-0034857,BarkSa00,3929630,Saquon Barkley',
  ].join('\n'),
);

const COLUMNS = [
  'player_id',
  'player_display_name',
  'position',
  'season',
  'week',
  'season_type',
  'team',
  'targets',
  'target_share',
  'air_yards_share',
  'wopr',
  'carries',
  'receptions',
  'fantasy_points_ppr',
];

const HEADER = COLUMNS.join(',');
const csv = (...rows: string[]) => [HEADER, ...rows].join('\n');

const META = { season: 2025, source: 'test', generatedAt: '2026-07-30T00:00:00.000Z' };
const reduce = (text: string) => reduceWeeklyStats(text, CROSSWALK, META);

describe('reduceWeeklyStats', () => {
  it('emits opportunity columns in the published order', () => {
    const { file } = reduce(
      csv("00-0036900,Ja'Marr Chase,WR,2025,2,REG,CIN,16,0.3721,0.3111,0.7759,0,14,36.5"),
    );

    expect(file.columns).toEqual([
      'week',
      'targets',
      'targetShare',
      'airYardsShare',
      'wopr',
      'carries',
      'receptions',
      'fantasyPointsPpr',
    ]);
    expect(file.players['7564'].weeks).toEqual([[2, 16, 0.3721, 0.3111, 0.7759, 0, 14, 36.5]]);
  });

  it('keeps a missing share as null rather than zero', () => {
    // A back who was never targeted and a back nflverse has no share for are
    // different facts. Zero would read as "on the field, saw nothing", which
    // is a real and much worse signal than "unknown".
    const { file } = reduce(csv('00-0034857,Saquon Barkley,RB,2025,1,REG,PHI,0,NA,NA,NA,22,0,14.2'));

    const [week] = file.players['4866'].weeks;
    expect(week).toEqual([1, 0, null, null, null, 22, 0, 14.2]);
  });

  it('ignores the postseason', () => {
    const { file } = reduce(
      csv(
        "00-0036900,Ja'Marr Chase,WR,2025,1,REG,CIN,5,0.2174,0.5207,0.6906,0,2,4.6",
        "00-0036900,Ja'Marr Chase,WR,2025,1,POST,CIN,9,0.3,0.4,0.8,0,6,18.1",
      ),
    );

    expect(file.players['7564'].weeks).toHaveLength(1);
    expect(file.throughWeek).toBe(1);
  });

  it('handles quoted names containing commas', () => {
    // Player names are why this file is parsed rather than split on commas.
    const { file } = reduce(
      csv('00-0036900,"Chase, Jr.",WR,2025,1,REG,CIN,5,0.2,0.5,0.69,0,2,4.6'),
    );

    expect(file.players['7564'].weeks).toEqual([[1, 5, 0.2, 0.5, 0.69, 0, 2, 4.6]]);
  });

  it('fails with a readable error when the opportunity columns disappear', () => {
    const drifted = [
      COLUMNS.filter((c) => c !== 'wopr' && c !== 'air_yards_share').join(','),
      "00-0036900,Ja'Marr Chase,WR,2025,1,REG,CIN,5,0.2174,0,2,4.6",
    ].join('\n');

    expect(() => reduce(drifted)).toThrowError(
      /stats_player_week: source is missing columns air_yards_share, wopr/,
    );
  });
});
