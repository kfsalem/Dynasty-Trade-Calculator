import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MODEL,
  simulate,
  STRENGTH_DRIFT,
  type OddsContext,
} from '../../src/engine/playoffOdds';
import type { Matchup } from '../../src/types';
import {
  addPoint,
  appendOddsRecord,
  emptyOddsRecord,
  ODDS_RECORD_FILE,
  ODDS_RECORD_LEAGUES,
  resultsThrough,
  statedOdds,
  type OddsRecordFile,
  type OddsSource,
} from './oddsRecord';

const LEAGUE = ODDS_RECORD_LEAGUES[0];
const RUN = '2026-11-03T16:00:00.000Z';

const fixture = (week: number, a: number, b: number, points: [number, number] | null): Matchup => ({
  week,
  rosterIds: [a, b],
  points,
});

/** Four teams, two weeks played and two to go, two playoff places. */
const schedule: Matchup[] = [
  fixture(1, 1, 2, [120, 100]),
  fixture(1, 3, 4, [110, 90]),
  fixture(2, 1, 3, [105, 115]),
  fixture(2, 2, 4, [130, 95]),
  fixture(3, 1, 4, null),
  fixture(3, 2, 3, null),
  fixture(4, 1, 2, null),
  fixture(4, 3, 4, null),
];

const context = (remaining: Matchup[]): OddsContext => ({
  // Listed out of roster order, as a league's rosters can be.
  teams: [
    { rosterId: 3, wins: 2, losses: 0, ties: 0, pointsFor: 225, strength: 5200.04 },
    { rosterId: 1, wins: 1, losses: 1, ties: 0, pointsFor: 225.456, strength: 6100 },
    { rosterId: 4, wins: 0, losses: 2, ties: 0, pointsFor: 185, strength: 3900 },
    { rosterId: 2, wins: 1, losses: 1, ties: 0, pointsFor: 230, strength: 4800 },
  ],
  remaining,
  playoffTeams: 2,
  model: DEFAULT_MODEL,
});

const source = (over: Partial<OddsSource> = {}): OddsSource => ({
  leagueId: LEAGUE,
  leagueSeason: '2026',
  currentSeason: '2026',
  phase: 'regular',
  week: 3,
  weeksTotal: 4,
  playoffWeekStart: 5,
  odds: context(schedule.filter((m) => m.week >= 3)),
  matchups: schedule,
  valuesAt: Date.parse('2026-11-03T15:59:00.000Z'),
  ...over,
});

describe('statedOdds', () => {
  it('states the odds the app would, beside everything they were stated on', () => {
    const stated = statedOdds(source(), RUN);
    if ('skip' in stated) throw new Error(stated.skip);
    const { point } = stated;

    expect(point).toMatchObject({
      league: LEAGUE,
      season: 2026,
      week: 3,
      resultsThrough: 2,
      takenAt: RUN,
      valuesAt: '2026-11-03T15:59:00.000Z',
      playoffTeams: 2,
      playoffWeekStart: 5,
      drift: STRENGTH_DRIFT,
      model: DEFAULT_MODEL,
    });
    // In roster order, whatever order the league listed them in.
    expect(point.teams.map((t) => t[0])).toEqual([1, 2, 3, 4]);
    expect(point.teams[0]).toEqual([1, 1, 1, 0, 225.46, 6100, expect.any(Number)]);
    expect(point.teams[2][5]).toBe(5200);

    const app = new Map(simulate(source().odds as OddsContext).map((o) => [o.rosterId, o.odds]));
    for (const [rosterId, , , , , , odds] of point.teams) {
      expect(odds).toBeCloseTo(app.get(rosterId) as number, 4);
    }
    // Two places, so the chances add up to two.
    expect(point.teams.reduce((sum, t) => sum + t[6], 0)).toBeCloseTo(2, 3);
  });

  it('shows when the week simulated from already has results', () => {
    const played = schedule.map((m) => (m.week === 3 ? { ...m, points: [100, 90] as [number, number] } : m));
    const stated = statedOdds(source({ matchups: played }), RUN);
    if ('skip' in stated) throw new Error(stated.skip);
    expect(stated.point.week).toBe(3);
    expect(stated.point.resultsThrough).toBe(3);
  });

  it.each([
    ['outside the regular season', { phase: 'off' as const }, 'no regular season under way (off)'],
    ['for a league that has not renewed', { leagueSeason: '2025' }, 'the league plays 2025, not 2026'],
    ['once the regular season is over', { week: 5 }, 'the regular season ended with week 4'],
    ['when Sleeper does not say the week', { week: null }, 'Sleeper did not say what week it is'],
    ['with no schedule', { odds: undefined }, 'no fixtures left to simulate'],
    ['with no fixtures left', { odds: context([]) }, 'no fixtures left to simulate'],
  ])('states nothing %s', (_, over, reason) => {
    expect(statedOdds(source(over), RUN)).toEqual({ skip: reason });
  });
});

