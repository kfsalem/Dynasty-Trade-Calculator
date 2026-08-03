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

describe('contention quadrant', () => {
  /**
   * Four teams whose *absolute* future scores fall in the same order as their
   * present ones, because the value spread between rosters is wider than the
   * age spread. Judging the future axis on absolute score collapses this league
   * into juggernauts and danger-zone teams with nothing in between — which is
   * exactly what happened on a real 10-team league.
   */
  function skewed() {
    const players = new Map<string, Player>();
    const values = new Map<string, PlayerValue>();
    const rosters: Roster[] = [];
    const slots: LineupSlot[] = ['WR', 'WR', 'WR'];
    const wrSettings = makeSettings(slots, { teamCount: 4 });

    // Age 23 survives the horizon intact; age 28 is three years past the WR
    // cliff by then and keeps about 55%.
    const build = (id: number, total: number, age: number) => {
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const pid = `s${id}_${i}`;
        players.set(pid, makePlayer(pid, 'WR', age));
        values.set(pid, makeValue(pid, total / 3));
        ids.push(pid);
      }
      rosters.push(makeRoster(id, ids));
    };

    build(1, 10000, 23); // strong, young
    build(2, 8000, 28); // strong, old
    build(3, 3000, 23); // weak, young
    build(4, 2500, 28); // weak, old

    const summaries = rosters.map((r) => summarizeRoster(r, players, values, wrSettings));
    return { summaries, settings: wrSettings };
  }

  it('separates young from old rather than ranking strength twice', () => {
    const { summaries, settings: wrSettings } = skewed();
    const quadrant = (rosterId: number) =>
      contentionProfile(
        summaries.find((s) => s.rosterId === rosterId) as RosterSummary,
        summaries,
        wrSettings,
      ).quadrant;

    expect(quadrant(1)).toBe('juggernaut');
    expect(quadrant(2)).toBe('win_now');
    expect(quadrant(3)).toBe('rebuilding');
    expect(quadrant(4)).toBe('danger');
  });

  it('reports the share of value that survives the horizon', () => {
    const { summaries, settings: wrSettings } = skewed();
    const young = contentionProfile(
      summaries.find((s) => s.rosterId === 1) as RosterSummary,
      summaries,
      wrSettings,
    );
    const old = contentionProfile(
      summaries.find((s) => s.rosterId === 2) as RosterSummary,
      summaries,
      wrSettings,
    );

    // Projected values are rounded to whole points, so the ratio is only
    // meaningful to about three decimals.
    expect(young.retainedShare).toBeCloseTo(1, 3);
    expect(old.retainedShare).toBeCloseTo(0.82 ** 3, 3);
  });

  /**
   * Two rosters the dynasty scale cannot tell apart, and the win-now scale
   * calls opposites.
   *
   * Identical dynasty value at every slot — 3,000 a man, so their asset totals
   * match to the point. One roster is aging starters whose redraft price is
   * *above* their dynasty price; the other is prospects whose redraft price is
   * near zero. This is the real league's Mike Evans and Travis Hunter, reduced
   * until nothing else can explain a difference in the answer.
   */
  function horizons() {
    const players = new Map<string, Player>();
    const values = new Map<string, PlayerValue>();
    const rosters: Roster[] = [];
    const twoTeams = makeSettings(SLOTS, { teamCount: 2 });

    const build = (id: number, age: number, redraft: number) => {
      const ids: string[] = [];
      (['QB', 'RB', 'WR'] as Position[]).forEach((position) => {
        const pid = `h${id}_${position}`;
        players.set(pid, makePlayer(pid, position, age));
        values.set(pid, makeValue(pid, 3000, position, 3000, redraft));
        ids.push(pid);
      });
      rosters.push(makeRoster(id, ids));
    };

    build(1, 31, 5000); // aging starters — better this year than their price says
    build(2, 23, 200); // prospects — all of it still ahead of them

    const summaries = rosters.map((r) => summarizeRoster(r, players, values, twoTeams));
    return { summaries, settings: twoTeams };
  }

  it('calls a roster of prospects rebuilding, where dynasty called it a juggernaut', () => {
    const { summaries, settings: twoTeams } = horizons();
    const profile = (rosterId: number) =>
      contentionProfile(
        summaries.find((s) => s.rosterId === rosterId) as RosterSummary,
        summaries,
        twoTeams,
      );

    // Identical as assets, which is precisely why the old model had nothing to
    // say: both lineups summed to 9,000 dynasty points, so the median split put
    // both on the strong side and the prospects came out a *juggernaut*.
    expect(summaries[0].starterAssetValue).toBe(summaries[1].starterAssetValue);

    expect(profile(1).quadrant).toBe('win_now');
    expect(profile(2).quadrant).toBe('rebuilding');

    // And the axis that moved is the present one, not the future one.
    expect(profile(1).nowScore).toBeGreaterThan(profile(2).nowScore * 10);
  });

  it('keeps the future axis on dynasty, so prospects have a future at all', () => {
    // The trap in moving everything to win-now at once. Redraft value prices
    // this season, so a prospect enters at nothing and decays to nothing — a
    // team built of them would project to no future whatsoever, in the one
    // calculation whose entire subject is the future.
    const { summaries, settings: twoTeams } = horizons();
    const prospects = contentionProfile(summaries[1], summaries, twoTeams);

    expect(prospects.futureScore).toBe(9000);
    expect(prospects.futureScore).toBeGreaterThan(prospects.nowScore);
    // No longer bounded by 1: a rebuild can hold more future than present.
    expect(prospects.retainedShare).toBeGreaterThan(1);
  });
});

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

  it('keeps an injured player in the three-year lineup', () => {
    // A torn ACL this August is not a fact about 2029. The one calculation
    // whose whole subject is the future must not let one hamstring erase a
    // player from a team's outlook — and this season's lineup, right beside it,
    // must.
    const players = new Map<string, Player>([
      ['hurt', makePlayer('hurt', 'WR', 24, { status: 'ir' })],
    ]);
    const values = new Map<string, PlayerValue>([['hurt', makeValue('hurt', 5000)]]);
    const wrOnly = makeSettings(['WR']);
    const summary = summarizeRoster(makeRoster(1, ['hurt']), players, values, wrOnly);

    expect(summary.starterValue).toBe(0);
    expect(futureScore(summary, wrOnly)).toBe(5000);
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

  it('carries how far a team is from each split, not just which side it fell', () => {
    /**
     * The quadrant is a median split, so half the league is "weak now" by
     * construction — on the real ten-team league that hands the danger-zone
     * verdict to a roster sitting sixth of ten, four percent under the median.
     * As a label that is merely unkind. As the *only* input to `WINDOW_WEIGHTS`
     * it scored that team on every trade as though it had given up on the
     * season, while the team a hair above it was scored as a contender.
     *
     * These shares carry the distance the label throws away, so
     * `suggest.windowWeights` can be continuous where the label cannot.
     */
    const { summaries } = world();
    const profiles = summaries.map((s) => contentionProfile(s, summaries, settings));

    const shares = profiles.map((p) => p.nowShare);
    expect(Math.min(...shares)).toBe(0);
    // The top of the range need not reach 1: teams tied on score share a place,
    // and a share that ignored ties would order them on nothing.
    expect(Math.max(...shares)).toBeGreaterThan(0.5);

    for (const profile of profiles) {
      expect(profile.nowShare).toBeGreaterThanOrEqual(0);
      expect(profile.nowShare).toBeLessThanOrEqual(1);
      expect(profile.youthShare).toBeGreaterThanOrEqual(0);
      expect(profile.youthShare).toBeLessThanOrEqual(1);
    }

    // The share must order teams the way the score does, or it is measuring
    // something other than the axis the label splits on.
    const byScore = [...profiles].sort((a, b) => a.nowScore - b.nowScore);
    for (let i = 1; i < byScore.length; i++) {
      expect(byScore[i].nowShare).toBeGreaterThanOrEqual(byScore[i - 1].nowShare);
    }
  });

  it('puts a one-team league in the middle rather than at an extreme', () => {
    // A share of 0 or 1 would say the league's only roster is its weakest or
    // its strongest — true, and useless. With nobody to contend against, no
    // window is indicated either way.
    const { summaries } = world();
    const alone = contentionProfile(summaries[0], [summaries[0]], settings);

    expect(alone.nowShare).toBe(0.5);
    expect(alone.youthShare).toBe(0.5);
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

  it('does not call an expensive prospect a surplus somebody would start', () => {
    /**
     * The surplus test is a lineup question — *would they play him* — so it is
     * asked on the win-now scale. Before R8 it out-priced a weak starter on
     * dynasty and the model reported a rookie with no role as a trade chip
     * three other managers were waiting to start, which no manager in the
     * league would have done.
     */
    const { players, values, summaries } = world();

    // Same dynasty price, opposite redraft prices. Only the scale can tell them
    // apart, so the assertion is about nothing else.
    players.set('t1_rookie', makePlayer('t1_rookie', 'WR', 22));
    values.set('t1_rookie', makeValue('t1_rookie', 2000, 'WR', 2000, 40));
    players.set('t1_vet', makePlayer('t1_vet', 'WR', 32));
    values.set('t1_vet', makeValue('t1_vet', 2000, 'WR', 2000, 2600));

    const boosted = summarizeRoster(
      makeRoster(1, ['t1_QB', 't1_RB', 't1_WR', 't1_rookie', 't1_vet']),
      players,
      values,
      settings,
    );
    const analysis = analyzeTeam(1, [boosted, ...summaries.slice(1)], settings);
    const ids = analysis?.surpluses.map((s) => s.player.id) ?? [];

    expect(ids).toContain('t1_vet');
    expect(ids).not.toContain('t1_rookie');

    // Still priced as the asset he is, though — the surplus *test* is win-now,
    // the figure the trade is worth is not.
    expect(analysis?.surpluses.find((s) => s.player.id === 't1_vet')?.value).toBe(2000);
  });

  it('does not offer an injured player as a surplus somebody would start', () => {
    // R9 took injured players out of lineups, which drops them into the exact
    // bucket this list draws from. "Benched here, but would start for another
    // team" is not something to say about a man on injured reserve, and the
    // suggestion engine reads this list to decide who to shop.
    const { players, values, summaries } = world();

    players.set('t1_hurt', makePlayer('t1_hurt', 'WR', 24, { status: 'ir' }));
    values.set('t1_hurt', makeValue('t1_hurt', 2000));

    const boosted = summarizeRoster(
      makeRoster(1, ['t1_QB', 't1_RB', 't1_WR', 't1_hurt']),
      players,
      values,
      settings,
    );
    const analysis = analyzeTeam(1, [boosted, ...summaries.slice(1)], settings);

    // The identical healthy player is a chip; see the test three above.
    expect(analysis?.surpluses.map((s) => s.player.id)).not.toContain('t1_hurt');
  });

  it('measures positional weakness on the lineup, not on the asset pile', () => {
    // Three expensive rookie receivers are not a strength at receiver this
    // year, and saying otherwise sends the trade engine hunting for the wrong
    // position entirely.
    const { players, values } = world();
    const rookies = ['r1', 'r2', 'r3'];
    for (const id of rookies) {
      players.set(id, makePlayer(id, 'WR', 22));
      values.set(id, makeValue(id, 4000, 'WR', 4000, 50));
    }

    const stocked = summarizeRoster(
      makeRoster(1, ['t1_QB', 't1_RB', ...rookies]),
      players,
      values,
      settings,
    );

    expect(positionalStarterValue(stocked).WR).toBe(50);
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
