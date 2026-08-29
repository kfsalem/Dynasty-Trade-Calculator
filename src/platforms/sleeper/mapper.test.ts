import { describe, expect, it } from 'vitest';
import { mapFreeAgents, mapLeague, mapMatchups, mapPlayer, mapSettings } from './mapper';
import { parseLeagueId, type SlimPlayer } from './client';
import type {
  SleeperLeague,
  SleeperMatchup,
  SleeperRoster,
  SleeperUser,
} from './schema';

const baseLeague: SleeperLeague = {
  league_id: '123',
  name: 'Test League',
  season: '2026',
  status: 'in_season',
  avatar: null,
  total_rosters: 10,
  roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'BN', 'BN'],
  settings: { type: 2, num_teams: 10, taxi_slots: 4, reserve_slots: 2 },
  scoring_settings: { rec: 1 },
};

describe('mapSettings', () => {
  it('detects superflex from a SUPER_FLEX slot', () => {
    expect(mapSettings(baseLeague).numQbs).toBe(2);
  });

  it('reports 1QB when there is no SUPER_FLEX slot', () => {
    const oneQb = { ...baseLeague, roster_positions: ['QB', 'RB', 'WR', 'FLEX', 'BN'] };
    expect(mapSettings(oneQb).numQbs).toBe(1);
  });

  it('excludes bench, IR and taxi from starting slots', () => {
    const settings = mapSettings({
      ...baseLeague,
      roster_positions: ['QB', 'RB', 'BN', 'IR', 'TAXI'],
    });
    expect(settings.startingSlots).toEqual(['QB', 'RB']);
    expect(settings.allSlots).toHaveLength(5);
  });

  it('treats keeper leagues as dynasty for valuation', () => {
    expect(mapSettings({ ...baseLeague, settings: { type: 1 } }).isDynasty).toBe(true);
    expect(mapSettings({ ...baseLeague, settings: { type: 0 } }).isDynasty).toBe(false);
  });

  it('defaults ppr to 0 when scoring settings omit receptions', () => {
    expect(mapSettings({ ...baseLeague, scoring_settings: {} }).ppr).toBe(0);
  });

  /**
   * The contract that lets every field above be added safely: a league that
   * publishes none of these keys has to come out behaving exactly as it did
   * before the app could read them. Sleeper adds settings keys without notice
   * and old leagues carry fewer of them — the 2023 season of the test league
   * publishes 47 against 2025's 51 — so "absent" is the common case, not the
   * edge one.
   */
  it('defaults every new setting to the permissive reading when the league omits it', () => {
    const settings = mapSettings({ ...baseLeague, settings: null });

    expect(settings.pickTrading).toBe(true);
    expect(settings.tradesDisabled).toBe(false);
    expect(settings.tradeDeadline).toBeNull();
    expect(settings.bestBall).toBe(false);
    expect(settings.medianMatch).toBe(false);
    expect(settings.taxiYears).toBe(0);
    expect(settings.taxiAllowVets).toBe(false);
    expect(settings.waivers).toEqual({ type: null, budget: null, minBid: null });
    expect(settings.playoffType).toBeNull();
    expect(Object.values(settings.reserveAllows).every((allowed) => !allowed)).toBe(true);
  });

  it('reads the flags Sleeper writes as 1 and 0', () => {
    const settings = mapSettings({
      ...baseLeague,
      settings: {
        ...baseLeague.settings,
        pick_trading: 0,
        disable_trades: 1,
        best_ball: 1,
        league_average_match: 1,
        taxi_allow_vets: 1,
      },
    });

    expect(settings.pickTrading).toBe(false);
    expect(settings.tradesDisabled).toBe(true);
    expect(settings.bestBall).toBe(true);
    expect(settings.medianMatch).toBe(true);
    expect(settings.taxiAllowVets).toBe(true);
  });

  /**
   * `99` is what Sleeper stores for "no deadline" — verified against all four
   * seasons of the test league, every one of which carries it. Read literally
   * it is a week 81 games past the end of the season.
   */
  it('reads a deadline that cannot arrive as no deadline at all', () => {
    const deadlineOf = (trade_deadline: number | null | undefined) =>
      mapSettings({ ...baseLeague, settings: { ...baseLeague.settings, trade_deadline } })
        .tradeDeadline;

    expect(deadlineOf(99)).toBeNull();
    expect(deadlineOf(19)).toBeNull();
    expect(deadlineOf(0)).toBeNull();
    expect(deadlineOf(undefined)).toBeNull();
    // A deadline that can actually arrive is kept as the week it is.
    expect(deadlineOf(11)).toBe(11);
    expect(deadlineOf(18)).toBe(18);
  });

  it('counts bench spots from roster_positions rather than assuming them', () => {
    expect(mapSettings(baseLeague).benchSlots).toBe(2);
    expect(
      mapSettings({ ...baseLeague, roster_positions: ['QB', 'RB', 'IR', 'TAXI'] }).benchSlots,
    ).toBe(0);
  });

  it('reads each reserve designation separately', () => {
    const settings = mapSettings({
      ...baseLeague,
      settings: {
        ...baseLeague.settings,
        reserve_allow_out: 1,
        reserve_allow_cov: 1,
        reserve_allow_doubtful: 0,
      },
    });

    expect(settings.reserveAllows.out).toBe(true);
    expect(settings.reserveAllows.cov).toBe(true);
    expect(settings.reserveAllows.doubtful).toBe(false);
    // Never published by the test league, and absent must not read as allowed.
    expect(settings.reserveAllows.na).toBe(false);
  });

  /**
   * `waiver_bid_min` is documented and meaningful and simply *absent* from all
   * four seasons of the test league, which is why it cannot be a number with a
   * zero default: "the minimum bid is $0" and "this league did not say" are
   * different facts, and #47 will need to tell them apart.
   */
  it('carries waiver settings, including the budget key that is often missing', () => {
    const settings = mapSettings({
      ...baseLeague,
      settings: { ...baseLeague.settings, waiver_type: 2, waiver_budget: 100 },
    });

    expect(settings.waivers).toEqual({ type: 2, budget: 100, minBid: null });
  });

  it('does not report a FAAB budget for a league whose budget is zero', () => {
    const settings = mapSettings({
      ...baseLeague,
      settings: { ...baseLeague.settings, waiver_type: 0, waiver_budget: 0 },
    });

    expect(settings.waivers.budget).toBeNull();
  });
});

