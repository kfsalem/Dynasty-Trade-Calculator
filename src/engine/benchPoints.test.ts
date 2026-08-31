import { describe, expect, it } from 'vitest';
import type { HistoryPlayer, LeagueHistory, SeasonHistory, WeekLineup } from '../platforms/types';
import type { LineupSlot, Position } from '../types';
import {
  benchFor,
  benchIsUsable,
  benchPoints,
  benchRank,
  bestByPoints,
  checkBench,
} from './benchPoints';

const SLOTS: LineupSlot[] = ['QB', 'RB', 'WR', 'FLEX'];

const PLAYERS = new Map<string, HistoryPlayer>(
  (
    [
      ['qb1', 'QB'],
      ['qb2', 'QB'],
      ['rb1', 'RB'],
      ['rb2', 'RB'],
      ['wr1', 'WR'],
      ['wr2', 'WR'],
      ['te1', 'TE'],
    ] as [string, Position][]
  ).map(([id, position]) => [id, { position, name: id.toUpperCase() }]),
);

function week(
  overrides: Omit<Partial<WeekLineup>, 'points'> & { points: Record<string, number> },
): WeekLineup {
  const { points, ...rest } = overrides;
  return {
    week: 1,
    rosterId: 1,
    starterIds: [],
    playerIds: Object.keys(points),
    points: new Map(Object.entries(points)),
    ...rest,
  };
}

function season(overrides: Partial<SeasonHistory> = {}): SeasonHistory {
  return {
    leagueId: 'l1',
    season: '2025',
    startingSlots: SLOTS,
    managers: new Map([[1, { userId: 'u1', name: 'Ann', teamName: 'Ann' }]]),
    weeks: [],
    claimed: new Map(),
    ...overrides,
  };
}

const history = (seasons: SeasonHistory[]): LeagueHistory => ({
  seasons,
  players: PLAYERS,
  truncated: false,
});

describe('bestByPoints', () => {
  it('fills each slot with the highest scorer eligible for it', () => {
    const best = bestByPoints(
      [
        { id: 'qb1', position: 'QB', points: 20 },
        { id: 'rb1', position: 'RB', points: 10 },
        { id: 'wr1', position: 'WR', points: 15 },
        { id: 'wr2', position: 'WR', points: 12 },
      ],
      SLOTS,
    );

    // QB 20, RB 10, WR 15, and the FLEX takes the leftover receiver.
    expect(best.total).toBeCloseTo(57);
    expect([...best.chosen].sort()).toEqual(['qb1', 'rb1', 'wr1', 'wr2']);
  });

  /**
   * The reason slots are filled narrowest-first. A greedy pass in league order
   * would spend the only running back on the FLEX and leave the RB slot empty,
   * which is not a lineup anybody could field.
   */
  it('does not let a flex swallow the only man a dedicated slot can use', () => {
    const best = bestByPoints(
      [
        { id: 'rb1', position: 'RB', points: 30 },
        { id: 'wr1', position: 'WR', points: 25 },
        { id: 'qb1', position: 'QB', points: 5 },
      ],
      ['FLEX', 'RB', 'QB'],
    );

    expect(best.total).toBeCloseTo(60);
    expect(best.chosen.size).toBe(3);
  });

  it('leaves a slot empty rather than starting an ineligible player', () => {
    const best = bestByPoints([{ id: 'wr1', position: 'WR', points: 15 }], ['QB', 'WR']);
    expect(best.total).toBeCloseTo(15);
    expect([...best.chosen]).toEqual(['wr1']);
  });

  it('is stable when two players score the same', () => {
    const pool = [
      { id: 'wr2', position: 'WR' as Position, points: 10 },
      { id: 'wr1', position: 'WR' as Position, points: 10 },
    ];
    expect([...bestByPoints(pool, ['WR']).chosen]).toEqual([...bestByPoints([...pool].reverse(), ['WR']).chosen]);
  });
});

