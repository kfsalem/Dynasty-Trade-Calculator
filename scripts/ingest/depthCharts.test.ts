import { describe, expect, it } from 'vitest';
import { parseCrosswalk } from './crosswalk';
import { reduceDepthCharts } from './depthCharts';

const CROSSWALK = parseCrosswalk(
  [
    'sleeper_id,gsis_id,pfr_id,espn_id,name',
    '4034,00-0033873,MahoPa00,3139477,Patrick Mahomes',
    '1466,00-0030506,KelcTr00,15847,Travis Kelce',
    '9224,00-0039894,WortXa00,4429205,Xavier Worthy',
    // A rookie who has never played an NFL snap: no gsis id, but ESPN has him.
    '13287,NA,LoveJe00,4870808,Jeremiyah Love',
  ].join('\n'),
);

const HEADER = 'dt,team,player_name,espn_id,gsis_id,pos_grp,pos_abb,pos_slot,pos_rank';
const csv = (...rows: string[]) => [HEADER, ...rows].join('\n');

const META = { season: 2026, source: 'test', generatedAt: '2026-07-30T00:00:00.000Z' };
const reduce = (text: string) => reduceDepthCharts(text, CROSSWALK, META);

const OLD = '2026-07-01T00:00:00Z';
const NEW = '2026-07-30T09:27:38Z';

describe('reduceDepthCharts', () => {
  it('keeps only the newest chart, which is the whole reason this file is 53 MB', () => {
    // nflverse appends a full-league chart every few hours and never prunes.
    const { file } = reduce(
      csv(
        `${OLD},KC,Patrick Mahomes,3139477,00-0033873,3WR 1TE,QB,9,2`,
        `${NEW},KC,Patrick Mahomes,3139477,00-0033873,3WR 1TE,QB,9,1`,
      ),
    );

    expect(file.players['4034']).toEqual({ team: 'KC', pos: 'QB', rank: 1 });
    expect(file.asOf).toBe(NEW);
  });

  it('resolves the newest chart per team, so one late team cannot drop the rest', () => {
    const { file } = reduce(
      csv(
        `${OLD},CIN,Travis Kelce,15847,00-0030506,3WR 1TE,TE,10,1`,
        `${NEW},KC,Patrick Mahomes,3139477,00-0033873,3WR 1TE,QB,9,1`,
      ),
    );

    // CIN never republished; its chart is still the one that counts for CIN.
    expect(file.players['1466']).toEqual({ team: 'CIN', pos: 'TE', rank: 1 });
    expect(file.players['4034']).toEqual({ team: 'KC', pos: 'QB', rank: 1 });
  });

  it('discards an older row even when it arrives after a newer one', () => {
    const { file } = reduce(
      csv(
        `${NEW},KC,Patrick Mahomes,3139477,00-0033873,3WR 1TE,QB,9,1`,
        `${OLD},KC,Patrick Mahomes,3139477,00-0033873,3WR 1TE,QB,9,3`,
      ),
    );

    expect(file.players['4034'].rank).toBe(1);
  });

  it('falls back to the ESPN id for a rookie with no gsis id yet', () => {
    const { file, stats } = reduce(
      csv(`${NEW},ND,Jeremiyah Love,4870808,NA,3WR 1TE,RB,11,1`),
    );

    expect(file.players['13287']).toEqual({ team: 'ND', pos: 'RB', rank: 1 });
    expect(stats.unmatched).toEqual([]);
  });

  it('ranks receivers by depth, not by the alignment slot they are listed under', () => {
    // A chart splits receivers across three slots and cycles them, so the WR3
    // sits at slot 8. Reading pos_slot would call him a starter.
    const { file } = reduce(
      csv(
        `${NEW},KC,Xavier Worthy,4429205,00-0039894,3WR 1TE,WR,8,3`,
        `${NEW},KC,Travis Kelce,15847,00-0030506,3WR 1TE,TE,10,1`,
      ),
    );

    expect(file.players['9224'].rank).toBe(3);
    expect(file.players['1466'].rank).toBe(1);
  });

  it('keeps the better spot when a player is listed at two positions', () => {
    const { file, stats } = reduce(
      csv(
        `${NEW},KC,Travis Kelce,15847,00-0030506,3WR 1TE,WR,8,4`,
        `${NEW},KC,Travis Kelce,15847,00-0030506,3WR 1TE,TE,10,1`,
      ),
    );

    expect(file.players['1466']).toEqual({ team: 'KC', pos: 'TE', rank: 1 });
    // One player, counted once. Pittsburgh carried a back at RB4 and WR7 in
    // 2026; tallying listings rather than players would put him in the gate's
    // denominator twice, under two positions.
    expect(stats.all.total).toEqual({ matched: 1, unmatched: 0 });
    expect(stats.all.byPosition.WR).toBeUndefined();
  });

  it('counts a listing with no usable id as unmatched, not as absent', () => {
    const { file, stats } = reduce(
      csv(
        `${NEW},KC,Patrick Mahomes,3139477,00-0033873,3WR 1TE,QB,9,1`,
        `${NEW},KC,No Id At All,NA,NA,3WR 1TE,WR,8,1`,
      ),
    );

    expect(Object.keys(file.players)).toEqual(['4034']);
    expect(stats.relevant.byPosition.WR).toEqual({ matched: 0, unmatched: 1 });
  });

  it('drops linemen, defenders and specialists', () => {
    const { file } = reduce(
      csv(
        `${NEW},KC,Patrick Mahomes,3139477,00-0033873,3WR 1TE,QB,9,1`,
        `${NEW},KC,Creed Humphrey,4035004,00-0036623,3WR 1TE,C,5,1`,
        `${NEW},KC,Josh Sweat,3693166,00-0034381,Base 4-3 D,LDE,11,1`,
        `${NEW},KC,Harrison Butker,2971573,00-0033913,Special Teams,PK,1,1`,
      ),
    );

    expect(Object.keys(file.players)).toEqual(['4034']);
  });

  it('carries no throughWeek, because a chart is a snapshot and not a season', () => {
    const { file } = reduce(csv(`${NEW},KC,Patrick Mahomes,3139477,00-0033873,3WR 1TE,QB,9,1`));

    expect(file.throughWeek).toBeNull();
  });

  it('fails with a readable error when a column is renamed', () => {
    const drifted = [
      'dt,team,player_name,espn_id,gsis_id,pos_grp,pos_abb,pos_slot',
      `${NEW},KC,Patrick Mahomes,3139477,00-0033873,3WR 1TE,QB,9`,
    ].join('\n');

    expect(() => reduce(drifted)).toThrowError(/depth_charts: source is missing column pos_rank/);
  });
});
