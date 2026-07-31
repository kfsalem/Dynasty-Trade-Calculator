import { describe, expect, it } from 'vitest';
import {
  OPPORTUNITY_COLUMNS,
  type OpportunityFile,
  type OpportunityPlayer,
  type OpportunityWeek,
} from '../data/types';
import { opportunities, opportunity } from './opportunity';

interface WeekInput {
  week: number;
  targetShare?: number | null;
  airYardsShare?: number | null;
  wopr?: number | null;
  carryShare?: number | null;
}

const week = (w: WeekInput): OpportunityWeek => [
  w.week,
  0,
  w.targetShare ?? null,
  w.airYardsShare ?? null,
  w.wopr ?? null,
  0,
  w.carryShare ?? null,
  0,
  0,
];

const player = (pos: string, ...weeks: WeekInput[]): OpportunityPlayer => ({
  pos,
  team: 'CIN',
  weeks: weeks.map(week),
});

const keys = (pos: string, ...weeks: WeekInput[]) =>
  opportunity(player(pos, ...weeks), 18)?.metrics.map((m) => m.key);

describe('opportunity', () => {
  it('gives receivers target share, air yards share and WOPR', () => {
    expect(
      keys('WR', { week: 1, targetShare: 0.25, airYardsShare: 0.3, wopr: 0.6 }),
    ).toEqual(['targetShare', 'airYardsShare', 'wopr']);
  });

  it('gives tight ends the same receiving metrics', () => {
    expect(keys('TE', { week: 1, targetShare: 0.2, airYardsShare: 0.1, wopr: 0.4 })).toEqual([
      'targetShare',
      'airYardsShare',
      'wopr',
    ]);
  });

  it('never puts air yards share on a running back', () => {
    // Air yards share is a receiving concept. A back with two downfield targets
    // a year would read as a nonentity on a metric that was never about him.
    const metrics = keys('RB', {
      week: 1,
      carryShare: 0.7,
      targetShare: 0.1,
      airYardsShare: 0.02,
      wopr: 0.1,
    });

    expect(metrics).toEqual(['carryShare', 'targetShare']);
    expect(metrics).not.toContain('airYardsShare');
    expect(metrics).not.toContain('wopr');
  });

  it('keeps target share on a back, because receiving backs are the point', () => {
    // Carry share alone misses the PPR value of a back who catches passes,
    // which is exactly the kind of player this is meant to surface.
    const derived = opportunity(player('RB', { week: 1, carryShare: 0.3, targetShare: 0.22 }), 18);

    expect(derived?.headline.key).toBe('carryShare');
    expect(derived?.metrics.map((m) => m.key)).toContain('targetShare');
  });

  it('leads a receiver with target share', () => {
    // The single most predictive of the three, so it is the one that shows
    // when there is room for one number.
    const derived = opportunity(
      player('WR', { week: 1, targetShare: 0.28, airYardsShare: 0.35, wopr: 0.67 }),
      18,
    );

    expect(derived?.headline.key).toBe('targetShare');
  });

  it('has nothing to say about a quarterback', () => {
    // His opportunity is his snap count, which the snap column already shows.
    expect(opportunity(player('QB', { week: 1, targetShare: 0, carryShare: 0.05 }), 18)).toBeNull();
  });

  it('marks WOPR as an index rather than a share', () => {
    // WOPR is 1.5 x target share + 0.7 x air yards share, so it runs past 1.
    // Rendering it as a percentage would invent receivers on 120% of the work.
    const derived = opportunity(
      player('WR', { week: 1, targetShare: 0.4, airYardsShare: 0.5, wopr: 0.95 }),
      18,
    );

    expect(derived?.metrics.find((m) => m.key === 'wopr')?.kind).toBe('index');
    expect(derived?.metrics.find((m) => m.key === 'targetShare')?.kind).toBe('share');
  });

  it('windows each metric season-to-date against the last four weeks', () => {
    const derived = opportunity(
      player(
        'WR',
        { week: 1, targetShare: 0.1, airYardsShare: 0.1, wopr: 0.2 },
        { week: 2, targetShare: 0.1, airYardsShare: 0.1, wopr: 0.2 },
        { week: 17, targetShare: 0.3, airYardsShare: 0.3, wopr: 0.6 },
        { week: 18, targetShare: 0.3, airYardsShare: 0.3, wopr: 0.6 },
      ),
      18,
    );

    const targets = derived?.metrics[0].window;
    expect(targets?.season).toBeCloseTo(0.2);
    expect(targets?.recent).toBeCloseTo(0.3);
    expect(targets?.delta).toBeCloseTo(0.1);
    expect(targets?.games).toBe(4);
    expect(targets?.recentGames).toBe(2);
  });

  it('drops a metric the source never published, rather than showing it as zero', () => {
    // A receiver with no air yards on record is not a receiver with zero air
    // yards, and the tooltip should not claim otherwise.
    const derived = opportunity(
      player('WR', { week: 1, targetShare: 0.25, airYardsShare: null, wopr: null }),
      18,
    );

    expect(derived?.metrics.map((m) => m.key)).toEqual(['targetShare']);
  });

  it('returns null when nothing at the position has any data', () => {
    expect(opportunity(player('WR', { week: 1 }), 18)).toBeNull();
  });

  it('returns null for a position it does not recognise', () => {
    expect(opportunity(player('K', { week: 1, targetShare: 0.1 }), 18)).toBeNull();
  });

  it('reads the tuple columns by name, not by guessed position', () => {
    // The shipped rows are positional tuples; this catches a reordered file.
    expect(OPPORTUNITY_COLUMNS.indexOf('carryShare')).toBe(6);
    expect(OPPORTUNITY_COLUMNS.indexOf('targetShare')).toBe(2);
  });
});

describe('opportunities', () => {
  const file = (players: OpportunityFile['players']): OpportunityFile => ({
    generatedAt: '2026-07-30T00:00:00.000Z',
    season: 2025,
    throughWeek: 18,
    source: 'test',
    columns: OPPORTUNITY_COLUMNS,
    players,
  });

  it('keys by Sleeper id and omits players with nothing to show', () => {
    const derived = opportunities(
      file({
        '7564': player('WR', { week: 18, targetShare: 0.3, airYardsShare: 0.4, wopr: 0.7 }),
        '4034': player('QB', { week: 18, carryShare: 0.05 }),
      }),
    );

    expect(derived.get('7564')?.headline.key).toBe('targetShare');
    expect(derived.has('4034')).toBe(false);
  });
});
