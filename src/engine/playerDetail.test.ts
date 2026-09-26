import { describe, expect, it } from 'vitest';
import { pickDetail, playerDetail, type PlayerDetailSources } from './playerDetail';
import { summarizeRoster } from './rosterValue';
import type { FreeAgent } from './freeAgents';
import type { RoleTrend } from './roleTrend';
import type { Player, PlayerValue } from '../types';
import {
  makeLeague,
  makePick,
  makePlayer,
  makeRoster,
  makeSettings,
  makeValue,
} from './testFixtures';

/**
 * One WR slot, three teams. Roster 1 is yours: a 3,000 starter and a 1,000
 * backup. Roster 2 starts a 2,000 receiver and roster 3 a 500 one. A 1,500
 * receiver sits on the wire.
 */
function sources(over: Partial<PlayerDetailSources> = {}): PlayerDetailSources {
  const settings = makeSettings(['WR']);
  const players = new Map<string, Player>();
  const values = new Map<string, PlayerValue>();
  const add = (id: string, value: number) => {
    players.set(id, makePlayer(id, 'WR'));
    values.set(id, makeValue(id, value, 'WR'));
  };
  add('star', 3000);
  add('backup', 1000);
  add('b', 2000);
  add('c', 500);

  const rosters = [
    makeRoster(1, ['star', 'backup']),
    makeRoster(2, ['b']),
    makeRoster(3, ['c']),
  ];
  const league = makeLeague(rosters, settings);
  const summaries = rosters.map((r) => summarizeRoster(r, players, values, settings));

  const wire: FreeAgent = {
    player: makePlayer('wire', 'WR'),
    value: makeValue('wire', 1500, 'WR'),
    snaps: undefined,
    usage: undefined,
    adjustment: undefined,
  };

  return { league, summaries, myRosterId: 1, freeAgents: [wire], ...over };
}

describe('playerDetail', () => {
  it('places a rostered player: whose he is, and whether he starts there', () => {
    const star = playerDetail('star', sources());
    expect(star?.owner).toEqual({ rosterId: 1, teamName: 'Team 1', mine: true });
    expect(star?.starting).toBe(true);

    const backup = playerDetail('backup', sources());
    expect(backup?.starting).toBe(false);
    expect(backup?.value).toEqual({ dynasty: 1000, winNow: 1000, market: 1000 });
  });

  // The surplus list's question, asked of one player: a 1,000 backup beats
  // roster 3's 500 starter and not roster 2's 2,000 one.
  it('counts the other rosters he would start on, never his own', () => {
    expect(playerDetail('backup', sources())?.wouldStartOn).toBe(1);
  });

  it('reads a free agent off the wire and measures him against every roster', () => {
    const wire = playerDetail('wire', sources());
    expect(wire?.owner).toBeNull();
    expect(wire?.starting).toBeNull();
    // Beats roster 3's 500; not 2,000 or your 3,000.
    expect(wire?.wouldStartOn).toBe(1);
  });

  it('carries a role trend when the player is on one of the lists', () => {
    const star = sources().summaries[0].players[0].player;
    const trend = { player: star } as RoleTrend;
    const detail = playerDetail(
      'star',
      sources({ trends: { buyLow: [], sellHigh: [trend], priced: true } as never }),
    );
    expect(detail?.trend?.side).toBe('sell-high');
  });

  it('returns null for an id the league has never heard of', () => {
    expect(playerDetail('nobody', sources())).toBeNull();
  });
});

describe('pickDetail', () => {
  it('names who holds a pick and whose finish decides where it lands', () => {
    const { league } = sources();
    const pick = makePick('2027-1-2', '2027', 1, 2, 900, { ownerRosterId: 1 });

    const detail = pickDetail('2027-1-2', { league, picks: [pick], myRosterId: 1 });

    expect(detail?.holder).toEqual({ rosterId: 1, teamName: 'Team 1', mine: true });
    expect(detail?.original).toEqual({ rosterId: 2, teamName: 'Team 2', mine: false });
    expect(detail?.teamCount).toBe(3);
  });

  it('returns null for an id that is not a pick', () => {
    const { league } = sources();
    expect(pickDetail('star', { league, picks: [], myRosterId: 1 })).toBeNull();
  });
});
