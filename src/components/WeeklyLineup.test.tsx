import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WeeklyLineup } from './WeeklyLineup';
import { summarizeRoster } from '../engine/rosterValue';
import { makePlayer, makeRoster, makeSettings, makeValue } from '../engine/testFixtures';
import type { InjuryStatus, Player, PlayerValue, Roster, SeasonPhase } from '../types';

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
  } = {},
) {
  const withInjuries = new Map(players);
  for (const [id, injury] of Object.entries(injuries)) {
    withInjuries.set(id, { ...(players.get(id) as Player), injury });
  }
  for (const [id, team] of Object.entries(teams)) {
    withInjuries.set(id, { ...(withInjuries.get(id) as Player), team });
  }

  const target = roster(setLineup);
  const summary = summarizeRoster(target, withInjuries, values, settings);

  return render(
    <WeeklyLineup
      roster={target}
      summary={summary}
      settings={settings}
      seasonPhase={phase}
      currentWeek={week}
      byeTeams={byeTeams}
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

  it('never promises weekly projections it does not have', () => {
    panel(['qb1', 'rb1', 'wr1', 'wr2']);
    expect(screen.getByText(/Not a weekly projection: no matchups/)).toBeInTheDocument();
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
    expect(screen.queryByText(/could not be loaded/)).not.toBeInTheDocument();
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
});
