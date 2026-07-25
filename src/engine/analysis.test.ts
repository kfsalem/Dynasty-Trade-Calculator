import { describe, expect, it } from 'vitest';
import {
  analyzeTeam,
  contentionProfile,
  futureScore,
  positionalStarterValue,
  retention,
} from './analysis';
import { summarizeRoster, type RosterSummary } from './rosterValue';
import type { LineupSlot, Player, PlayerValue, Position, Roster } from '../types';
import { makeLeague, makePlayer, makeRoster, makeSettings, makeValue } from './testFixtures';

const SLOTS: LineupSlot[] = ['QB', 'RB', 'WR'];
const settings = makeSettings(SLOTS);

/**
 * Four teams spanning the quadrant space: strong/weak now crossed with
 * young/old. Ages are 23 (before every cliff) and 31 (past QB, RB and WR).
 */
function world() {
  const players = new Map<string, Player>();
  const values = new Map<string, PlayerValue>();
  const rosters: Roster[] = [];

  const build = (id: number, value: number, age: number) => {
    const ids: string[] = [];
    (['QB', 'RB', 'WR'] as Position[]).forEach((position) => {
      const pid = `t${id}_${position}`;
      players.set(pid, makePlayer(pid, position, age));
      values.set(pid, makeValue(pid, value));
      ids.push(pid);
    });
    rosters.push(makeRoster(id, ids));
  };

  build(1, 3000, 23); // strong + young
  build(2, 3000, 31); // strong + old
  build(3, 2500, 23); // weaker + young
  build(4, 1000, 31); // weak + old

  const league = makeLeague(rosters, settings);
  const summaries: RosterSummary[] = rosters.map((r) =>
    summarizeRoster(r, players, values, settings),
  );

  return { league, players, values, summaries };
}

describe('retention', () => {
  it('keeps full value for a player still short of the cliff', () => {
    expect(retention('WR', 23, 3)).toBe(1);
  });

  it('decays once the horizon pushes a player past the cliff', () => {
    // RB cliff is 26; at 25 + 3 years the player is 2 years past.
    expect(retention('RB', 25, 3)).toBeCloseTo(0.72 ** 2, 5);
  });

  it('punishes running backs far harder than quarterbacks', () => {
    expect(retention('RB', 30, 3)).toBeLessThan(retention('QB', 30, 3));
  });

  it('treats unknown ages as no decay rather than guessing', () => {
    expect(retention('RB', null, 3)).toBe(1);
  });
});

describe('positionalStarterValue', () => {
  it('attributes a flex starter to the position of whoever fills it', () => {
    const players = new Map<string, Player>([
      ['wr1', makePlayer('wr1', 'WR')],
      ['wr2', makePlayer('wr2', 'WR')],
      ['rb1', makePlayer('rb1', 'RB')],
    ]);
    const values = new Map<string, PlayerValue>([
      ['wr1', makeValue('wr1', 900)],
      ['wr2', makeValue('wr2', 800)],
      ['rb1', makeValue('rb1', 100)],
    ]);
    const flexSettings = makeSettings(['WR', 'FLEX']);
    const summary = summarizeRoster(
      makeRoster(1, ['wr1', 'wr2', 'rb1']),
      players,
      values,
      flexSettings,
    );

    // wr2 occupies FLEX, so both starters count toward WR.
    expect(positionalStarterValue(summary)).toEqual({ WR: 1700 });
  });
});

describe('futureScore', () => {
  it('ranks a young roster above an identical older one', () => {
    const { summaries } = world();
    const young = futureScore(summaries[0], settings);
    const old = futureScore(summaries[1], settings);

    // Same value today...
    expect(summaries[0].starterValue).toBe(summaries[1].starterValue);
    // ...but not in three years.
    expect(young).toBeGreaterThan(old);
  });

  it('never projects growth, only decay', () => {
    const { summaries } = world();
    for (const summary of summaries) {
      expect(futureScore(summary, settings)).toBeLessThanOrEqual(summary.starterValue);
    }
  });
});