describe('benchPoints', () => {
  it('measures the gap between the lineup set and the best one available', () => {
    const report = benchPoints(
      history([
        season({
          weeks: [
            week({
              starterIds: ['qb1', 'rb1', 'wr1', 'rb2'],
              points: { qb1: 20, rb1: 10, wr1: 8, rb2: 4, wr2: 22 },
            }),
          ],
        }),
      ]),
    );

    const ann = benchFor(report, 'u1');
    // The FLEX should have been wr2 at 22 rather than rb2 at 4.
    expect(ann?.perWeek).toBeCloseTo(18);
    expect(ann?.weeks).toBe(1);
    expect(ann?.worst?.costliest).toEqual({ playerId: 'wr2', name: 'WR2', points: 22 });
    expect(report.leaguePerWeek).toBeCloseTo(18);
  });

  it('reports nothing left on the bench for a perfect lineup', () => {
    const report = benchPoints(
      history([
        season({
          weeks: [
            week({
              starterIds: ['qb1', 'rb1', 'wr1', 'wr2'],
              points: { qb1: 20, rb1: 10, wr1: 8, wr2: 6, te1: 1 },
            }),
          ],
        }),
      ]),
    );

    expect(benchFor(report, 'u1')?.perWeek).toBe(0);
    expect(benchFor(report, 'u1')?.worst?.costliest).toBeNull();
  });

  /**
   * A week whose lineup cannot be aligned to the season's slots is a week this
   * app cannot read. Counting it as a perfect lineup would credit a manager for
   * a week nobody can see, which is worse than leaving it out.
   */
  it('skips a week whose lineup does not match the season slots', () => {
    const report = benchPoints(
      history([season({ weeks: [week({ starterIds: [], points: { qb1: 20, wr1: 30 } })] })]),
    );

    expect(report.weeks).toBe(0);
    expect(report.managers).toHaveLength(0);
    expect(report.seasons).toEqual([]);
  });

  it('counts an empty starting slot as zero rather than skipping the week', () => {
    const report = benchPoints(
      history([
        season({
          weeks: [
            week({
              starterIds: ['qb1', 'rb1', 'wr1', null],
              points: { qb1: 20, rb1: 10, wr1: 8, wr2: 12 },
            }),
          ],
        }),
      ]),
    );

    expect(benchFor(report, 'u1')?.perWeek).toBeCloseTo(12);
  });

  /**
   * Seasons are joined on the manager, never on the roster id. Sleeper reissues
   * roster ids per season, so a history keyed on them hands one manager's
   * record to another the first time a league reshuffles.
   */
  it('follows a manager across seasons even when his roster id changes', () => {
    const report = benchPoints(
      history([
        season({
          season: '2025',
          managers: new Map([[3, { userId: 'u1', name: 'Ann', teamName: 'Ann' }]]),
          weeks: [
            week({
              rosterId: 3,
              starterIds: ['qb1', 'rb1', 'wr1', 'rb2'],
              points: { qb1: 20, rb1: 10, wr1: 8, rb2: 0, wr2: 10 },
            }),
          ],
        }),
        season({
          season: '2024',
          managers: new Map([[7, { userId: 'u1', name: 'Ann', teamName: 'Ann' }]]),
          weeks: [
            week({
              rosterId: 7,
              starterIds: ['qb1', 'rb1', 'wr1', 'wr2'],
              points: { qb1: 20, rb1: 10, wr1: 8, wr2: 6 },
            }),
          ],
        }),
      ]),
    );

    const ann = benchFor(report, 'u1');
    expect(ann?.weeks).toBe(2);
    expect(ann?.seasons.map((s) => s.season)).toEqual(['2025', '2024']);
    expect(ann?.perWeek).toBeCloseTo(5);
    expect(report.seasons).toEqual(['2025', '2024']);
  });

  /**
   * Two unowned teams in different years are not the same manager. They share a
   * roster id and nothing else, and joining them would invent a record.
   */
  it('keeps orphan teams apart across seasons', () => {
    const orphan = new Map([[1, { userId: null, name: 'Orphan team', teamName: 'Orphan team' }]]);
    const report = benchPoints(
      history([
        season({ season: '2025', managers: orphan, weeks: [week({ starterIds: ['qb1', 'rb1', 'wr1', 'wr2'], points: { qb1: 1, rb1: 1, wr1: 1, wr2: 1 } })] }),
        season({ season: '2024', managers: orphan, weeks: [week({ starterIds: ['qb1', 'rb1', 'wr1', 'wr2'], points: { qb1: 1, rb1: 1, wr1: 1, wr2: 1 } })] }),
      ]),
    );

    expect(report.managers).toHaveLength(2);
    expect(report.managers.every((m) => m.weeks === 1)).toBe(true);
    expect(benchFor(report, null)).toBeNull();
    expect(benchRank(report, null)).toBeNull();
  });

  it('ranks managers by points left on the bench, fewest first', () => {
    const weeks = (rosterId: number, flex: string) =>
      week({
        rosterId,
        starterIds: ['qb1', 'rb1', 'wr1', flex],
        points: { qb1: 20, rb1: 10, wr1: 8, rb2: 2, wr2: 14 },
      });

    const report = benchPoints(
      history([
        season({
          managers: new Map([
            [1, { userId: 'u1', name: 'Ann', teamName: 'Ann' }],
            [2, { userId: 'u2', name: 'Bo', teamName: 'Bo' }],
          ]),
          weeks: [weeks(1, 'rb2'), weeks(2, 'wr2')],
        }),
      ]),
    );

    expect(report.managers.map((m) => m.name)).toEqual(['Bo', 'Ann']);
    expect(benchRank(report, 'u2')).toBe(1);
    expect(benchRank(report, 'u1')).toBe(2);
    expect(benchRank(report, 'nobody')).toBeNull();
  });

  /**
   * The league figure is pooled over weeks rather than averaged over managers,
   * so a manager with one season does not weigh the same as one with four.
   */
  it('pools the league average over roster-weeks', () => {
    const report = benchPoints(
      history([
        season({
          managers: new Map([
            [1, { userId: 'u1', name: 'Ann', teamName: 'Ann' }],
            [2, { userId: 'u2', name: 'Bo', teamName: 'Bo' }],
          ]),
          weeks: [
            week({
              rosterId: 1,
              starterIds: ['qb1', 'rb1', 'wr1', 'rb2'],
              points: { qb1: 0, rb1: 0, wr1: 0, rb2: 0, wr2: 30 },
            }),
            week({
              rosterId: 2,
              starterIds: ['qb1', 'rb1', 'wr1', 'wr2'],
              points: { qb1: 0, rb1: 0, wr1: 0, wr2: 0 },
            }),
            week({
              rosterId: 2,
              week: 2,
              starterIds: ['qb1', 'rb1', 'wr1', 'wr2'],
              points: { qb1: 0, rb1: 0, wr1: 0, wr2: 0 },
            }),
          ],
        }),
      ]),
    );

    // 30 points over three roster-weeks, not the 15 a mean of managers gives.
    expect(report.leaguePerWeek).toBeCloseTo(10);
    expect(report.weeks).toBe(3);
  });

  it('reports nothing at all for a league with no history', () => {
    const empty = benchPoints(undefined);
    expect(empty.weeks).toBe(0);
    expect(empty.fidelity.verdict).toBe('unchecked');
    expect(benchIsUsable(empty.fidelity)).toBe(true);
  });

  /**
   * A player the index cannot place is left out of the pool, which can only
   * make the gap smaller. He is still counted in what the lineup scored, so a
   * manager is never charged for a man this app failed to recognise.
   */
  it('never reports a negative gap when a starter cannot be placed', () => {
    const report = benchPoints({
      seasons: [
        season({
          weeks: [
            week({
              starterIds: ['ghost', 'rb1', 'wr1', 'wr2'],
              points: { ghost: 40, rb1: 1, wr1: 1, wr2: 1 },
            }),
          ],
        }),
      ],
      players: PLAYERS,
      truncated: false,
    });

    const ann = benchFor(report, 'u1');
    expect(ann?.perWeek).toBe(0);
    expect(ann?.worst?.scored).toBeCloseTo(43);
    expect(ann?.worst?.potential).toBeCloseTo(43);
  });
});

