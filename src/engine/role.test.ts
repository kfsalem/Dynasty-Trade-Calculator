import { describe, expect, it } from 'vitest';
import type { DepthPlayer } from '../data/types';
import type { SnapShare } from './snapShare';
import { classify, isChartStarter, playerRole, playerRoles } from './role';

const share = (season: number): SnapShare => ({
  season,
  recent: season,
  delta: 0,
  games: 17,
  recentGames: 4,
});

const listing = (pos: string, rank: number): DepthPlayer => ({ team: 'CIN', pos, rank });

describe('classify', () => {
  it('reads most of the snaps as starting', () => {
    expect(classify(0.85)).toBe('starter');
    expect(classify(0.65)).toBe('starter');
  });

  it('reads a rotation as rotational', () => {
    expect(classify(0.64)).toBe('rotational');
    expect(classify(0.25)).toBe('rotational');
  });

  it('reads a sliver of the snaps as a backup', () => {
    expect(classify(0.24)).toBe('backup');
    expect(classify(0.01)).toBe('backup');
  });

  it('separates a man who dressed and never played from one with no data', () => {
    // Both are "inactive" as a role, but only one of them is a real zero, and
    // the share carried alongside keeps them distinguishable.
    expect(classify(0)).toBe('inactive');
    expect(classify(null)).toBe('inactive');
  });
});

describe('isChartStarter', () => {
  it('counts three receivers, because that is the base offence', () => {
    // Reading rank 1 alone called every WR2 a backup and produced 41 false
    // disagreements against 2025, most of them receivers playing 71-85% of
    // snaps exactly as intended.
    expect(isChartStarter(listing('WR', 3))).toBe(true);
    expect(isChartStarter(listing('WR', 4))).toBe(false);
  });

  it('counts one quarterback, back and tight end', () => {
    expect(isChartStarter(listing('QB', 1))).toBe(true);
    expect(isChartStarter(listing('QB', 2))).toBe(false);
    expect(isChartStarter(listing('RB', 2))).toBe(false);
    expect(isChartStarter(listing('TE', 2))).toBe(false);
  });

  it('never counts a fullback', () => {
    // A listed FB1 still plays about a fifth of the snaps, so treating him as
    // a published starter flagged half the league's fullbacks every week.
    expect(isChartStarter(listing('FB', 1))).toBe(false);
  });
});

describe('playerRole', () => {
  it('takes the role from the snaps, not from the chart', () => {
    const role = playerRole(share(0.8), listing('WR', 5), true);

    expect(role?.role).toBe('starter');
    expect(role?.chart).toEqual({ pos: 'WR', rank: 5, team: 'CIN', starter: false });
  });

  it('flags a player the chart buries who is playing like a starter', () => {
    // The buy-low case: Atlanta's QB2 took 95% of the snaps in 2025.
    const role = playerRole(share(0.95), listing('QB', 2), true);

    expect(role?.disagreement).toBe('plays-more');
  });

  it('flags a published starter who is barely on the field', () => {
    const role = playerRole(share(0.2), listing('WR', 2), true);

    expect(role?.disagreement).toBe('plays-less');
  });

  it('leaves a published starter playing like one alone', () => {
    expect(playerRole(share(0.85), listing('WR', 1), true)?.disagreement).toBeNull();
  });

  it('leaves a rotational player alone, whatever the chart says', () => {
    // Between the two thresholds nobody is lying: a chart starter on half the
    // snaps and a chart backup on half the snaps are both just rotating.
    expect(playerRole(share(0.5), listing('WR', 1), true)?.disagreement).toBeNull();
    expect(playerRole(share(0.5), listing('WR', 6), true)?.disagreement).toBeNull();
  });

  it('never compares a chart and snaps from different seasons', () => {
    // Through the offseason the chart has advanced to the new season and the
    // snaps are last year's. Every free agent and every rookie would read as a
    // disagreement, which is noise dressed as signal.
    const role = playerRole(share(0.95), listing('QB', 2), false);

    expect(role?.role).toBe('starter');
    expect(role?.chart?.rank).toBe(2);
    expect(role?.disagreement).toBeNull();
  });

  it('describes a rookie with a chart spot and no snaps', () => {
    const role = playerRole(undefined, listing('RB', 1), true);

    expect(role?.role).toBe('inactive');
    expect(role?.share).toBeNull();
    expect(role?.disagreement).toBeNull();
  });

  it('describes a player with snaps who is on no chart', () => {
    const role = playerRole(share(0.7), undefined, true);

    expect(role?.role).toBe('starter');
    expect(role?.chart).toBeNull();
    expect(role?.disagreement).toBeNull();
  });

  it('returns null when there is nothing to say', () => {
    expect(playerRole(undefined, undefined, true)).toBeNull();
  });
});

describe('playerRoles', () => {
  it('covers players known to either source', () => {
    const roles = playerRoles({
      shares: new Map([['7564', share(0.9)]]),
      depth: new Map([['13287', listing('RB', 1)]]),
      comparable: true,
    });

    expect(roles.get('7564')?.role).toBe('starter');
    expect(roles.get('13287')?.role).toBe('inactive');
    expect(roles.size).toBe(2);
  });

  it('suppresses every disagreement when the seasons do not line up', () => {
    const roles = playerRoles({
      shares: new Map([['7564', share(0.95)]]),
      depth: new Map([['7564', listing('QB', 3)]]),
      comparable: false,
    });

    expect(roles.get('7564')?.disagreement).toBeNull();
  });
});
