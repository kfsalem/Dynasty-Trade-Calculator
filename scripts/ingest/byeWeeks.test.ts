import { describe, expect, it } from 'vitest';
import { reduceByeWeeks } from './byeWeeks';

const HEADER = 'season,game_type,week,home_team,away_team';
const csv = (...rows: string[]) => [HEADER, ...rows].join('\n');

const META = { source: 'test', generatedAt: '2026-08-27T00:00:00.000Z' };
const reduce = (text: string) => reduceByeWeeks(text, META);

/**
 * A schedule in which every team plays every week except the ones it is off.
 *
 * Real games.csv is 7,000 rows, so the fixtures are generated: pair up whoever
 * is playing each week. What matters to the reduction is that a team on bye has
 * no row at all — not who it would have played — so the pairings are arbitrary.
 *
 * `plan` maps a team to the week (or weeks) it is off. An odd number playing
 * gets one repeated pairing rather than a dropped team — the reduction reads
 * presence per week, so a duplicate row says nothing new, while a dropped team
 * would hand the fixture a bye the plan never gave it.
 */
function schedule(
  season: number,
  teams: string[],
  weeks: number,
  plan: Record<string, number | number[]>,
): string[] {
  const offIn = (team: string, week: number): boolean => {
    const off = plan[team];
    return Array.isArray(off) ? off.includes(week) : off === week;
  };

  const rows: string[] = [];
  for (let week = 1; week <= weeks; week++) {
    const playing = teams.filter((team) => !offIn(team, week));
    for (let i = 0; i + 1 < playing.length; i += 2) {
      rows.push(`${season},REG,${week},${playing[i]},${playing[i + 1]}`);
    }
    if (playing.length % 2 === 1) {
      rows.push(`${season},REG,${week},${playing[playing.length - 1]},${playing[0]}`);
    }
  }
  return rows;
}

/** The 32 codes nflverse publishes today, with the Rams spelled its way. */
const NFLVERSE_32 = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET',
  'GB', 'HOU', 'IND', 'JAX', 'KC', 'LA', 'LAC', 'LV', 'MIA', 'MIN', 'NE',
  'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS',
];

/**
 * Every team off exactly once, four a week from week 5 — the shape a real
 * season has, and the shape the reduction's gate insists on.
 */
function byePlan(teams: string[], start = 5): Record<string, number> {
  const plan: Record<string, number> = {};
  teams.forEach((team, i) => {
    plan[team] = start + Math.floor(i / 4);
  });
  return plan;
}

/** A full 32-team season, with `overrides` moving named teams off their default week. */
const league = (season: number, overrides: Record<string, number | number[]> = {}) =>
  schedule(season, NFLVERSE_32, 18, { ...byePlan(NFLVERSE_32), ...overrides });

describe('reduceByeWeeks', () => {
  it('reads a bye as an absence from a week', () => {
    const { file } = reduce(csv(...league(2026, { KC: 5, CAR: 5, LA: 11, GB: 11 })));

    expect(file.season).toBe(2026);
    expect(file.teams.KC).toBe(5);
    expect(file.teams.CAR).toBe(5);
    expect(file.teams.GB).toBe(11);
    expect(Object.keys(file.teams)).toHaveLength(32);
  });

  /*
    The one code the two vocabularies disagree on, and the reason the map
    exists. Keyed Sleeper's way, because the only thing that reads this file
    joins it to `Player.team` — an unmapped `LA` would pass every count here and
    then never fire a bye for one roster's worth of players.
  */
  it('translates the Rams into the code Sleeper uses', () => {
    const { file } = reduce(csv(...league(2026, { LA: 11, GB: 11 })));

    expect(file.teams.LAR).toBe(11);
    expect(file.teams.LA).toBeUndefined();
  });

  /*
    games.csv carries every season since 1999, and in 1999 the Raiders were in
    Oakland, the Rams in St. Louis and the Chargers in San Diego. The reduction
    has to select the newest season before it validates anything, or its own
    gate rejects history it was never asked about.
  */
  it('ignores older seasons, including the relocations in them', () => {
    const { file } = reduce(
      csv(
        ...schedule(1999, ['OAK', 'STL', 'SD', 'TEN'], 4, { OAK: 2, STL: 2 }),
        ...league(2026, { BUF: 7, JAX: 7 }),
      ),
    );

    expect(file.season).toBe(2026);
    expect(file.teams.BUF).toBe(7);
    expect(file.teams.OAK).toBeUndefined();
  });

  it('ignores anything that is not a regular-season game', () => {
    const { file } = reduce(
      csv(
        ...league(2026, { KC: 5, CAR: 5 }),
        // A postseason game in a week nobody has a bye in would otherwise make
        // the two teams look like they played 19 weeks.
        '2026,POST,19,KC,BUF',
      ),
    );

    expect(file.teams.KC).toBe(5);
    expect(file.throughWeek).toBe(18);
  });

  it('rejects a team code it does not recognise', () => {
    expect(() =>
      reduce(
        csv(
          ...schedule(2026, [...NFLVERSE_32, 'XXX', 'YYY'], 18, byePlan(NFLVERSE_32)),
        ),
      ),
    ).toThrow(/unrecognised team code/);
  });

  it('rejects a schedule that is not a whole league', () => {
    const twenty = NFLVERSE_32.slice(0, 20);
    expect(() => reduce(csv(...schedule(2026, twenty, 18, byePlan(twenty))))).toThrow(
      /names 20 teams, expected 32/,
    );
  });

  /*
    Every way this reduction can go wrong produces a wrong bye count, and both
    directions look fine on a spot check: a partial schedule gives a team
    several byes, an over-matching filter gives it none.
  */
  it('rejects a team with more than one bye', () => {
    expect(() => reduce(csv(...league(2026, { KC: [5, 9] })))).toThrow(
      /do not have exactly one bye/,
    );
  });

  it('rejects a season in which nobody is ever off', () => {
    expect(() => reduce(csv(...schedule(2026, NFLVERSE_32, 18, {})))).toThrow(
      /do not have exactly one bye/,
    );
  });

  it('rejects a file with no regular-season rows at all', () => {
    expect(() => reduce(csv('2026,PRE,1,KC,BUF'))).toThrow(/no regular-season rows/);
  });

  it('rejects a source missing a column it reads', () => {
    expect(() => reduce('season,week,home_team\n2026,1,KC')).toThrow(/missing column/);
  });
});
