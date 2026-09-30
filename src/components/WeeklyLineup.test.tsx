import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WeeklyLineup } from './WeeklyLineup';
import type { WeekProjections } from '../platforms/types';
import type { WeekEvidence } from '../engine/weekEvidence';
import { summarizeRoster } from '../engine/rosterValue';
import { makePlayer, makeRoster, makeSettings, makeValue } from '../engine/testFixtures';
import type {
  InjuryStatus,
  Player,
  PlayerValue,
  Roster,
  SeasonPhase,
  WaiverSettings,
} from '../types';
import type { FreeAgent, FreeAgentBoard } from '../engine/freeAgents';
import { modelBids, type BidModel } from '../engine/bids';
import { makeHistory } from '../engine/testFixtures';
import type { LeagueTransaction } from '../platforms/types';

const freeAgent = (id: string, position: 'QB' | 'WR', winNow: number): FreeAgent => ({
  player: { ...makePlayer(id, position), team: 'KC' },
  value: makeValue(id, winNow, position, winNow, winNow, winNow),
  snaps: undefined,
  usage: undefined,
  adjustment: undefined,
});

const wire = (...priced: FreeAgent[]): FreeAgentBoard => ({
  priced,
  unpriced: [],
  all: priced,
});

/**
 * The in-season register, which live data cannot reach for most of the year.
 *
 * Every one of these renders in a `regular` phase. The app is written in
 * August, when Sleeper reports the preseason and the panel deliberately drops
 * its week number and its urgency — so the copy that a manager actually reads
 * on a Sunday is only reachable here.
 */

const settings = makeSettings(['QB', 'RB', 'WR', 'FLEX']);

const roster = (setLineup: (string | null)[]): Roster => ({
  ...makeRoster(1, ['qb1', 'rb1', 'wr1', 'wr2', 'wr3']),
  setLineup,
});

const players = new Map<string, Player>([
  ['qb1', makePlayer('qb1', 'QB')],
  ['rb1', makePlayer('rb1', 'RB')],
  ['wr1', makePlayer('wr1', 'WR')],
  ['wr2', makePlayer('wr2', 'WR')],
  ['wr3', makePlayer('wr3', 'WR')],
]);

const values = new Map<string, PlayerValue>([
  ['qb1', makeValue('qb1', 900, 'QB')],
  ['rb1', makeValue('rb1', 800, 'RB')],
  ['wr1', makeValue('wr1', 700, 'WR')],
  ['wr2', makeValue('wr2', 600, 'WR')],
  ['wr3', makeValue('wr3', 500, 'WR')],
]);

function panel(
  setLineup: (string | null)[],
  {
    phase = 'regular' as SeasonPhase,
    week = 7 as number | null,
    injuries = {} as Record<string, InjuryStatus>,
    teams = {} as Record<string, string>,
    byeTeams = null as ReadonlySet<string> | null,
    board = undefined as FreeAgentBoard | undefined,
    values: overrideValues = values as Map<string, PlayerValue>,
    bids = undefined as BidModel | undefined,
    faabUsed = null as number | null,
    leagueSettings = settings,
    projected = undefined as ReadonlyMap<string, number> | undefined,
    projections = undefined as WeekProjections | undefined,
    evidence = undefined as ReadonlyMap<string, WeekEvidence> | undefined,
    evidenceWeek = null as number | null,
  } = {},
) {
  const withInjuries = new Map(players);
  for (const [id, injury] of Object.entries(injuries)) {
    withInjuries.set(id, { ...(players.get(id) as Player), injury });
  }
  for (const [id, team] of Object.entries(teams)) {
    withInjuries.set(id, { ...(withInjuries.get(id) as Player), team });
  }

  const target = { ...roster(setLineup), faabUsed };
  const summary = summarizeRoster(target, withInjuries, overrideValues, leagueSettings);

  return render(
    <WeeklyLineup
      roster={target}
      summary={summary}
      settings={leagueSettings}
      seasonPhase={phase}
      currentWeek={week}
      byeTeams={byeTeams}
      board={board}
      bids={bids}
      projected={projected}
      projections={projections}
      evidence={evidence}
      evidenceWeek={evidenceWeek}
    />,
  );
}

