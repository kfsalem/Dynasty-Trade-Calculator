import { describe, expect, it } from 'vitest';
import { matchRate, newMatchStats, parseCrosswalk, recordMatch } from './crosswalk';

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
  it('tracks matched and unmatched per position', () => {
    const stats = newMatchStats();
    recordMatch(stats, 'WR', '7564', "Ja'Marr Chase");
    recordMatch(stats, 'WR', undefined, 'Camp Body');
    recordMatch(stats, 'QB', '4034', 'Patrick Mahomes');

    expect(matchRate(stats)).toBeCloseTo(2 / 3);
    expect(matchRate(stats.byPosition.WR)).toBe(0.5);
    expect(matchRate(stats.byPosition.QB)).toBe(1);
    expect(stats.unmatchedNames).toEqual(['Camp Body (WR)']);
  });

  it('reports zero rather than dividing by zero on an empty position', () => {
    expect(matchRate({ matched: 0, unmatched: 0 })).toBe(0);
  });
});
