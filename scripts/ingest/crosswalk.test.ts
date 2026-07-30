import { describe, expect, it } from 'vitest';
import {
  describeUnmatched,
  matchRate,
  newMatchStats,
  observe,
  parseCrosswalk,
  recordMatch,
  tallyCandidates,
  type Candidate,
} from './crosswalk';

const HEADER = 'mfl_id,sleeper_id,gsis_id,pfr_id,espn_id,name';

const csv = (...rows: string[]) => [HEADER, ...rows].join('\n');

describe('parseCrosswalk', () => {
  it('indexes a player by every id the sources use', () => {
    const crosswalk = parseCrosswalk(csv('1,4034,00-0033873,MahoPa00,3139477,Patrick Mahomes'));

    expect(crosswalk.byGsis.get('00-0033873')).toBe('4034');
    expect(crosswalk.byPfr.get('MahoPa00')).toBe('4034');
    expect(crosswalk.byEspn.get('3139477')).toBe('4034');
    expect(crosswalk.rows).toBe(1);
  });

  it('treats the literal string NA as a missing id, not a real one', () => {
    // DynastyProcess writes NA rather than leaving the field blank. A
    // truthiness check passes it, which quietly files every unmapped player
    // under one key and produces a fictional player holding a dozen others'
    // weeks. This is the regression test for exactly that.
    const crosswalk = parseCrosswalk(
      csv(
        '1,NA,00-0000001,BeckCa01,4430841,Carson Beck',
        '2,13287,NA,LoveJe00,4870808,Jeremiyah Love',
      ),
    );

    expect(crosswalk.byGsis.has('NA')).toBe(false);
    expect(crosswalk.byPfr.has('NA')).toBe(false);
    expect(crosswalk.byEspn.has('NA')).toBe(false);

    // The player with no Sleeper id is not indexed under any of his other ids.
    expect(crosswalk.byGsis.has('00-0000001')).toBe(false);
    expect(crosswalk.byPfr.has('BeckCa01')).toBe(false);

    // The player with no gsis id is still reachable by the ids he does have.
    expect(crosswalk.byPfr.get('LoveJe00')).toBe('13287');
    expect(crosswalk.byEspn.get('4870808')).toBe('13287');
    expect(crosswalk.rows).toBe(1);
  });

  it('keeps the first mapping when a source id repeats', () => {
    const crosswalk = parseCrosswalk(
      csv('1,111,00-0000009,SameId00,900,Current', '2,222,00-0000009,SameId00,901,Stale'),
    );

    expect(crosswalk.byGsis.get('00-0000009')).toBe('111');
    expect(crosswalk.byPfr.get('SameId00')).toBe('111');
  });

  it('fails with a readable error when an id column is renamed', () => {
    const drifted = ['mfl_id,sleeper_id,gsis_id,espn_id,name', '1,4034,00-0033873,3139477,X'].join(
      '\n',
    );

    expect(() => parseCrosswalk(drifted)).toThrowError(/missing column pfr_id/);
  });

  it('fails with a readable error when the file has no rows', () => {
    expect(() => parseCrosswalk(HEADER)).toThrowError(/no data rows/);
  });
});

describe('match accounting', () => {
  const player = (over: Partial<Parameters<typeof recordMatch>[1]>) => ({
    position: 'WR',
    sleeperId: undefined,
    name: 'Someone',
    relevant: true,
    note: 'WR1',
    ...over,
  });

  it('tracks matched and unmatched per position', () => {
    const stats = newMatchStats();
    recordMatch(stats, player({ position: 'WR', sleeperId: '7564', name: "Ja'Marr Chase" }));
    recordMatch(stats, player({ position: 'WR', name: 'Camp Body' }));
    recordMatch(stats, player({ position: 'QB', sleeperId: '4034', name: 'Patrick Mahomes' }));

    expect(matchRate(stats.all.total)).toBeCloseTo(2 / 3);
    expect(matchRate(stats.all.byPosition.WR)).toBe(0.5);
    expect(matchRate(stats.all.byPosition.QB)).toBe(1);
    expect(stats.unmatched.map((p) => p.name)).toEqual(['Camp Body']);
  });

  it('counts only players with a role toward the relevant tally', () => {
    // The whole point of the split: a camp body who does not resolve must not
    // drag down the number the build gate reads.
    const stats = newMatchStats();
    recordMatch(stats, player({ sleeperId: '7564', relevant: true }));
    recordMatch(stats, player({ name: 'Camp Body', relevant: false, note: 'WR11' }));

    expect(matchRate(stats.all.total)).toBe(0.5);
    expect(matchRate(stats.relevant.total)).toBe(1);
    expect(stats.relevant.byPosition.WR).toEqual({ matched: 1, unmatched: 0 });
  });

  it('records an unmatched player once, with the evidence that he mattered', () => {
    const stats = newMatchStats();
    recordMatch(stats, player({ name: 'Cody White', note: 'peak 73% snaps' }));

    expect(stats.unmatched).toEqual([
      { name: 'Cody White', position: 'WR', note: 'peak 73% snaps', relevant: true },
    ]);
  });

  it('renders an unmatched player one way, for the log and the exception alike', () => {
    expect(
      describeUnmatched({
        name: 'Cody White',
        position: 'WR',
        note: 'peak 73% snaps',
        relevant: true,
      }),
    ).toBe('Cody White (WR, peak 73% snaps)');
  });

  it('reports zero rather than dividing by zero on an empty position', () => {
    expect(matchRate({ matched: 0, unmatched: 0 })).toBe(0);
  });
});

describe('deferred candidates', () => {
  it('keeps the best week, whatever order the rows arrive in', () => {
    // Relevance has to survive row order: a starter eased in on 8% of snaps in
    // week 1 must not be written off before week 9 is read.
    const candidates = new Map<string, Candidate>();
    const player = { name: 'Someone', position: 'TE', sleeperId: undefined };

    observe(candidates, 'k', player, 0.81);
    observe(candidates, 'k', player, 0.08);

    expect(candidates.get('k')?.peak).toBe(0.81);
  });

  it('tallies each candidate once, against the relevance bar', () => {
    const candidates = new Map<string, Candidate>();
    observe(candidates, 'a', { name: 'Starter', position: 'WR', sleeperId: '1' }, 0.9);
    observe(candidates, 'b', { name: 'Fringe', position: 'WR', sleeperId: undefined }, 0.05);

    const stats = tallyCandidates(candidates.values(), 0.25, (peak) => `peak ${peak}`);

    expect(stats.all.total).toEqual({ matched: 1, unmatched: 1 });
    expect(stats.relevant.total).toEqual({ matched: 1, unmatched: 0 });
    expect(stats.unmatched).toEqual([
      { name: 'Fringe', position: 'WR', note: 'peak 0.05', relevant: false },
    ]);
  });
});