describe('contentionProfile', () => {
  it('places each team in the right quadrant', () => {
    const { summaries } = world();
    const quadrant = (i: number) =>
      contentionProfile(summaries[i], summaries, settings).quadrant;

    expect(quadrant(0)).toBe('juggernaut');
    expect(quadrant(1)).toBe('win_now');
    expect(quadrant(2)).toBe('rebuilding');
    expect(quadrant(3)).toBe('danger');
  });

  it('reports rank within the league', () => {
    const { summaries } = world();
    const profile = contentionProfile(summaries[3], summaries, settings);
    expect(profile.teamCount).toBe(4);
    expect(profile.nowRank).toBe(4);
    expect(profile.futureRank).toBe(4);
  });
});

describe('analyzeTeam', () => {
  it('flags positions above and below the league as strengths and weaknesses', () => {
    const { summaries } = world();
    const weakest = analyzeTeam(4, summaries, settings);
    expect(weakest).not.toBeNull();
    // Team 4 trails at every position.
    expect(weakest?.weaknesses.map((w) => w.position).sort()).toEqual(['QB', 'RB', 'WR']);
    expect(weakest?.strengths).toHaveLength(0);
  });

  it('counts a bench player as surplus whenever another team would start him', () => {
    const { players, values, summaries } = world();
    // Team 1 rosters a second WR worth 2,000. He sits behind their 3,000 WR,
    // and he is below the league's *median* starter — but he still beats what
    // team 4 starts at WR (1,000), so he is a genuine trade chip.
    players.set('t1_WR2', makePlayer('t1_WR2', 'WR', 24));
    values.set('t1_WR2', makeValue('t1_WR2', 2000));

    const boosted = summarizeRoster(
      makeRoster(1, ['t1_QB', 't1_RB', 't1_WR', 't1_WR2']),
      players,
      values,
      settings,
    );
    const all = [boosted, ...summaries.slice(1)];
    const analysis = analyzeTeam(1, all, settings);

    const chip = analysis?.surpluses.find((s) => s.player.id === 't1_WR2');
    expect(chip).toBeDefined();
    expect(chip?.wouldStartOn).toBe(1); // only team 4 starts a worse WR
  });

  it('does not report a bench player nobody else would start', () => {
    const { players, values, summaries } = world();
    // Worth less than every other team's starting WR.
    players.set('t1_scrub', makePlayer('t1_scrub', 'WR', 24));
    values.set('t1_scrub', makeValue('t1_scrub', 50));

    const boosted = summarizeRoster(
      makeRoster(1, ['t1_QB', 't1_RB', 't1_WR', 't1_scrub']),
      players,
      values,
      settings,
    );
    const analysis = analyzeTeam(1, [boosted, ...summaries.slice(1)], settings);
    expect(analysis?.surpluses.map((s) => s.player.id)).not.toContain('t1_scrub');
  });

  it('counts how many other teams a surplus player would start for', () => {
    const players = new Map<string, Player>();
    const values = new Map<string, PlayerValue>();
    const rosters: Roster[] = [];

    // Three weak teams and one loaded team with a benched star WR.
    for (const id of [1, 2, 3]) {
      const pid = `t${id}_WR`;
      players.set(pid, makePlayer(pid, 'WR', 25));
      values.set(pid, makeValue(pid, 500));
      rosters.push(makeRoster(id, [pid]));
    }
    players.set('star', makePlayer('star', 'WR', 24));
    values.set('star', makeValue('star', 9000));
    players.set('starter', makePlayer('starter', 'WR', 24));
    values.set('starter', makeValue('starter', 9500));
    rosters.push(makeRoster(4, ['starter', 'star']));

    const wrOnly = makeSettings(['WR']);
    const summaries = rosters.map((r) => summarizeRoster(r, players, values, wrOnly));
    const analysis = analyzeTeam(4, summaries, wrOnly);

    const star = analysis?.surpluses.find((s) => s.player.id === 'star');
    expect(star).toBeDefined();
    // Better than the lone starter on each of the other three teams.
    expect(star?.wouldStartOn).toBe(3);
  });

  it('returns null for a roster that is not in the league', () => {
    const { summaries } = world();
    expect(analyzeTeam(99, summaries, settings)).toBeNull();
  });

  it('always produces at least the contention advice as focus', () => {
    const { summaries } = world();
    const analysis = analyzeTeam(1, summaries, settings);
    expect(analysis?.focus.length).toBeGreaterThan(0);
    expect(analysis?.focus[0]).toBe(analysis?.contention.advice);
  });
});