describe('checkBench', () => {
  const played = season({
    weeks: [
      week({
        starterIds: ['qb1', 'rb1', 'wr1', 'rb2'],
        points: { qb1: 20, rb1: 10, wr1: 8, rb2: 4, wr2: 22 },
      }),
    ],
  });

  it('is exact when it reproduces the platform total', () => {
    const fidelity = checkBench(
      history([{ ...played, claimed: new Map([[1, { scored: 42, potential: 60 }]]) }]),
    );

    expect(fidelity).toMatchObject({ compared: 1, exact: 1, verdict: 'exact' });
    expect(fidelity.error).toBeCloseTo(0);
  });

  it('is close when it is off by less than the tolerance', () => {
    const fidelity = checkBench(
      history([{ ...played, claimed: new Map([[1, { scored: 42, potential: 59.5 }]]) }]),
    );

    expect(fidelity.verdict).toBe('close');
    expect(fidelity.error).toBeGreaterThan(0);
    expect(benchIsUsable(fidelity)).toBe(true);
  });

  it('is unreliable when the two disagree by more than 2%', () => {
    const fidelity = checkBench(
      history([{ ...played, claimed: new Map([[1, { scored: 42, potential: 40 }]]) }]),
    );

    expect(fidelity.verdict).toBe('unreliable');
    expect(benchIsUsable(fidelity)).toBe(false);
  });

  it('is unchecked when the platform publishes no total of its own', () => {
    expect(checkBench(history([played])).verdict).toBe('unchecked');
    expect(benchIsUsable(checkBench(history([played])))).toBe(true);
  });

  it('does not read a missing total as a claim of zero', () => {
    const fidelity = checkBench(
      history([{ ...played, claimed: new Map([[1, { scored: 0, potential: 0 }]]) }]),
    );

    expect(fidelity).toMatchObject({ compared: 0, verdict: 'unchecked' });
  });
});
