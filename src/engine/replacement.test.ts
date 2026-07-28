import { describe, expect, it } from 'vitest';
import {
  applyReplacement,
  leagueShrinkFactor,
  replacementLevels,
  startersByPosition,
} from './replacement';
import { summarizeRoster, type RosterSummary } from './rosterValue';
import type { LineupSlot, Player, PlayerValue, Position, Roster } from '../types';
import { makePlayer, makeRoster, makeSettings, makeValue } from './testFixtures';

/**
 * Ten teams, one QB / two RB / three WR / one TE / one FLEX — the shape of a
 * standard single-QB dynasty league.
 *
 * Values are laid out so each position has a distinct curve:
 *   QB  flat      — QB1 and QB15 are close, which is why you can stream one
 *   RB  cliff     — falls off a shelf right where the workhorses run out
 *   WR  gentle    — deep pool, no shelf
 *   TE  top-heavy — a few enormous ones, then nothing
 */
function league(teams = 10) {
  const slots: LineupSlot[] = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX'];
  const settings = makeSettings(slots, { teamCount: teams });

  const players = new Map<string, Player>();
  const values = new Map<string, PlayerValue>();

  const curve: Record<Position, (rank: number) => number> = {
    QB: (r) => Math.max(0, 5200 - r * 60), // QB1 5140, QB16 4240 — nearly flat
    RB: (r) => (r <= 26 ? 7000 - r * 90 : 900 - r * 5), // shelf after 26
    WR: (r) => Math.max(0, 6400 - r * 95),
    TE: (r) => (r <= 4 ? 6000 - r * 400 : Math.max(0, 1500 - r * 60)),
    K: () => 0,
    DEF: () => 0,
  };

  const pool: Record<Position, string[]> = { QB: [], RB: [], WR: [], TE: [], K: [], DEF: [] };
  for (const position of ['QB', 'RB', 'WR', 'TE'] as Position[]) {
    for (let rank = 1; rank <= 60; rank++) {
      const id = `${position}${rank}`;
      players.set(id, makePlayer(id, position, 25));
      values.set(id, makeValue(id, curve[position](rank), position));
      pool[position].push(id);
    }
  }

  // Snake the pool out so every roster is plausible and the starting slots fill.
  const rosters: Roster[] = [];
  for (let t = 0; t < teams; t++) {
    const ids: string[] = [];
    for (const [position, count] of [
      ['QB', 2],
      ['RB', 4],
      ['WR', 5],
      ['TE', 2],
    ] as [Position, number][]) {
      for (let n = 0; n < count; n++) ids.push(pool[position][t + n * teams]);
    }
    rosters.push(makeRoster(t + 1, ids));
  }

  const summaries: RosterSummary[] = rosters.map((r) =>
    summarizeRoster(r, players, values, settings),
  );

  return { values, summaries, teams };
}

describe('startersByPosition', () => {
  it('counts flex usage rather than trusting the slot names', () => {
    const { summaries, teams } = league();
    const counts = startersByPosition(summaries);

    // One dedicated QB and TE slot per team; no flex should leak into them,
    // because RB and WR are worth more at the margin in this curve.
    expect(counts.QB).toBe(teams);
    expect(counts.TE).toBe(teams);
    // Two RB and three WR slots per team, plus the ten flexes split between
    // them — so both must exceed their dedicated allotment.
    expect(counts.RB).toBeGreaterThanOrEqual(2 * teams);
    expect(counts.WR).toBeGreaterThanOrEqual(3 * teams);
    expect((counts.RB ?? 0) + (counts.WR ?? 0)).toBe(5 * teams + teams);
  });
});

describe('replacementLevels', () => {
  it('makes quarterbacks nearly worthless in a shallow single-QB league', () => {
    const { values, summaries } = league();
    const levels = replacementLevels(values, startersByPosition(summaries));
    const adjusted = applyReplacement(values, levels);

    // QB1 is the best quarterback alive and still collapses, because QB11 is
    // almost as good and is sitting there for nothing.
    const qb1 = adjusted.get('QB1')!;
    expect(qb1.marketValue).toBeGreaterThan(5000);
    expect(qb1.value).toBeLessThan(qb1.marketValue * 0.2);
  });

  it('protects workhorse running backs, whose supply runs out at a shelf', () => {
    const { values, summaries } = league();
    const levels = replacementLevels(values, startersByPosition(summaries));
    const adjusted = applyReplacement(values, levels);

    const rb1 = adjusted.get('RB1')!;
    // The replacement back is past the cliff, so an elite RB keeps most of
    // his market value — the opposite of what happens to a quarterback.
    expect(rb1.value).toBeGreaterThan(rb1.marketValue * 0.8);
    expect(rb1.value).toBeGreaterThan(adjusted.get('QB1')!.value);
  });

  it('keeps the elite tight ends and flattens the rest', () => {
    const { values, summaries } = league();
    const levels = replacementLevels(values, startersByPosition(summaries));
    const adjusted = applyReplacement(values, levels);

    // A top-four tight end is a genuine weapon; TE12 is streamable filler.
    expect(adjusted.get('TE1')!.value).toBeGreaterThan(4000);
    expect(adjusted.get('TE12')!.value).toBe(0);
  });

  it('raises quarterbacks again when the league starts two of them', () => {
    const { values, summaries } = league();
    const single = replacementLevels(values, startersByPosition(summaries));

    // Same player pool, but now twenty quarterbacks have to start each week.
    const superflex = replacementLevels(values, {
      ...startersByPosition(summaries),
      QB: 20,
    });

    // Deeper into a flat curve means a lower baseline, so every QB is worth
    // more. Nothing about this is hardcoded — it falls out of the counts.
    expect(superflex.QB!.value).toBeLessThan(single.QB!.value);
  });

  it('never drives a value below zero', () => {
    const { values, summaries } = league();
    const adjusted = applyReplacement(
      values,
      replacementLevels(values, startersByPosition(summaries)),
    );
    for (const value of adjusted.values()) {
      expect(value.value).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('leagueShrinkFactor', () => {
  it('reports how much of the market survives, for pricing picks', () => {
    const { values, summaries } = league();
    const adjusted = applyReplacement(
      values,
      replacementLevels(values, startersByPosition(summaries)),
    );
    const shrink = leagueShrinkFactor(summaries, adjusted);

    expect(shrink).toBeGreaterThan(0);
    expect(shrink).toBeLessThan(1);
  });
});