describe('resultsThrough', () => {
  it('stops at the first week without every result', () => {
    expect(resultsThrough(schedule, 4)).toBe(2);
    const gap = schedule.filter((m) => m.week !== 1);
    expect(resultsThrough(gap, 4)).toBe(0);
  });
});

describe('addPoint', () => {
  const point = (week: number, takenAt = RUN) => {
    const stated = statedOdds(source({ week }), takenAt);
    if ('skip' in stated) throw new Error(stated.skip);
    return stated.point;
  };

  it('keeps the first point of a week, and ignores a later one', () => {
    const first = addPoint(emptyOddsRecord(), point(3), RUN).file;
    const again = addPoint(first, point(3, '2026-11-06T02:00:00.000Z'), '2026-11-06T02:00:00.000Z');
    expect(again.added).toBe(false);
    expect(again.file).toBe(first);
    expect(first.points.map((p) => p.takenAt)).toEqual([RUN]);
  });

  it('keeps weeks in order and leaves the file it was given alone', () => {
    const start = addPoint(emptyOddsRecord(), point(4), RUN).file;
    const next = addPoint(start, point(3), '2026-11-10T16:00:00.000Z');
    expect(next.added).toBe(true);
    expect(next.file.points.map((p) => p.week)).toEqual([3, 4]);
    expect(next.file.generatedAt).toBe('2026-11-10T16:00:00.000Z');
    expect(start.points.map((p) => p.week)).toEqual([4]);
  });
});

describe('appendOddsRecord', () => {
  let dir: string;
  const path = () => join(dir, ODDS_RECORD_FILE);
  const read = async (): Promise<OddsRecordFile> => JSON.parse(await readFile(path(), 'utf8'));

  beforeEach(async () => {
    dir = `${await mkdtemp(join(tmpdir(), 'odds-'))}/`;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it('leaves the record alone unless the weekly refresh asks', async () => {
    const load = vi.fn(async () => source());
    await appendOddsRecord(dir, RUN, load);
    expect(load).not.toHaveBeenCalled();
    await expect(readFile(path(), 'utf8')).rejects.toThrow();
  });

  it('keeps a point on the refresh, and only the first of the week', async () => {
    vi.stubEnv('ODDS_RECORD', 'append');
    await appendOddsRecord(dir, RUN, async () => source());
    await appendOddsRecord(dir, '2026-11-05T12:00:00.000Z', async () => source());

    const record = await read();
    expect(record.columns).toEqual(emptyOddsRecord().columns);
    expect(record.points).toHaveLength(1);
    expect(record.points[0]).toMatchObject({ league: LEAGUE, week: 3, takenAt: RUN });
  });

  it('keeps the committed record when the league cannot be loaded', async () => {
    vi.stubEnv('ODDS_RECORD', 'append');
    await appendOddsRecord(dir, RUN, async () => source());
    const before = await readFile(path(), 'utf8');

    await appendOddsRecord(dir, '2026-11-10T16:00:00.000Z', async () => {
      throw new Error('Sleeper is down');
    });
    expect(await readFile(path(), 'utf8')).toBe(before);
  });

  it('does not start again over a record it cannot read', async () => {
    vi.stubEnv('ODDS_RECORD', 'append');
    await writeFile(path(), 'not json');
    const load = vi.fn(async () => source());
    await appendOddsRecord(dir, RUN, load);
    expect(load).not.toHaveBeenCalled();
    expect(await readFile(path(), 'utf8')).toBe('not json');
  });
});