describe('mapLeague', () => {
  const rosters: SleeperRoster[] = [
    {
      roster_id: 1,
      owner_id: 'u1',
      // One entry per starting slot, in slot order. "0" is Sleeper's
      // placeholder for a slot the manager left empty.
      starters: ['p1', '0', 'p2', 'p4', 'p5', 'p6', 'p7', 'p8'],
      players: ['p1', 'p2', 'p3'],
      taxi: null,
      reserve: null,
      settings: { wins: 5, losses: 2, ties: 0, fpts: 1200, fpts_decimal: 55 },
    },
    {
      roster_id: 2,
      owner_id: null, // orphan team
      starters: null,
      players: null,
      taxi: null,
      reserve: null,
      settings: null,
    },
  ];

  const users: SleeperUser[] = [
    { user_id: 'u1', display_name: 'Kevin', avatar: 'abc', metadata: { team_name: 'Dynasty Co' } },
  ];

  it('keeps the set lineup aligned to the slots, empty slots included', () => {
    const league = mapLeague(baseLeague, rosters, users);
    // The RB slot is empty; p2 is in the *second* RB slot, not shifted up into
    // the first. Compacting this list is what made "your RB2 is empty" and
    // "your RB1 is empty" indistinguishable.
    expect(league.rosters[0].setLineup).toEqual([
      'p1',
      null,
      'p2',
      'p4',
      'p5',
      'p6',
      'p7',
      'p8',
    ]);
  });

  it('reports no set lineup when the array does not line up with the slots', () => {
    const league = mapLeague(baseLeague, [{ ...rosters[0], starters: ['p1', 'p2'] }], users);
    // Two ids against eight slots says nothing about which slots they are in,
    // and a guess would invent lineup mistakes the manager never made.
    expect(league.rosters[0].setLineup).toEqual([]);
  });

  it('prefers a custom team name over the display name', () => {
    const league = mapLeague(baseLeague, rosters, users);
    expect(league.rosters[0].teamName).toBe('Dynasty Co');
    expect(league.rosters[0].ownerName).toBe('Kevin');
  });

  it('falls back to the display name when no team name is set', () => {
    const league = mapLeague(baseLeague, rosters, [
      { user_id: 'u1', display_name: 'Kevin', avatar: null, metadata: null },
    ]);
    expect(league.rosters[0].teamName).toBe('Kevin');
  });

  it('handles orphan rosters and null player arrays without throwing', () => {
    const league = mapLeague(baseLeague, rosters, users);
    expect(league.rosters[1].ownerName).toBe('Orphan team');
    expect(league.rosters[1].playerIds).toEqual([]);
  });

  it('recombines the split points-for fields', () => {
    const league = mapLeague(baseLeague, rosters, users);
    expect(league.rosters[0].pointsFor).toBeCloseTo(1200.55);
  });
});

