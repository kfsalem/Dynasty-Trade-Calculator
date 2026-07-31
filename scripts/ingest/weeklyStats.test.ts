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
  'attempts',
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
      csv("00-0036900,Ja'Marr Chase,WR,2025,2,REG,CIN,0,16,0.3721,0.3111,0.7759,0,14,36.5"),
    );

    expect(file.columns).toEqual([
      'week',
      'targets',
      'targetShare',
      'airYardsShare',
      'wopr',
      'carries',
      'carryShare',
      'receptions',
      'fantasyPointsPpr',
    ]);
    expect(file.players['7564'].weeks).toEqual([[2, 16, 0.3721, 0.3111, 0.7759, 0, null, 14, 36.5]]);
  });

  it('keeps a missing share as null rather than zero', () => {
    // A back who was never targeted and a back nflverse has no share for are
    // different facts. Zero would read as "on the field, saw nothing", which
    // is a real and much worse signal than "unknown".
    const { file } = reduce(csv('00-0034857,Saquon Barkley,RB,2025,1,REG,PHI,0,0,NA,NA,NA,22,0,14.2'));

    const [week] = file.players['4866'].weeks;
    expect(week).toEqual([1, 0, null, null, null, 22, 1, 0, 14.2]);
  });

  it('ignores the postseason', () => {
    const { file } = reduce(
      csv(
        "00-0036900,Ja'Marr Chase,WR,2025,1,REG,CIN,0,5,0.2174,0.5207,0.6906,0,2,4.6",
        "00-0036900,Ja'Marr Chase,WR,2025,1,POST,CIN,0,9,0.3,0.4,0.8,0,6,18.1",
      ),
    );

    expect(file.players['7564'].weeks).toHaveLength(1);
    expect(file.throughWeek).toBe(1);
  });

  it('handles quoted names containing commas', () => {
    // Player names are why this file is parsed rather than split on commas.
    const { file } = reduce(
      csv('00-0036900,"Chase, Jr.",WR,2025,1,REG,CIN,0,5,0.2,0.5,0.69,0,2,4.6'),
    );

    expect(file.players['7564'].weeks).toEqual([[1, 5, 0.2, 0.5, 0.69, 0, null, 2, 4.6]]);
  });

  it('computes carry share against the whole team, not the shipped subset', () => {
    // nflverse publishes target share and air yards share but not carry share,
    // so it is derived here. The denominator has to include players who never
    // reach the output — an unresolved back still took the ball out of
    // everyone else's hands, and dividing by the survivors overstates the rest.
    const { file } = reduce(
      csv(
        '00-0034857,Saquon Barkley,RB,2025,1,REG,PHI,0,0,NA,NA,NA,18,0,14.2',
        'NA,Unresolved Back,RB,2025,1,REG,PHI,0,0,NA,NA,NA,20,0,9.1',
        '00-0000002,A Quarterback,QB,2025,1,REG,PHI,30,0,NA,NA,NA,2,0,18.0',
      ),
    );

    // 18 of 40, not 18 of 18 — the unresolved back and the quarterback count.
    const carryShare = file.columns.indexOf('carryShare');
    expect(file.players['4866'].weeks[0][carryShare]).toBeCloseTo(0.45);
  });

  it('leaves carry share null when a team has no carries on record', () => {
    const { file } = reduce(
      csv("00-0036900,Ja'Marr Chase,WR,2025,1,REG,CIN,0,9,0.3,0.4,0.7,0,6,14.2"),
    );

    const carryShare = file.columns.indexOf('carryShare');
    expect(file.players['7564'].weeks[0][carryShare]).toBeNull();
  });

  it('counts a quarterback by his pass attempts', () => {
    // A pocket quarterback takes almost no targets or carries, so a
    // targets-plus-carries bar left real starters out of the gate's
    // denominator — eight of them in 2025, the worst with a 35-attempt game.
    const { stats } = reduce(
      csv('00-0033873,Patrick Mahomes,QB,2025,1,REG,KC,35,0,NA,NA,NA,0,0,18.4'),
    );

    expect(stats.unmatched).toEqual([
      { name: 'Patrick Mahomes', position: 'QB', note: 'peak 35 opportunities', relevant: true },
    ]);
  });

  it('counts a player with an unusable id as unmatched, not as absent', () => {
    const { file, stats } = reduce(
      csv(
        "00-0036900,Ja'Marr Chase,WR,2025,1,REG,CIN,0,9,0.3,0.4,0.7,0,6,14.2",
        'NA,No Id,WR,2025,1,REG,CIN,0,9,0.3,0.4,0.7,0,6,14.2',
      ),
    );

    expect(Object.keys(file.players)).toEqual(['7564']);
    expect(stats.relevant.byPosition.WR).toEqual({ matched: 1, unmatched: 1 });
  });

  it('fails with a readable error when the opportunity columns disappear', () => {
    const drifted = [
      COLUMNS.filter((c) => c !== 'wopr' && c !== 'air_yards_share').join(','),
      "00-0036900,Ja'Marr Chase,WR,2025,1,REG,CIN,0,5,0.2174,0,2,4.6",
    ].join('\n');

    expect(() => reduce(drifted)).toThrowError(
      /stats_player_week: source is missing columns air_yards_share, wopr/,
    );
  });
});
