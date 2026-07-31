import { describe, expect, it } from 'vitest';
import { parseCrosswalk } from './crosswalk';
import { reduceSnapCounts } from './snapCounts';

const CROSSWALK = parseCrosswalk(
  [
    'sleeper_id,gsis_id,pfr_id,espn_id,name',
    '7564,00-0036900,ChasJa00,4362628,JaMarr Chase',
    '4034,00-0033873,MahoPa00,3139477,Patrick Mahomes',
    '4866,00-0034857,BarkSa00,3929630,Saquon Barkley',
  ].join('\n'),
);

const HEADER =
  'season,week,game_type,player,pfr_player_id,position,team,offense_snaps,offense_pct';

const csv = (...rows: string[]) => [HEADER, ...rows].join('\n');

const META = { season: 2025, source: 'test', generatedAt: '2026-07-30T00:00:00.000Z' };

const reduce = (text: string) => reduceSnapCounts(text, CROSSWALK, META);

describe('reduceSnapCounts', () => {
  it('keys weekly snaps by Sleeper id', () => {
    const { file } = reduce(
      csv(
        '2025,1,REG,JaMarr Chase,ChasJa00,WR,CIN,45,0.87',
        '2025,2,REG,JaMarr Chase,ChasJa00,WR,CIN,66,0.96',
      ),
    );

    expect(file.players['7564']).toEqual({
      pos: 'WR',
      team: 'CIN',
      weeks: [
        [1, 45, 0.87],
        [2, 66, 0.96],
      ],
    });
    expect(file.throughWeek).toBe(2);
    expect(file.season).toBe(2025);
  });

  it('ignores the postseason, which is not what dynasty value is priced on', () => {
    const { file } = reduce(
      csv(
        '2025,1,REG,JaMarr Chase,ChasJa00,WR,CIN,45,0.87',
        '2025,1,POST,JaMarr Chase,ChasJa00,WR,CIN,70,0.99',
      ),
    );

    expect(file.players['7564'].weeks).toEqual([[1, 45, 0.87]]);
    expect(file.throughWeek).toBe(1);
  });

  it('drops linemen and defenders', () => {
    const { file, stats } = reduce(
      csv(
        '2025,1,REG,JaMarr Chase,ChasJa00,WR,CIN,45,0.87',
        '2025,1,REG,Some Tackle,TackSo00,T,CIN,70,1',
        '2025,1,REG,Some Corner,CornSo00,CB,CIN,60,0.9',
      ),
    );

    expect(Object.keys(file.players)).toEqual(['7564']);
    // Non-skill players are not counted as match failures either.
    expect(stats.all.total).toEqual({ matched: 1, unmatched: 0 });
  });

  it('reads a halfback as a running back', () => {
    // Snap counts carry PFR roster positions — the only nflverse file that
    // does — so a back can arrive as HB. Chase Brown and Samaje Perine were
    // missing from the shipped data entirely until this was handled.
    const { file, stats } = reduce(csv('2025,1,REG,Saquon Barkley,BarkSa00,HB,PHI,50,0.75'));

    expect(file.players['4866']).toEqual({ pos: 'RB', team: 'PHI', weeks: [[1, 50, 0.75]] });
    expect(stats.relevant.byPosition.RB).toEqual({ matched: 1, unmatched: 0 });
  });

  it('reports a position code that took real snaps and was not ingested', () => {
    // The check the match gate cannot make: anything filtered out by position
    // never reaches the tally, so a code we stopped recognizing is invisible to
    // every rate while the build stays green. This is how HB hid.
    const { notes } = reduce(
      csv(
        '2025,1,REG,JaMarr Chase,ChasJa00,WR,CIN,45,0.87',
        '2025,1,REG,Converted Corner,CornCo00,CB,CIN,40,0.6',
      ),
    );

    expect(notes).toEqual([
      '1 of 1 players at "CB" took real offensive snaps but are not an ingested position',
    ]);
  });

  it('stays quiet about positions that took no offensive snaps', () => {
    // Every defender appears on every snap report with zero offensive snaps.
    // Reporting them would bury the one line that matters.
    const { notes } = reduce(
      csv(
        '2025,1,REG,JaMarr Chase,ChasJa00,WR,CIN,45,0.87',
        '2025,1,REG,A Linebacker,LineA000,LB,CIN,0,0',
      ),
    );

    expect(notes).toEqual([]);
  });

  it('stays quiet about linemen, who take snaps but are skipped deliberately', () => {
    const { notes } = reduce(
      csv(
        '2025,1,REG,JaMarr Chase,ChasJa00,WR,CIN,45,0.87',
        '2025,1,REG,Some Tackle,TackSo00,T,CIN,70,1',
        '2025,1,REG,Some Guard,GuarSo00,G,CIN,70,1',
      ),
    );

    expect(notes).toEqual([]);
  });

  it('fails the build when a whole position looks renamed', () => {
    // A few players at an odd position is a converted receiver. Ten is the
    // source having changed a position code under us.
    const rows = Array.from(
      { length: 10 },
      (_, i) => `2025,1,REG,Back ${i},Back${i}0000,TAILBACK,CIN,50,0.8`,
    );

    expect(() => reduce(csv(...rows))).toThrowError(
      /10 players listed at "TAILBACK" took a real share of their team's offensive snaps/,
    );
  });

  it('reports a player as unmatched once, not once per week', () => {
    const { file, stats } = reduce(
      csv(
        '2025,1,REG,Practice Squad,UnknoPl00,TE,NYJ,5,0.1',
        '2025,2,REG,Practice Squad,UnknoPl00,TE,NYJ,7,0.12',
      ),
    );

    expect(file.players).toEqual({});
    expect(stats.unmatched).toEqual([
      { name: 'Practice Squad', position: 'TE', note: 'peak 12% snaps', relevant: false },
    ]);
    expect(stats.all.byPosition.TE).toEqual({ matched: 0, unmatched: 1 });
  });

  it('rates a player by his best week, not his first', () => {
    // Relevance has to survive row order: a starter who was eased in on 8% of
    // snaps in week 1 must not be written off before week 9 is read.
    const { stats } = reduce(
      csv(
        '2025,1,REG,Practice Squad,UnknoPl00,TE,NYJ,4,0.08',
        '2025,9,REG,Practice Squad,UnknoPl00,TE,NYJ,52,0.81',
      ),
    );

    expect(stats.unmatched).toEqual([
      { name: 'Practice Squad', position: 'TE', note: 'peak 81% snaps', relevant: true },
    ]);
    expect(stats.relevant.byPosition.TE).toEqual({ matched: 0, unmatched: 1 });
  });

  it('counts a player with an unusable id as unmatched, not as absent', () => {
    // The failure the gate exists to catch is coverage collapsing. If a row
    // with no usable id were skipped before accounting, it would leave the
    // denominator too, and the rate would read 100% while half the players
    // disappeared.
    const { file, stats } = reduce(
      csv(
        "2025,1,REG,Ja'Marr Chase,ChasJa00,WR,CIN,45,0.87",
        '2025,1,REG,No Id,NA,WR,CIN,50,0.9',
        '2025,1,REG,Blank Id,,WR,CIN,50,0.9',
      ),
    );

    expect(Object.keys(file.players)).toEqual(['7564']);
    expect(stats.relevant.byPosition.WR).toEqual({ matched: 1, unmatched: 2 });
    expect(stats.unmatched.map((p) => p.name)).toEqual(['No Id', 'Blank Id']);
  });

  it('counts a player whose usage never parses, rather than dropping him', () => {
    const { stats } = reduce(csv('2025,1,REG,Unparseable,UnknoPl00,WR,CIN,NA,NA'));

    expect(stats.all.byPosition.WR).toEqual({ matched: 0, unmatched: 1 });
  });

  it('leaves a fringe player out of the tally the build gate reads', () => {
    const { stats } = reduce(
      csv(
        "2025,1,REG,Ja'Marr Chase,ChasJa00,WR,CIN,45,0.87",
        '2025,1,REG,Camp Body,UnknoPl00,WR,CIN,3,0.05',
      ),
    );

    expect(stats.all.total).toEqual({ matched: 1, unmatched: 1 });
    expect(stats.relevant.total).toEqual({ matched: 1, unmatched: 0 });
  });

  it('reports the team a traded player finished on, whatever order rows arrive in', () => {
    const { file } = reduce(
      csv(
        '2025,9,REG,Saquon Barkley,BarkSa00,RB,NYG,50,0.7',
        '2025,3,REG,Saquon Barkley,BarkSa00,RB,PHI,40,0.6',
      ),
    );

    expect(file.players['4866'].team).toBe('NYG');
    expect(file.players['4866'].weeks).toEqual([
      [3, 40, 0.6],
      [9, 50, 0.7],
    ]);
  });

  it('keeps a zero-snap week, which is not the same as no data', () => {
    // R3 has to render "no snap report" and "dressed but never played"
    // differently. Dropping the row would make a healthy scratch and an
    // unmatched player look identical.
    const { file } = reduce(csv('2025,1,REG,Patrick Mahomes,MahoPa00,QB,KC,0,0'));

    expect(file.players['4034'].weeks).toEqual([[1, 0, 0]]);
  });

  it('fails with a readable error when a column is renamed', () => {
    const drifted = [
      'season,week,game_type,player,pfr_player_id,position,team,offense_snaps',
      '2025,1,REG,JaMarr Chase,ChasJa00,WR,CIN,45',
    ].join('\n');

    expect(() => reduce(drifted)).toThrowError(/snap_counts: source is missing column offense_pct/);
  });

  it('fails rather than returning an empty reduction when the source has no rows', () => {
    expect(() => reduce(HEADER)).toThrowError(/snap_counts: source has no data rows/);
  });
});