describe('mapPlayer injuries', () => {
  const slim = (injuryStatus: string | null): SlimPlayer => ({
    id: '1',
    name: 'A Player',
    position: 'WR',
    team: 'BUF',
    age: 25,
    yearsExp: 3,
    injuryStatus,
  });

  it('canonicalises the statuses Sleeper actually publishes', () => {
    expect(mapPlayer(slim('Questionable'))?.injury?.status).toBe('questionable');
    expect(mapPlayer(slim('IR'))?.injury?.status).toBe('ir');
    expect(mapPlayer(slim('PUP'))?.injury?.status).toBe('pup');
  });

  it('maps the roster designations that are not injuries', () => {
    // DNR is the reserve/did-not-report list and NA is a player not on an
    // active NFL roster. Neither is an injury; both mean he cannot play, and
    // both were dropped on the floor before R9 — the real league rosters a
    // receiver whose only designation is DNR.
    expect(mapPlayer(slim('DNR'))?.injury?.status).toBe('dnr');
    expect(mapPlayer(slim('NA'))?.injury?.status).toBe('na');
  });

  it('keeps an unrecognised status instead of reporting the player healthy', () => {
    const injury = mapPlayer(slim('Reserve/Whatever'))?.injury;
    expect(injury?.status).toBe('unknown');
    expect(injury?.description).toBe('Reserve/Whatever');
  });

  it('leaves a player with no status undesignated', () => {
    expect(mapPlayer(slim(null))?.injury).toBeUndefined();
    expect(mapPlayer(slim('  '))?.injury).toBeUndefined();
  });
});

describe('parseLeagueId', () => {
  it('accepts a bare numeric id', () => {
    expect(parseLeagueId('1235622229488717824')).toBe('1235622229488717824');
  });

  it('extracts an id from a pasted league URL', () => {
    expect(parseLeagueId('https://sleeper.com/leagues/1235622229488717824/team')).toBe(
      '1235622229488717824',
    );
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseLeagueId('  1235622229488717824 ')).toBe('1235622229488717824');
  });

  it('rejects input with no id in it', () => {
    expect(parseLeagueId('my league')).toBeNull();
    expect(parseLeagueId('')).toBeNull();
  });
});

describe('mapSettings — playoffs', () => {
  it('reads when the playoffs start and how many teams make them', () => {
    const settings = mapSettings({
      ...baseLeague,
      settings: { ...baseLeague.settings, playoff_week_start: 14, playoff_teams: 4 },
    });
    expect(settings.playoffWeekStart).toBe(14);
    expect(settings.playoffTeams).toBe(4);
  });

  it("falls back to Sleeper's defaults when the league does not say", () => {
    const settings = mapSettings(baseLeague);
    expect(settings.playoffWeekStart).toBe(15);
    expect(settings.playoffTeams).toBe(6);
  });
});