describe('WeeklyLineup', () => {
  it('names the week it is talking about', () => {
    panel(['qb1', 'rb1', 'wr1', 'wr2']);
    expect(screen.getByText('Week 7 lineup')).toBeInTheDocument();
    expect(
      screen.getByText('Your lineup is the best you can field'),
    ).toBeInTheDocument();
  });

  it('drops the week and the urgency when no game is next', () => {
    panel(['qb1', 'rb1', 'wr1', 'wr2'], { phase: 'pre', week: 2 });
    // Sleeper says "week 2" in August and means the preseason. Printing it
    // would put a deadline on the panel that does not exist.
    expect(screen.queryByText(/Week 2/)).not.toBeInTheDocument();
    expect(screen.getByText('Your best lineup')).toBeInTheDocument();
  });

  it('asks for the change and says what it is worth', async () => {
    panel(['qb1', 'rb1', 'wr3', 'wr2']);

    expect(screen.getByText('1 change to make')).toBeInTheDocument();
    expect(screen.getByText(/Start/)).toBeInTheDocument();
    expect(screen.getByText(/Player wr1/)).toBeInTheDocument();
    expect(screen.getByText('Worth more than Player wr3.')).toBeInTheDocument();
    // wr1 (700) in for wr3 (500).
    expect(screen.getAllByText('+200').length).toBeGreaterThan(0);
  });

  it('gives the injury as the reason when one benches a starter', () => {
    panel(['qb1', 'rb1', 'wr1', 'wr2'], { injuries: { wr1: { status: 'out' } } });

    expect(screen.getByText('Player wr1 — out this week.')).toBeInTheDocument();
  });

  it('flags a questionable starter without benching him', () => {
    panel(['qb1', 'rb1', 'wr1', 'wr2'], {
      injuries: { wr1: { status: 'questionable' } },
    });

    expect(screen.getByText('Your lineup is the best you can field')).toBeInTheDocument();
    expect(screen.getByText(/Worth checking again before kickoff/)).toBeInTheDocument();
    expect(screen.getByText(/Player wr1 \(Q\)/)).toBeInTheDocument();
  });

  it('recommends rather than corrects when nothing has been set', () => {
    panel([]);

    expect(screen.getByText('No lineup set yet')).toBeInTheDocument();
    expect(screen.getByText(/recommendation rather than a correction/)).toBeInTheDocument();
  });

  it('calls an empty slot what it is', () => {
    panel(['qb1', 'rb1', 'wr1', null]);

    expect(screen.getByText(/This slot is empty/)).toBeInTheDocument();
  });

  it('opens the full lineup on request', async () => {
    const user = userEvent.setup();
    panel(['qb1', 'rb1', 'wr1', 'wr2']);

    const toggle = screen.getByRole('button', { name: /show the full lineup/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // Four slots, in the league's own order.
    expect(screen.getByText('FLEX')).toBeInTheDocument();
    expect(screen.getByText('Player qb1')).toBeInTheDocument();
  });

  it('says so when it is ranking a game week without projections', () => {
    panel(['qb1', 'rb1', 'wr1', 'wr2']);
    expect(
      screen.getByText(/could not be loaded, so there are no matchups in it/),
    ).toBeInTheDocument();
  });

  /*
    The disclaimer has to track what the panel actually did, in both
    directions. Claiming to check byes without the data is the dangerous half —
    a manager who believes the sentence stops checking for himself.
  */
  it('says byes could not be loaded when they could not', () => {
    panel(['qb1', 'rb1', 'wr1', 'wr2'], { byeTeams: null });
    expect(
      screen.getByText(/bye weeks could not be loaded/),
    ).toBeInTheDocument();
  });

  it('claims to check byes only when it has them', () => {
    panel(['qb1', 'rb1', 'wr1', 'wr2'], { byeTeams: new Set<string>() });
    expect(screen.getByText(/who is on bye/)).toBeInTheDocument();
    expect(screen.queryByText(/bye weeks could not be loaded/)).not.toBeInTheDocument();
  });

  it('benches a starter whose team is off, and says why', async () => {
    panel(['qb1', 'rb1', 'wr1', 'wr2'], {
      teams: { wr2: 'LAR' },
      byeTeams: new Set(['LAR']),
    });

    expect(screen.getByText('1 change to make')).toBeInTheDocument();
    expect(
      screen.getByText(/Player wr2 is on bye — his team does not play this week/),
    ).toBeInTheDocument();

    // The slot is refilled from the bench rather than left to score nothing.
    expect(screen.getByText('Player wr3')).toBeInTheDocument();
  });

  /*
    A bye is not an injury and must not borrow its sentence. The two can be
    true of the same player, and "check again before kickoff" is exactly the
    wrong advice about a man whose team has no game.
  */
  it('calls a bye a bye even when the player is also questionable', () => {
    panel(['qb1', 'rb1', 'wr1', 'wr2'], {
      teams: { wr2: 'LAR' },
      byeTeams: new Set(['LAR']),
      injuries: { wr2: { status: 'questionable' } },
    });

    expect(screen.getByText(/Player wr2 is on bye/)).toBeInTheDocument();
    expect(screen.queryByText(/Worth checking again before kickoff/)).not.toBeInTheDocument();
  });

  /*
    The headline is a claim, not a row count. A panel that says "3 changes" and
    means "one real one and two coin flips" teaches the reader to skim all
    three, and the row that matters loses its urgency to the noise beside it.
  */
  /**
   * An empty QB slot, which is a fact worth stating however small the value,
   * and 660 for 600 in the flex, which is 9% and not a call this model can
   * make. The panel should claim exactly one of the two.
   */
  const mixed = () => {
    const close = new Map(values);
    close.set('wr3', makeValue('wr3', 660, 'WR', 660, 660, 660));
    return close;
  };
  const MIXED_LINEUP = [null, 'rb1', 'wr1', 'wr2'];

  it('counts only the changes it will stand behind', () => {
    panel(MIXED_LINEUP, { values: mixed() });

    expect(screen.getByText('1 change to make')).toBeInTheDocument();
    expect(screen.getByText(/1 swap too close to call/)).toBeInTheDocument();
  });

  it('keeps the close call reachable rather than discarding it', async () => {
    panel(MIXED_LINEUP, { values: mixed() });
    await userEvent.click(screen.getByText(/1 swap too close to call/));

    expect(screen.getByText(/Within 10% on win-now value/)).toBeInTheDocument();
  });

  it('says nothing about closeness when every change is decisive', () => {
    panel(['qb1', 'rb1', 'wr3', 'wr2']);
    expect(screen.queryByText(/too close to call/)).not.toBeInTheDocument();
  });

  it('names no drop when the roster has an open spot', () => {
    panel(['qb1', 'rb1', 'wr1', 'wr2'], {
      board: wire(freeAgent('purdy', 'QB', 2000)),
    });

    expect(screen.getByText(/You have an open roster spot, so nobody has to go/)).toBeInTheDocument();
    expect(screen.queryByText(/Drop Player/)).not.toBeInTheDocument();
  });

  it('names a free agent who beats a starter, and who to drop for him', () => {
    panel(['qb1', 'rb1', 'wr1', 'wr2'], {
      board: wire(freeAgent('purdy', 'QB', 2000)),
      // Four starters and one bench spot: the five-man roster is full.
      leagueSettings: makeSettings(['QB', 'RB', 'WR', 'FLEX'], {
        allSlots: ['QB', 'RB', 'WR', 'FLEX', 'BN'],
      }),
    });

    expect(screen.getByText(/beats your lineup/)).toBeInTheDocument();
    expect(screen.getByText('Player purdy')).toBeInTheDocument();
    expect(screen.getByText(/Better than Player qb1 in this slot/)).toBeInTheDocument();
    // The cheapest asset on the bench, not the weakest starter.
    expect(screen.getByText(/Drop Player wr3 for him/)).toBeInTheDocument();
  });

  it('stays quiet about a free agent who is barely better', () => {
    panel(['qb1', 'rb1', 'wr1', 'wr2'], {
      board: wire(freeAgent('marginal', 'QB', 930)),
    });

    expect(screen.queryByText(/beats? your lineup/i)).not.toBeInTheDocument();
  });
});
describe('WeeklyLineup — best ball', () => {
  /**
   * The lineup panel is the app's answer to "who do I start this week". A
   * best-ball league does not ask it: the platform scores each team's optimal
   * lineup after the games, so there is no decision to make and no way to leave
   * points on the bench. Every sentence the panel would otherwise print is a
   * confident answer to a question this league never asks.
   */
  const bestBall = () => {
    const target = roster(['qb1', 'rb1', 'wr1', 'wr2']);
    const bestBallSettings = makeSettings(['QB', 'RB', 'WR', 'FLEX'], { bestBall: true });

    return render(
      <WeeklyLineup
        roster={target}
        summary={summarizeRoster(target, players, values, bestBallSettings)}
        settings={bestBallSettings}
        seasonPhase="regular"
        currentWeek={7}
        byeTeams={null}
      />,
    );
  };

  it('explains itself instead of recommending a lineup', () => {
    bestBall();

    expect(screen.getByText('Best ball — no lineup to set')).toBeInTheDocument();
    expect(screen.queryByText('Week 7 lineup')).not.toBeInTheDocument();
    expect(screen.queryByText(/changes to make/)).not.toBeInTheDocument();
  });

  it('points at what does still apply, rather than reading as a dead end', () => {
    bestBall();

    expect(screen.getByText(/what your roster is worth/i)).toBeInTheDocument();
  });

  it('leaves an ordinary league untouched', () => {
    panel(['qb1', 'rb1', 'wr1', 'wr2']);

    expect(screen.queryByText(/Best ball/)).not.toBeInTheDocument();
  });
});

describe('WeeklyLineup — what a claim costs', () => {
  const FAAB: WaiverSettings = { type: 2, budget: 100, minBid: null };

  /** A league whose managers have paid `dollars` for a quarterback, `n` times. */
  const paidForQbs = (dollars: number, n = 10): BidModel => {
    const claims: LeagueTransaction[] = Array.from({ length: n }, (_, i) => ({
      id: `t${i}`,
      season: '2025',
      week: 3,
      type: 'waiver',
      succeeded: true,
      created: i,
      rosterIds: [1],
      adds: new Map([[`claimed${i}`, 1]]),
      drops: new Map(),
      picks: [],
      budget: [],
      bid: dollars,
    }));
    return modelBids(
      makeHistory({
        transactions: claims,
        waivers: new Map([['2025', FAAB]]),
        positions: new Map(claims.map((_, i) => [`claimed${i}`, 'QB' as const])),
      }),
      makeSettings(['QB', 'RB', 'WR', 'FLEX'], { waivers: FAAB }),
    );
  };

  it('says what the position has gone for, with the evidence behind it', () => {
    panel(['qb1', 'rb1', 'wr1', 'wr2'], {
      board: wire(freeAgent('purdy', 'QB', 2000)),
      bids: paidForQbs(18),
    });

    expect(screen.getByText(/QB claims here go for about \$18/)).toBeInTheDocument();
    expect(screen.getByText(/From 10 claims since 2025/)).toBeInTheDocument();
  });

  it('states the budget once, at the top, rather than on every row', () => {
    panel(['qb1', 'rb1', 'wr1', 'wr2'], {
      board: wire(freeAgent('purdy', 'QB', 2000)),
      bids: paidForQbs(18),
      faabUsed: 40,
    });

    expect(screen.getByText(/\$60 of your \$100 waiver budget left/)).toBeInTheDocument();
  });

  it('credits a manager who acquired budget in a trade with more than the league gives', () => {
    // `faabUsed` goes negative when FAAB comes back in a trade, and one roster
    // of the real test league does exactly this.
    panel(['qb1', 'rb1', 'wr1', 'wr2'], {
      board: wire(freeAgent('purdy', 'QB', 2000)),
      bids: paidForQbs(18),
      faabUsed: -20,
    });

    expect(screen.getByText(/\$120 of your \$100 waiver budget left/)).toBeInTheDocument();
  });

  it('says the price is past what is left, rather than lowering it to fit', () => {
    panel(['qb1', 'rb1', 'wr1', 'wr2'], {
      board: wire(freeAgent('purdy', 'QB', 2000)),
      bids: paidForQbs(40),
      faabUsed: 95,
    });

    expect(screen.getByText(/go for about \$40, which is more than your \$5/)).toBeInTheDocument();
  });

  it('states what competition has cost, once the league has shown it', () => {
    // Ten uncontested quarterbacks at $4, and eight that one rival also claimed
    // and lost, won at $20.
    const won = (i: number, bid: number): LeagueTransaction => ({
      id: `w${i}`,
      season: '2025',
      week: 3,
      type: 'waiver',
      succeeded: true,
      created: i,
      rosterIds: [1],
      adds: new Map([[`claimed${i}`, 1]]),
      drops: new Map(),
      picks: [],
      budget: [],
      bid,
    });
    const lost = (i: number): LeagueTransaction => ({
      ...won(i, 10),
      id: `l${i}`,
      succeeded: false,
      rosterIds: [2],
      adds: new Map([[`claimed${i}`, 2]]),
    });
    const claims = [
      ...Array.from({ length: 10 }, (_, i) => won(i, 4)),
      ...Array.from({ length: 8 }, (_, i) => won(10 + i, 20)),
      ...Array.from({ length: 8 }, (_, i) => lost(10 + i)),
    ];
    const bids = modelBids(
      makeHistory({
        transactions: claims,
        waivers: new Map([['2025', FAAB]]),
        positions: new Map(claims.map((t) => [[...t.adds.keys()][0], 'QB' as const])),
      }),
      makeSettings(['QB', 'RB', 'WR', 'FLEX'], { waivers: FAAB }),
    );

    panel(['qb1', 'rb1', 'wr1', 'wr2'], { board: wire(freeAgent('purdy', 'QB', 2000)), bids });

    expect(
      screen.getByText(/a claim here has gone for about \$\d+ with nobody else bidding and \$\d+ against one rival\./),
    ).toBeInTheDocument();
  });

  it('says nothing about competition the league has never shown', () => {
    panel(['qb1', 'rb1', 'wr1', 'wr2'], {
      board: wire(freeAgent('purdy', 'QB', 2000)),
      bids: paidForQbs(18),
    });

    expect(screen.queryByText(/nobody else bidding/)).not.toBeInTheDocument();
  });

  it('says nothing about price in a league with no bid model', () => {
    panel(['qb1', 'rb1', 'wr1', 'wr2'], {
      board: wire(freeAgent('purdy', 'QB', 2000)),
    });

    expect(screen.getByText(/beats your lineup/)).toBeInTheDocument();
    expect(screen.queryByText(/go for about/)).not.toBeInTheDocument();
  });
});

describe("WeeklyLineup — on this week's projections (#149)", () => {
  // wr3 is the cheapest receiver and has the best week.
  const week = (wr3: number) =>
    new Map([
      ['qb1', 20],
      ['rb1', 15],
      ['wr1', 9],
      ['wr2', 12],
      ['wr3', wr3],
    ]);

  it('says what it ranked on, and states the gain in points', () => {
    panel(['qb1', 'rb1', 'wr1', 'wr2'], { projected: week(14) });

    expect(screen.getByText(/Ranked on this week's projections/)).toBeInTheDocument();
    // Once in the headline, once on the one row that earns it.
    expect(screen.getAllByText('+5.0')).toHaveLength(2);
    expect(screen.getByText('pts')).toBeInTheDocument();
  });

  it('gives the call its chance, with both projections', () => {
    panel(['qb1', 'rb1', 'wr1', 'wr2'], { projected: week(14) });

    expect(
      screen.getByText(/likely to outscore Player wr1: 14.0 projected against 9.0/),
    ).toBeInTheDocument();
  });

  it('shows the facts behind the man it starts', () => {
    panel(['qb1', 'rb1', 'wr1', 'wr2'], {
      projected: week(14),
      projections: new Map([['wr3', { opponent: 'PIT', stats: {} }]]),
      evidence: new Map([
        [
          'wr3',
          { games: 3, snapShare: 0.78, targetsPerGame: 7, carriesPerGame: 0, pointsPerGame: 13.1 },
        ],
      ]),
    });

    expect(
      screen.getByText('vs PIT · 78% of snaps · 7.0 targets a game · 13.1 points a game'),
    ).toBeInTheDocument();
  });

  it('files a one-point edge under too close to call, and says why in chances', async () => {
    panel(['qb1', 'rb1', 'wr1', 'wr2'], { projected: week(10) });

    expect(screen.getByText('Your lineup is the best you can field')).toBeInTheDocument();
    await userEvent.click(screen.getByText(/1 swap too close to call/));
    expect(screen.getByText(/Less than a 60% chance of coming off/)).toBeInTheDocument();
    expect(screen.getByText(/A coin flip with Player wr1/)).toBeInTheDocument();
  });

  it('dates the season stats once, under the calls', () => {
    panel(['qb1', 'rb1', 'wr1', 'wr2'], { projected: week(14), week: 7, evidenceWeek: 6 });

    expect(screen.getByText('Snaps, targets and points a game are through week 6.')).toBeInTheDocument();
  });

  it('says so when the weekly refresh has fallen behind', () => {
    panel(['qb1', 'rb1', 'wr1', 'wr2'], { projected: week(14), week: 7, evidenceWeek: 4 });

    expect(screen.getByText(/run only through week 4; the latest weekly refresh has not landed/)).toBeInTheDocument();
  });
});
