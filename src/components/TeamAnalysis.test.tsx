import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TeamAnalysis } from './TeamAnalysis';
import { summarizeRoster } from '../engine/rosterValue';
import { makeLeague, makePlayer, makeRoster, makeSettings, makeValue } from '../engine/testFixtures';
import type { LineupSlot, Player, PlayerValue, Position, Roster, SeasonPhase } from '../types';

/**
 * The ceiling-versus-fielded line on the contention card.
 *
 * Its engine is covered in `engine/fielded`; what is worth testing here is the
 * gate. The line is only honest during a game week — out of season every roster
 * in the league carries a stale week-17 lineup, and presenting that as a
 * shortfall would invent a mistake nobody has made.
 */

const SLOTS: LineupSlot[] = ['QB', 'RB', 'WR'];
const settings = makeSettings(SLOTS, { teamCount: 3 });

function world(set: 'best' | 'stale' | 'none') {
  const players = new Map<string, Player>();
  const values = new Map<string, PlayerValue>();
  const rosters: Roster[] = [];
  const shape: Position[] = ['QB', 'RB', 'WR', 'WR'];
  // Team 1 has the best roster in the league by some distance.
  const worth: [number, number, number, number][] = [
    [1000, 900, 800, 100],
    [950, 850, 750, 50],
    [900, 800, 700, 50],
  ];

  worth.forEach((team, t) => {
    const ids = shape.map((position, i) => {
      const id = `t${t + 1}_${position}${i}`;
      players.set(id, makePlayer(id, position, 25));
      values.set(id, makeValue(id, team[i]));
      return id;
    });

    // Only team 1 varies; the other two always field their best.
    const mode = t === 0 ? set : 'best';
    const setLineup =
      mode === 'none'
        ? []
        : mode === 'best'
          ? [ids[0], ids[1], ids[2]]
          : [ids[0], ids[1], ids[3]];

    rosters.push({ ...makeRoster(t + 1, ids), setLineup });
  });

  return {
    league: makeLeague(rosters, settings),
    summaries: rosters.map((r) => summarizeRoster(r, players, values, settings)),
  };
}

function show(set: 'best' | 'stale' | 'none', seasonPhase: SeasonPhase) {
  const { league, summaries } = world(set);
  render(
    <TeamAnalysis
      league={league}
      summaries={summaries}
      myRosterId={1}
      scarcity={undefined}
      seasonPhase={seasonPhase}
      currentWeek={seasonPhase === 'regular' ? 3 : null}
      byeTeams={null}
      season={undefined}
      freeAgents={undefined}
      activityCurrent={false}
      bench={{ report: undefined, loading: false, failed: false, truncated: false }}
      bids={undefined}
      onChangeTeam={() => {}}
    />,
  );
}

describe('ceiling versus what is being fielded', () => {
  it('names the gap when a stale lineup is costing the best roster in the league', () => {
    show('stale', 'regular');

    // Top of the league on the roster, bottom of it on the field.
    expect(screen.getByText('Fielding')).toBeInTheDocument();
    expect(screen.getByText('#3 of 3')).toBeInTheDocument();
    expect(
      screen.getByText(/Every rank above grades the best lineup this roster can field/),
    ).toHaveTextContent('worth 700 less');
  });

  it('says nothing at all once the season is over', () => {
    // The identical stale lineup. In January it is not a mistake, it is a team
    // that stopped setting lineups in December like everyone else.
    show('stale', 'off');

    expect(screen.queryByText('Fielding')).not.toBeInTheDocument();
    expect(screen.queryByText(/grades the best lineup this roster can field/)).toBeNull();
  });

  it('says nothing to a manager already fielding his best', () => {
    show('best', 'regular');

    expect(screen.queryByText('Fielding')).not.toBeInTheDocument();
    expect(screen.queryByText(/grades the best lineup this roster can field/)).toBeNull();
  });

  it('says there is nothing to compare when no lineup has been set', () => {
    show('none', 'regular');

    expect(screen.queryByText('Fielding')).not.toBeInTheDocument();
    expect(screen.getByText(/You have no lineup set/)).toBeInTheDocument();
  });
});

describe('the margin behind a rank', () => {
  it('says how far clear the leader is, since the rank alone cannot', () => {
    // Team 1 leads on ceiling: 2700 against 2550.
    show('best', 'regular');

    // Team 1 tops both axes, so the rank itself appears twice.
    expect(screen.getAllByText('#1 of 3').length).toBe(2);
    expect(screen.getAllByText(/6% clear/).length).toBeGreaterThan(0);
  });

  it('says how far back a team is when somebody is above it', () => {
    // Rendered from team 2's chair, 2550 against the 2700 above it.
    const { league, summaries } = world('best');
    render(
      <TeamAnalysis
        league={league}
        summaries={summaries}
        myRosterId={2}
        scarcity={undefined}
        seasonPhase="regular"
        currentWeek={3}
        byeTeams={null}
        season={undefined}
        freeAgents={undefined}
        activityCurrent={false}
        bench={{ report: undefined, loading: false, failed: false, truncated: false }}
        bids={undefined}
        onChangeTeam={() => {}}
      />,
    );

    expect(screen.getAllByText(/6% back/).length).toBeGreaterThan(0);
  });
});