describe('mapMatchups', () => {
  const row = (roster_id: number, matchup_id: number | null): SleeperMatchup => ({
    roster_id,
    matchup_id,
    points: 0,
  });

  it('pairs the two rosters that share a matchup id', () => {
    // Sleeper publishes no schedule; a fixture *is* two rows with one id.
    const fixtures = mapMatchups(3, [row(1, 1), row(4, 2), row(2, 1), row(3, 2)]);

    expect(fixtures).toEqual([
      { week: 3, rosterIds: [1, 2], points: null },
      { week: 3, rosterIds: [3, 4], points: null },
    ]);
  });

  it('stamps every fixture with the week it was asked for', () => {
    expect(mapMatchups(11, [row(1, 1), row(2, 1)])[0].week).toBe(11);
  });

  it('drops a roster with no fixture rather than inventing an opponent', () => {
    // An odd number of teams leaves someone out, and a null matchup_id is
    // Sleeper saying so. A phantom game would be played in the simulation.
    const fixtures = mapMatchups(1, [row(1, 1), row(2, 1), row(3, null)]);
    expect(fixtures).toEqual([{ week: 1, rosterIds: [1, 2], points: null }]);
  });

  it('carries the scores of a week that has been played', () => {
    // The only record of how this league actually scores, and therefore the
    // only way the simulation stops guessing at its two constants.
    const fixtures = mapMatchups(4, [
      { roster_id: 2, matchup_id: 1, points: 98.4 },
      { roster_id: 1, matchup_id: 1, points: 121.7 },
    ]);
    expect(fixtures).toEqual([{ week: 4, rosterIds: [1, 2], points: [121.7, 98.4] }]);
  });

  it('aligns scores with roster ids after sorting the pair', () => {
    // The pair is reordered to put the lower roster id first; the points have
    // to travel with their roster rather than staying where they were listed.
    const [fixture] = mapMatchups(4, [
      { roster_id: 7, matchup_id: 1, points: 150 },
      { roster_id: 3, matchup_id: 1, points: 90 },
    ]);
    expect(fixture.rosterIds).toEqual([3, 7]);
    expect(fixture.points).toEqual([90, 150]);
  });

  it('reads a week where nobody has scored as not yet played', () => {
    // Sleeper returns the fixture with points at 0 well before kickoff. A real
    // lineup scoring exactly nothing would need every starter to post a zero.
    const [fixture] = mapMatchups(9, [
      { roster_id: 1, matchup_id: 1, points: 0 },
      { roster_id: 2, matchup_id: 1, points: 0 },
    ]);
    expect(fixture.points).toBeNull();
  });

  it('treats a shutout on one side as played, because the other side scored', () => {
    const [fixture] = mapMatchups(9, [
      { roster_id: 1, matchup_id: 1, points: 0 },
      { roster_id: 2, matchup_id: 1, points: 104 },
    ]);
    expect(fixture.points).toEqual([0, 104]);
  });

  it('reads a missing points field as no result rather than zero', () => {
    const [fixture] = mapMatchups(9, [
      { roster_id: 1, matchup_id: 1 },
      { roster_id: 2, matchup_id: 1 },
    ]);
    expect(fixture.points).toBeNull();
  });

  it('drops a group that is not a clean pair', () => {
    // Three rosters on one id is not something Sleeper should produce, and
    // guessing which two play would put a game in that nobody scheduled.
    expect(mapMatchups(1, [row(1, 1), row(2, 1), row(3, 1)])).toEqual([]);
  });

  it('returns nothing for a week that has not been scheduled', () => {
    expect(mapMatchups(17, [])).toEqual([]);
  });

  it('orders fixtures the same way every time', () => {
    // The simulation is seeded, and a stable input is half of reproducible.
    const one = mapMatchups(1, [row(3, 2), row(1, 1), row(4, 2), row(2, 1)]);
    const two = mapMatchups(1, [row(1, 1), row(2, 1), row(3, 2), row(4, 2)]);
    expect(one).toEqual(two);
  });
});

describe('mapFreeAgents', () => {
  const slim = (id: string, team: string | null, position = 'WR'): SlimPlayer => ({
    id,
    name: `Player ${id}`,
    position,
    team,
    age: 25,
    yearsExp: 3,
    injuryStatus: null,
  });

  const index: Record<string, SlimPlayer> = {
    rostered: slim('rostered', 'KC'),
    onATeam: slim('onATeam', 'BUF'),
    unsigned: slim('unsigned', null),
    defense: slim('defense', 'MIN', 'DEF'),
  };

  const rostered = new Map([
    ['rostered', mapPlayer(index.rostered) as NonNullable<ReturnType<typeof mapPlayer>>],
  ]);

  it('keeps everyone on an NFL team that nobody rosters', () => {
    const free = mapFreeAgents(index, rostered);
    expect([...free.keys()].sort()).toEqual(['defense', 'onATeam']);
  });

  it('is disjoint from the rostered map, which is what protects replacement level', () => {
    const free = mapFreeAgents(index, rostered);
    for (const id of rostered.keys()) expect(free.has(id)).toBe(false);
  });

  it('drops players with no NFL team — retired and unsigned are not pickups', () => {
    expect(mapFreeAgents(index, rostered).has('unsigned')).toBe(false);
  });
});
