import { describe, expect, it } from 'vitest';
import {
  applyReplacement,
  hasWinNowScale,
  leagueShrinkFactor,
  pricedPositions,
  replacementLevels,
  startersByPosition,
  valueLeague,
  type ReplacementLevel,
} from './replacement';
import { summarizeRoster, type RosterSummary } from './rosterValue';
import type { SnapShare } from './snapShare';
import type { LineupSlot, Player, PlayerValue, Position, Roster } from '../types';
import { makePlayer, makeRoster, makeSettings, makeValue } from './testFixtures';
import { formatValue } from '../lib/format';

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

/**
 * Four teams whose every position is packed with exact ties.
 *
 * The hardest case for a total order to survive, and the shape both roster-order
 * tests run on: ranks collapse onto shared values in fours, so ties are
 * everywhere and the id tiebreaker is doing real work.
 */
function tiedPool(age = 25) {
  const settings = makeSettings(
    ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX'],
    { teamCount: 4 },
  );
  const players = new Map<string, Player>();
  const values = new Map<string, PlayerValue>();
  const ids: string[] = [];

  for (const position of ['QB', 'RB', 'WR', 'TE'] as Position[]) {
    for (let rank = 1; rank <= 20; rank++) {
      const id = `${position}${rank}`;
      players.set(id, makePlayer(id, position, age));
      values.set(id, makeValue(id, 4000 - Math.floor((rank - 1) / 4) * 700, position));
      ids.push(id);
    }
  }

  const rosters = [0, 1, 2, 3].map((t) =>
    makeRoster(t + 1, ids.filter((_, i) => i % 4 === t)),
  );

  return { settings, players, values, ids, rosters };
}

/**
 * The same ten teams, but stratified: team 1 holds the best players at every
 * position and team 10 the worst.
 *
 * `league()` deals its pool out in a snake, which makes every roster equally
 * good — useful for asking what the *pool* does, useless for asking what the
 * model does to the gap between a contender and a bottom team. Real leagues are
 * stratified, and the spread between their best and worst roster is the headline
 * number on the rankings page.
 */
function stratified(teams = 10) {
  const slots: LineupSlot[] = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX'];
  const settings = makeSettings(slots, { teamCount: teams });

  const players = new Map<string, Player>();
  const values = new Map<string, PlayerValue>();
  const pool: Record<string, string[]> = { QB: [], RB: [], WR: [], TE: [] };

  // A single decay per position rather than the shelved curves in `league()`:
  // this fixture is about the gap between rosters, and a shelf would put the
  // whole bottom half of the league on one side of it.
  //
  // The rates are calibrated so that dealing in blocks produces a **1.68x**
  // market spread between the best and worst lineup, close to the 1.82x the real
  // 10-team league shows. That matters more than it looks: block-dealing is the
  // most stratified league that can exist, so a steep curve on top of it gives a
  // 7.8x market spread and no model could be judged against it. The question
  // this fixture is built to ask is what an adjustment does to a *realistic*
  // gap, not to an impossible one.
  const curve: Record<string, (rank: number) => number> = {
    QB: (r) => 6000 * 0.985 ** r,
    RB: (r) => 7000 * 0.983 ** r,
    WR: (r) => 6800 * 0.987 ** r,
    TE: (r) => 6000 * 0.98 ** r,
  };

  for (const position of ['QB', 'RB', 'WR', 'TE'] as Position[]) {
    for (let rank = 1; rank <= 60; rank++) {
      const id = `${position}${rank}`;
      players.set(id, makePlayer(id, position, 25));
      values.set(id, makeValue(id, curve[position](rank), position));
      pool[position].push(id);
    }
  }

  // Consecutive blocks, best first: team 1 takes QB1-2, RB1-4, WR1-5, TE1-2.
  const rosters: Roster[] = [];
  for (let t = 0; t < teams; t++) {
    const ids: string[] = [];
    for (const [position, count] of [
      ['QB', 2],
      ['RB', 4],
      ['WR', 5],
      ['TE', 2],
    ] as [Position, number][]) {
      for (let n = 0; n < count; n++) ids.push(pool[position][t * count + n]);
    }
    rosters.push(makeRoster(t + 1, ids));
  }

  return { settings, players, values, rosters };
}

/** Reorderings of the same rosters, from a seeded Fisher-Yates so they repeat. */
function shuffles(rosters: Roster[], trials = 25): Roster[][] {
  let seed = 20260729;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  return Array.from({ length: trials }, () =>
    rosters.map((roster) => {
      const list = [...roster.playerIds];
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      return { ...roster, playerIds: list };
    }),
  );
}

describe('unvalued positions', () => {
  /**
   * A league that starts a kicker and a defence, which is most of them.
   *
   * FantasyCalc publishes values for neither, so both slots fill with a real
   * player carrying no value — the shape that made `startersByPosition` report
   * `K: 9, DEF: 8` on the live league beside its skill counts.
   */
  function withKickers() {
    const settings = makeSettings(['QB', 'RB', 'WR', 'K', 'DEF'], { teamCount: 4 });
    const players = new Map<string, Player>();
    const values = new Map<string, PlayerValue>();
    const rosters: Roster[] = [];

    for (let t = 1; t <= 4; t++) {
      const ids: string[] = [];
      for (const position of ['QB', 'RB', 'WR'] as Position[]) {
        const id = `${position}${t}`;
        players.set(id, makePlayer(id, position, 25));
        values.set(id, makeValue(id, 4000 - t * 300, position));
        ids.push(id);
      }
      // Rostered and startable, but priced by nobody.
      for (const position of ['K', 'DEF'] as Position[]) {
        const id = `${position}${t}`;
        players.set(id, makePlayer(id, position, 25));
        ids.push(id);
      }
      rosters.push(makeRoster(t, ids));
    }

    const summaries = rosters.map((r) => summarizeRoster(r, players, values, settings));
    return { settings, players, values, rosters, summaries };
  }

  it('does not count a starter the source cannot price', () => {
    /**
     * A count is an *index into the sorted value list* — `startersNeeded` of 26
     * means "the 27th best back is the replacement". A starter carrying no
     * value is not in that list, so counting him shifts the index one place
     * deeper and overstates replacement level for everyone at his position.
     *
     * For kickers the count was merely dead: `replacementLevels` iterates the
     * value pool, the pool has no kickers, so `K: 9` could never produce a
     * level. It still read as live data to anything consuming the counts.
     */
    const { summaries } = withKickers();
    const counts = startersByPosition(summaries);

    expect(counts).toEqual({ QB: 4, RB: 4, WR: 4 });
    expect(counts.K).toBeUndefined();
    expect(counts.DEF).toBeUndefined();
  });

  it('leaves the unvalued starter in the lineup, holding his slot', () => {
    // Excluded from the arithmetic, not from the roster. He is a real player
    // who really does fill your kicker slot; the app just cannot price him.
    const { summaries } = withKickers();
    const lineup = summaries[0].lineup;

    expect(lineup.map((s) => s.slot)).toEqual(['QB', 'RB', 'WR', 'K', 'DEF']);
    expect(lineup.every((s) => s.entry !== null)).toBe(true);
    // ...and the headline number says how much of the lineup it covers.
    expect(summaries[0].pricedSlots).toBe(3);
    expect(summaries[0].totalSlots).toBe(5);
  });

  it('reaches a fixed point with unvalued starters in the lineup', () => {
    // The counts feed replacement level, which feeds the values, which decide
    // the lineups the counts are read from. Whatever `valueLeague` returns must
    // still describe its own output once two of five slots contribute nothing.
    const { settings, players, values, rosters } = withKickers();
    const result = valueLeague(rosters, players, values, settings);

    expect(startersByPosition(result.summaries)).toEqual(result.starters);
    expect(result.levels.K).toBeUndefined();
    expect(result.levels.DEF).toBeUndefined();
  });
});

describe('pricedPositions', () => {
  it('separates a position nobody prices from a player nobody ranks', () => {
    /**
     * Both arrive as a missing entry in the same map, and they are different
     * statements. A fringe receiver is worth about nothing and `~0` says so
     * honestly. A starting kicker is worth something every Sunday and nothing
     * in a trade, because dynasty has no market for the position — telling him
     * he is `~0` asserts he is a bad player.
     */
    const values = new Map<string, PlayerValue>([
      ['wr1', makeValue('wr1', 5000, 'WR')],
      ['rb1', makeValue('rb1', 4000, 'RB')],
    ]);

    const priced = pricedPositions(values);

    expect(priced.has('WR')).toBe(true);
    expect(priced.has('RB')).toBe(true);
    // Nobody at either, so neither is priced — and a rostered kicker reads as
    // "no market" rather than as a valuation of him.
    expect(priced.has('K')).toBe(false);
    expect(priced.has('DEF')).toBe(false);
    // Nor is a position the source simply happens not to cover in this format.
    expect(priced.has('QB')).toBe(false);
  });

  it('requires a positive value, not merely an entry', () => {
    // A position present only as zeroes is not priced in any useful sense, and
    // treating it as priced would put its players back on the `~0` reading this
    // exists to separate them from.
    const values = new Map<string, PlayerValue>([
      ['k1', makeValue('k1', 0, 'K')],
      ['wr1', makeValue('wr1', 5000, 'WR')],
    ]);

    expect(pricedPositions(values).has('K')).toBe(false);
    expect(pricedPositions(values).has('WR')).toBe(true);
  });

  it('follows the data rather than a hardcoded list', () => {
    // Read from the pool on purpose. `analysis.SKILL_POSITIONS` already names
    // the dynasty-relevant positions, and docs/DESIGN.md records what happened
    // the last time this codebase held one fact in two places: AGE_CLIFF was
    // defined twice with different numbers. A source that starts publishing
    // kickers is picked up here with no code change.
    const values = new Map<string, PlayerValue>([['k1', makeValue('k1', 120, 'K')]]);

    expect(pricedPositions(values).has('K')).toBe(true);
  });
});

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
  it('makes quarterbacks the cheapest position in a shallow single-QB league', () => {
    const { values, summaries } = league();
    const levels = replacementLevels(values, startersByPosition(summaries));
    const adjusted = applyReplacement(values, levels);

    // QB1 is the best quarterback alive and still loses about half his price,
    // because QB11 is almost as good and is sitting there for nothing.
    const qb1 = adjusted.get('QB1')!;
    expect(qb1.marketValue).toBeGreaterThan(5000);
    expect(qb1.value).toBeLessThan(qb1.marketValue * 0.6);

    // Half, not a twentieth. The old subtraction took him to under 20% of
    // market, and a model that prices the best quarterback in football below a
    // fringe running back is not one anybody will trade against. What has to
    // hold is that he is discounted *hardest* — the ordering across positions,
    // not an absolute number nobody can check.
    expect(qb1.value).toBeGreaterThan(qb1.marketValue * 0.4);

    const retained = (id: string) => {
      const v = adjusted.get(id)!;
      return v.value / v.marketValue;
    };
    for (const rival of ['RB1', 'WR1', 'TE1']) {
      expect(retained('QB1')).toBeLessThan(retained(rival));
    }
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
    const te1 = adjusted.get('TE1')!;
    const te12 = adjusted.get('TE12')!;
    expect(te1.value).toBeGreaterThan(4000);
    expect(te12.value / te12.marketValue).toBeLessThan(te1.value / te1.marketValue);
    // Discounted, not erased. He is unstartable here but still a real asset —
    // a bench tight end is something you can trade, and collapsing him onto a
    // hard zero is what made the model order-dependent in the first place.
    expect(te12.value).toBeGreaterThan(0);
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

  it('preserves market ordering all the way down the pool', () => {
    // The property the hard `max(0, …)` floor broke. Without it, everything
    // below replacement ties, and every consumer that sorts by value — above
    // all `bestLineup` filling a FLEX — falls back on input order.
    const { values, summaries } = league();
    const adjusted = applyReplacement(
      values,
      replacementLevels(values, startersByPosition(summaries)),
    );

    for (const position of ['QB', 'RB', 'WR', 'TE'] as const) {
      const ranked = [...adjusted.values()]
        .filter((v) => v.position === position && v.marketValue > 0)
        .sort((a, b) => b.marketValue - a.marketValue);

      for (let i = 1; i < ranked.length; i++) {
        // Strictly greater, not >=: ties are exactly the failure mode.
        expect(ranked[i - 1].value).toBeGreaterThan(ranked[i].value);
      }
    }
  });

  it('converges on plain subtraction for players far above replacement', () => {
    // The curve is `market - replacement × (market / (market + replacement))`,
    // so the charge approaches a full replacement level as the surplus grows.
    // An elite back is priced at very nearly his true surplus, which is what
    // keeps the change from being a blanket softening of the whole model.
    const { values, summaries } = league();
    const levels = replacementLevels(values, startersByPosition(summaries));
    const adjusted = applyReplacement(values, levels);

    const rb1 = adjusted.get('RB1')!;
    const surplus = rb1.marketValue - levels.RB!.value;
    expect(rb1.value).toBeGreaterThan(surplus);
    expect(rb1.value).toBeLessThan(surplus + levels.RB!.value * 0.15);
  });
});

/**
 * The win-now scale (R8).
 *
 * Every other fixture in this file leaves `redraftValue` equal to the dynasty
 * figure, which is the right neutral for tests about something else — and it
 * means none of them can see this change at all. These are the ones that can.
 */
describe('win-now scale', () => {
  /**
   * Replacement levels measured on the live 10-team league, both scales.
   *
   * Used as literal input rather than derived from a synthetic pool so the
   * assertions below are checked against the numbers the app actually runs on.
   */
  const REAL_LEVELS: Partial<Record<Position, ReplacementLevel>> = {
    WR: { position: 'WR', startersNeeded: 31, value: 2044, winNow: 1549 },
    QB: { position: 'QB', startersNeeded: 10, value: 2415, winNow: 1153 },
  };

  /**
   * The four players issue #8 was opened about, at their live values.
   *
   * Two aging starters whose dynasty price is age-suppressed, and two
   * speculative youngsters with no role yet. All four sit within 10% of each
   * other on dynasty market value; their redraft values differ by roughly 8x.
   */
  const conflated = () =>
    new Map<string, PlayerValue>([
      ['evans', makeValue('evans', 1762, 'WR', 1762, 2074)],
      ['adams', makeValue('adams', 1875, 'WR', 1875, 2535)],
      ['hunter', makeValue('hunter', 1691, 'WR', 1691, 239)],
      ['ward', makeValue('ward', 1896, 'QB', 1896, 386)],
    ]);

  it('tells apart the four players the dynasty scale could not', () => {
    const adjusted = applyReplacement(conflated(), REAL_LEVELS);
    const ids = ['evans', 'adams', 'hunter', 'ward'];

    const spread = (of: (v: PlayerValue) => number) => {
      const figures = ids.map((id) => of(adjusted.get(id)!));
      return Math.max(...figures) / Math.min(...figures);
    };

    // Dynasty still cannot separate them, and is not supposed to. Their asset
    // values genuinely are alike — that was never the defect.
    expect(spread((v) => v.value)).toBeLessThan(1.5);

    // Win-now separates them by more than an order of magnitude, which is what
    // an 8x gap in redraft price becomes once replacement is charged against
    // it. Two of these men are startable today and two are not, and before R8
    // nothing downstream could tell.
    expect(spread((v) => v.winNowValue)).toBeGreaterThan(8);

    const winNow = (id: string) => adjusted.get(id)!.winNowValue;
    expect(winNow('adams')).toBeGreaterThan(winNow('evans'));
    expect(winNow('evans')).toBeGreaterThan(winNow('ward'));
    expect(winNow('ward')).toBeGreaterThan(winNow('hunter'));

    // The exact figures the live app produces, to the point. Pinned rather than
    // merely ordered because ordering alone cannot tell which replacement level
    // was charged: swapping in the dynasty level (WR 2,044 instead of 1,549)
    // leaves every comparison above true and quietly reprices Evans at 1,045.
    expect(winNow('evans')).toBeCloseTo(1187, 0);
    expect(winNow('adams')).toBeCloseTo(1574, 0);
    expect(winNow('ward')).toBeCloseTo(97, 0);
    expect(winNow('hunter')).toBeCloseTo(32, 0);
  });

  it('ranks each position twice, because the two scales disagree about who is Nth', () => {
    // Three receivers, and the redraft order is the reverse of the dynasty one.
    // The replacement level at each scale must come from that scale's own
    // ranking; reading the dynasty replacement's redraft value would return a
    // number belonging to neither question.
    const values = new Map<string, PlayerValue>([
      ['young', makeValue('young', 5000, 'WR', 5000, 1000)],
      ['prime', makeValue('prime', 4000, 'WR', 4000, 4000)],
      ['old', makeValue('old', 3000, 'WR', 3000, 6000)],
    ]);

    const levels = replacementLevels(values, { WR: 1 });

    // Second best on each scale: `prime` on dynasty, and `prime` on redraft too
    // — but for a different reason, and the third-place values differ.
    expect(levels.WR!.value).toBe(4000);
    expect(levels.WR!.winNow).toBe(4000);

    // With two starters the answers diverge outright: dynasty's third man is
    // `old` at 3,000, redraft's is `young` at 1,000.
    const deeper = replacementLevels(values, { WR: 2 });
    expect(deeper.WR!.value).toBe(3000);
    expect(deeper.WR!.winNow).toBe(1000);
  });

  it('stays legible all the way down, on both scales', () => {
    /**
     * The assertion R8 shipped without, and the reason it shipped without one.
     *
     * The calibration block above checks spread, plateau and amplification —
     * every one of them a *relative* property, and every one of them passed
     * while a starting tight end rendered as a bare `5` and four receivers
     * rendered as `0`. Nothing looked at whether a number a human reads is
     * still a number that says what the model means.
     *
     * Stated in `formatValue` terms deliberately. The engine's guarantee is
     * that a ranked player is never worth exactly zero; the guarantee that
     * matters to a manager is that the screen never tells him otherwise, and
     * those are only the same guarantee if the formatter is included in it.
     */
    const { values, summaries } = league();
    const spread = new Map<string, PlayerValue>();
    for (const [id, value] of values) {
      // A redraft column shaped like the live one: top-heavy, collapsing to a
      // handful of points well before the pool runs out.
      spread.set(id, {
        ...value,
        redraftValue: Math.round(value.marketValue ** 1.6 / 6000),
      });
    }

    const adjusted = applyReplacement(
      spread,
      replacementLevels(spread, startersByPosition(summaries)),
    );

    let tiny = 0;
    for (const value of adjusted.values()) {
      for (const figure of [value.value, value.winNowValue]) {
        if (figure <= 0) continue;
        expect(formatValue(figure)).not.toBe('0');
        if (figure < 0.5) tiny++;
      }
    }

    // And the fixture has to actually reach that region, or the assertion above
    // is checking nothing. This is the same trap `stratified()` was added for.
    expect(tiny).toBeGreaterThan(0);
  });

  it('leaves the dynasty scale bit-for-bit unchanged', () => {
    // R8 adds a scale; it must not perturb the existing one. `value` is
    // computed from `marketValue` alone and cannot depend on the redraft column
    // however wildly that column moves.
    const { values, summaries } = league();
    const levels = replacementLevels(values, startersByPosition(summaries));
    const before = applyReplacement(values, levels);

    const scrambled = new Map<string, PlayerValue>();
    for (const [id, value] of values) {
      scrambled.set(id, { ...value, redraftValue: (value.marketValue * 7919) % 6000 });
    }
    const after = applyReplacement(
      scrambled,
      replacementLevels(scrambled, startersByPosition(summaries)),
    );

    for (const [id, value] of before) {
      expect(after.get(id)!.value).toBe(value.value);
    }
  });

  it('degrades to the dynasty scale, not to zero, when the redraft column vanishes', () => {
    /**
     * The failure this guard exists for. `redraftValue` is `nullish` in the
     * schema, so a renamed field parses cleanly and arrives as zeroes. Every
     * lineup in the app is built and scored on the win-now scale, so without
     * the guard all ten rosters would rank at nothing, the suggestion engine
     * would empty, and every test here would still pass.
     */
    const { values, summaries } = league();
    const counts = startersByPosition(summaries);
    const intact = applyReplacement(values, replacementLevels(values, counts));

    const stripped = new Map<string, PlayerValue>();
    for (const [id, value] of values) {
      stripped.set(id, { ...value, redraftValue: 0, winNowValue: 0 });
    }
    const degraded = applyReplacement(stripped, replacementLevels(stripped, counts));

    expect(hasWinNowScale(values)).toBe(true);
    expect(hasWinNowScale(stripped)).toBe(false);

    let nonZero = 0;
    for (const [id, value] of degraded) {
      // The pre-R8 model exactly: win-now mirrors dynasty rather than zeroing.
      expect(value.winNowValue).toBe(value.value);
      expect(value.value).toBe(intact.get(id)!.value);
      if (value.winNowValue > 0) nonZero++;
    }
    expect(nonZero).toBeGreaterThan(0);
  });

  it('does not mistake a half-covered redraft column for a missing one', () => {
    // FantasyCalc ranks about the top 200 players on redraft against roughly
    // 400 priced on dynasty — measured at QB 42%, RB 59%, WR 49%, TE 45%. Half
    // the pool carrying no redraft value is the healthy state, not a fault: a
    // 10-team league fields 80 skill starters, so a player outside the top 200
    // really is worth nothing this season.
    const { values } = league();
    const sparse = new Map<string, PlayerValue>();
    let n = 0;
    for (const [id, value] of values) {
      sparse.set(id, n++ % 2 === 0 ? value : { ...value, redraftValue: 0 });
    }

    expect(hasWinNowScale(sparse)).toBe(true);
  });

  it('charges the same curve on both scales, so win-now cannot shear either', () => {
    // The property `calibration` pins for dynasty, asserted for the new scale:
    // two players at one position can never come out further apart than the
    // *square* of their redraft ratio. Straight subtraction has no such bound,
    // and this is the scale it would have been most tempting to use it on,
    // since a redraft value looks more like projected points than a dynasty
    // price does. It is still a price.
    const { values, summaries } = league();
    const spread = new Map<string, PlayerValue>();
    for (const [id, value] of values) {
      // Give the redraft column a shape of its own, so this is not merely the
      // dynasty assertion wearing a different name.
      spread.set(id, { ...value, redraftValue: Math.round(value.marketValue * 0.7 + 400) });
    }

    const adjusted = applyReplacement(
      spread,
      replacementLevels(spread, startersByPosition(summaries)),
    );

    for (const position of ['QB', 'RB', 'WR', 'TE'] as const) {
      const ranked = [...adjusted.values()]
        .filter((v) => v.position === position && v.redraftValue > 0 && v.winNowValue > 0)
        .sort((a, b) => b.redraftValue - a.redraftValue);

      for (let i = 1; i < ranked.length; i++) {
        const better = ranked[i - 1];
        const worse = ranked[i];
        expect(better.winNowValue).toBeGreaterThanOrEqual(worse.winNowValue);
        expect(better.winNowValue / worse.winNowValue).toBeLessThanOrEqual(
          (better.redraftValue / worse.redraftValue) ** 2 + 1e-9,
        );
      }
    }
  });
});

/**
 * League-wide invariants on the shape of the output.
 *
 * Every other test in this file checks one function against one input. None of
 * them could fail when the model broke, because nothing was locally wrong — the
 * clamp returned exactly what it promised, the floor kept the tail ordered, and
 * 296 tests passed while the median rostered player was priced at a flat tenth
 * of his market value and the league's best roster read 3.93x its worst against
 * a market spread of 1.82x.
 *
 * These are the assertions that would have caught it: properties of the whole
 * distribution, stated in the terms a dynasty manager would notice them going
 * wrong in.
 */
describe('calibration', () => {
  const adjust = () => {
    const { values, summaries, teams } = league();
    const levels = replacementLevels(values, startersByPosition(summaries));
    return { adjusted: applyReplacement(values, levels), values, summaries, teams };
  };

  it('never spreads two players further apart than the square of their market gap', () => {
    /**
     * The bound that fails loudly on shearing.
     *
     * For `m²/(m+r)` the ratio between two players at a position is
     * `(m₁/m₂)² × (m₂+r)/(m₁+r)`, and the second term is below 1 whenever
     * m₁ > m₂ — so the squared market ratio is a ceiling the curve cannot reach.
     * Subtraction has no ceiling at all: on the real league Gibbs and Swift sat
     * 4.4x apart on market and 34x apart after adjustment, against a bound of
     * 19.7x. That is the number a manager sees and refuses to believe, and this
     * is the assertion that catches it before he does.
     */
    const { adjusted } = adjust();

    for (const position of ['QB', 'RB', 'WR', 'TE'] as const) {
      const ranked = [...adjusted.values()]
        .filter((v) => v.position === position && v.marketValue > 0)
        .sort((a, b) => b.marketValue - a.marketValue);

      for (let i = 0; i < ranked.length; i++) {
        for (let j = i + 1; j < ranked.length; j++) {
          const marketRatio = ranked[i].marketValue / ranked[j].marketValue;
          const valueRatio = ranked[i].value / ranked[j].value;
          expect(valueRatio).toBeLessThanOrEqual(marketRatio ** 2);
        }
      }
    }
  });

  it('leaves no plateau at the bottom of the pool', () => {
    /**
     * The clamp put 55% of rostered players on one number; the residual floor
     * that replaced it put 59% on one *line*, retaining exactly 0.100 of market
     * apiece. Both are the same failure — a region where league value carries no
     * information that market value did not already carry — and only the first
     * is visible as a tie.
     *
     * So the test is on retained share, not on value: no large block of the pool
     * may share a single retention figure.
     */
    const { adjusted } = adjust();

    const pool = [...adjusted.values()].filter((v) => v.marketValue > 0);
    const retained = pool.map((v) => v.value / v.marketValue);
    const floor = Math.min(...retained);
    const onFloor = retained.filter((share) => share <= floor * 1.01).length;

    expect(onFloor / pool.length).toBeLessThan(0.1);
  });

  it('retains more of the market for better players, everywhere in the pool', () => {
    // Monotone retention is what "no plateau" means pointwise, and it is the
    // property that makes the model explicable: a better player is always worth
    // a larger *share* of his price, not merely a larger number.
    const { adjusted } = adjust();

    for (const position of ['QB', 'RB', 'WR', 'TE'] as const) {
      const ranked = [...adjusted.values()]
        .filter((v) => v.position === position && v.marketValue > 0)
        .sort((a, b) => b.marketValue - a.marketValue);

      for (let i = 1; i < ranked.length; i++) {
        expect(ranked[i - 1].value / ranked[i - 1].marketValue).toBeGreaterThan(
          ranked[i].value / ranked[i].marketValue,
        );
      }
    }
  });

  it('does not inflate the gap between the best and worst roster', () => {
    /**
     * Subtracting a per-position constant from every starter shifts all ten
     * lineups by roughly the same amount, and a shift is not a scale: the real
     * league's 37,110-to-20,490 (1.82x) became 21,992-to-5,599 (3.93x) purely
     * because ~15,000 came off both. The rankings render that ratio as a bar
     * width, so the arithmetic artifact is the thing the user actually sees.
     *
     * This needs the *unequal* fixture. `league()` snakes its pool out so every
     * roster is near-identical by construction, and a spread of 1.0 stays 1.0
     * under any shift whatsoever — the test would pass against the very model
     * it exists to reject. A stratified league is the case that separates them,
     * and it is also the shape of every real one.
     */
    const { settings, players, values, rosters } = stratified();

    const spread = (vals: Map<string, PlayerValue>) => {
      const totals = rosters.map(
        (r) => summarizeRoster(r, players, vals, settings).starterValue,
      );
      return Math.max(...totals) / Math.min(...totals);
    };

    const summaries = rosters.map((r) => summarizeRoster(r, players, values, settings));
    const adjusted = applyReplacement(
      values,
      replacementLevels(values, startersByPosition(summaries)),
    );

    expect(spread(values)).toBeGreaterThan(1.5);
    expect(spread(adjusted)).toBeLessThan(spread(values) * 1.6);
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

describe('degenerate leagues', () => {
  it('leaves values alone when nobody is starting anywhere', () => {
    // A brand-new league before its startup draft: rosters exist, nobody is on
    // them. Indexing the sorted list at 0 here would make the best player at
    // each position his own replacement and render every roster as worth zero.
    const settings = makeSettings(['QB', 'RB', 'WR'], { teamCount: 2 });
    const values = new Map([
      ['a', makeValue('a', 9000, 'QB')],
      ['b', makeValue('b', 8000, 'RB')],
    ]);
    const empty = [
      summarizeRoster(makeRoster(1, []), new Map(), values, settings),
      summarizeRoster(makeRoster(2, []), new Map(), values, settings),
    ];

    const adjusted = applyReplacement(
      values,
      replacementLevels(values, startersByPosition(empty)),
    );

    expect(adjusted.get('a')!.value).toBe(9000);
    expect(adjusted.get('b')!.value).toBe(8000);
  });

  it('fails closed on a player the feed could not classify', () => {
    // FantasyCalc's position is nullable. Charging such a player nothing would
    // leave him at full market value while everyone else is docked, floating
    // him to the top of lineups and into the surplus list.
    const values = new Map([
      ['known', makeValue('known', 9000, 'RB')],
      ['mystery', makeValue('mystery', 9000, null)],
    ]);
    const levels = replacementLevels(values, { RB: 1 });
    const adjusted = applyReplacement(values, levels);

    expect(adjusted.get('mystery')!.value).toBeLessThanOrEqual(
      adjusted.get('known')!.value,
    );
  });
});

describe('valueLeague', () => {
  /**
   * A pool with no fixed point. The flex flips to the receiver once
   * replacement is subtracted, which empties the running back count, which
   * drops the back's replacement level to zero and wins the slot straight back.
   */
  function oscillating() {
    const settings = makeSettings(['FLEX'], { teamCount: 1 });
    const players = new Map<string, Player>();
    const values = new Map<string, PlayerValue>();

    const add = (id: string, position: Position, value: number) => {
      players.set(id, makePlayer(id, position, 25));
      values.set(id, makeValue(id, value, position));
    };

    add('rb_star', 'RB', 3000);
    add('wr_star', 'WR', 2800);
    for (let i = 0; i < 5; i++) add(`rb${i}`, 'RB', 2500);
    for (let i = 0; i < 5; i++) add(`wr${i}`, 'WR', 500);

    return { rosters: [makeRoster(1, ['rb_star', 'wr_star'])], players, values, settings };
  }

  it('returns starter counts that describe its own output', () => {
    // The invariant that matters: the counts setting replacement level must be
    // the counts the resulting lineups actually produce. Deriving them from a
    // market-value pass and never revisiting breaks exactly this.
    const { values, summaries } = league();
    const players = new Map<string, Player>();
    for (const summary of summaries) {
      for (const entry of summary.players) players.set(entry.player.id, entry.player);
    }
    const rosters = summaries.map((s) =>
      makeRoster(s.rosterId, s.players.map((p) => p.player.id)),
    );

    const result = valueLeague(
      rosters,
      players,
      values,
      makeSettings(['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX'], { teamCount: 10 }),
    );

    expect(startersByPosition(result.summaries)).toEqual(result.starters);
  });

  it('terminates deterministically when no fixed point exists', () => {
    const { rosters, players, values, settings } = oscillating();

    const first = valueLeague(rosters, players, values, settings);
    const second = valueLeague(rosters, players, values, settings);

    // Must not depend on which parity the loop happened to stop at.
    expect(first.starters).toEqual(second.starters);
    expect(first.values.get('rb_star')!.value).toBe(second.values.get('rb_star')!.value);

    // A different pass cap must not change the answer either.
    const capped = valueLeague(rosters, players, values, settings, undefined, null, 2);
    expect(capped.starters).toEqual(first.starters);
  });

  it('does not depend on the order the platform lists a roster in', () => {
    /**
     * The regression this whole change exists for.
     *
     * `roster.playerIds` order carries no information — Sleeper returns it in
     * whatever order it likes. When the bottom of the pool was clamped flat, the
     * FLEX slot went to whichever tied player happened to be listed first; that
     * arbitrary pick became the starter counts, the counts set replacement
     * level, and replacement level decided who got clamped. On a real 10-team
     * league, reshuffling player lists moved RB replacement level between 1,900
     * and 2,709 and flipped individual players between 0 and 807.
     */
    const { settings, players, values, ids, rosters } = tiedPool();
    const baseline = valueLeague(rosters, players, values, settings);

    for (const shuffled of shuffles(rosters)) {
      const result = valueLeague(shuffled, players, values, settings);

      expect(result.starters).toEqual(baseline.starters);
      expect(result.levels).toEqual(baseline.levels);
      expect(result.shrink).toBe(baseline.shrink);
      for (const id of ids) {
        expect(result.values.get(id)!.value).toBe(baseline.values.get(id)!.value);
      }
    }
  });

  it('does not depend on roster order once activity has moved the values', () => {
    /**
     * The same property, with the R6 multiplier switched on — and the reason
     * the factors are computed once, outside the pass loop.
     *
     * An activity factor perturbs a value, values decide the FLEX slot, the
     * slot sets the starter counts, and the counts set replacement level. That
     * is precisely the feedback path the clamp bug ran on. What keeps it safe
     * is that a factor reads one player and his own weekly row and nothing
     * else, so it can perturb the loop but never answer back to it. This pins
     * that as a property instead of trusting the argument.
     */
    // Thirty-year-olds, where the age weight is 1 and the multiplier is
    // trusted furthest — a player whose price is very nearly a statement about
    // his current role is exactly the one whose changing role should move it.
    const { settings, players, values, ids, rosters } = tiedPool(30);

    // Backs surging while the tight ends collapse — opposite directions, so
    // the pool is pulled apart rather than scaled by one constant, which is
    // the case that could not disturb an ordering even in principle. The
    // per-player term on top keeps it from being a single constant per
    // position either, so ties break unevenly.
    //
    // The counts themselves do not move here, and cannot: with two RB slots
    // against one TE, a team's third back is always deeper than its second
    // tight end, so the FLEX belongs to a tight end by a margin no bounded
    // multiplier can close. What this pool exercises is the ordering under
    // perturbed values; `starters` and `levels` are asserted below as the
    // things that must stay put.
    const snaps = new Map<string, SnapShare>();
    ids.forEach((id, i) => {
      if (i % 3 === 0) return;
      const bias = id.startsWith('RB') ? 0.3 : id.startsWith('TE') ? -0.3 : 0;
      const delta = bias + ((i % 5) - 2) * 0.02;
      const prior = 0.45;
      snaps.set(id, {
        season: prior + delta / 3,
        recent: prior + delta,
        prior,
        delta,
        games: 12,
        recentGames: 9,
        priorGames: 3,
      });
    });

    const activity = { snaps, usage: new Map(), current: true };
    const baseline = valueLeague(rosters, players, values, settings, activity);
    const inert = valueLeague(rosters, players, values, settings);

    // The factors have to actually reach the values, or everything below is
    // the previous test wearing a different name.
    expect(baseline.adjustments.size).toBeGreaterThan(0);
    expect(
      ids.some((id) => baseline.values.get(id)!.value !== inert.values.get(id)!.value),
    ).toBe(true);
    // A third of the pool is deliberately left without activity, so it keeps
    // the exact tier ties while the rest move off them. That mixture — some
    // values still tied, some nudged just past each other — is the state the
    // tiebreaker has to survive.
    expect(ids.some((id) => !baseline.adjustments.has(id))).toBe(true);

    for (const shuffled of shuffles(rosters)) {
      const result = valueLeague(shuffled, players, values, settings, activity);

      expect(result.starters).toEqual(baseline.starters);
      expect(result.levels).toEqual(baseline.levels);
      expect(result.shrink).toBe(baseline.shrink);
      // The factors themselves must not have noticed the reordering. This is
      // the invariant the whole design rests on: a factor reads one player and
      // his own weekly row, so nothing about the league — not the lineups it
      // perturbs, not the pass it is read on — can feed back into it.
      expect(result.adjustments).toEqual(baseline.adjustments);
      for (const id of ids) {
        expect(result.values.get(id)!.value).toBe(baseline.values.get(id)!.value);
      }
    }

    // Same reason, along the other axis: more passes cannot move a factor, so
    // capping the loop must not change the answer either.
    const capped = valueLeague(rosters, players, values, settings, activity, null, 2);
    expect(capped.adjustments).toEqual(baseline.adjustments);
    expect(capped.starters).toEqual(baseline.starters);
  });

  it('reports scarcity pointing the same way as value', () => {
    const { values, summaries } = league();
    const rosters = summaries.map((s) => makeRoster(s.rosterId, s.players.map((p) => p.player.id)));
    const players = new Map<string, Player>();
    for (const summary of summaries) {
      for (const entry of summary.players) players.set(entry.player.id, entry.player);
    }

    const result = valueLeague(
      rosters,
      players,
      values,
      makeSettings(['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX'], { teamCount: 10 }),
    );

    // Running backs are scarce here and quarterbacks are not, so retained share
    // must rank them that way. Replacement level alone ranks them backwards,
    // which is what made the old UI panel teach the opposite of the truth.
    expect(result.scarcity.RB!.retained).toBeGreaterThan(result.scarcity.QB!.retained);
    expect(result.levels.QB!.value).toBeGreaterThan(result.levels.RB!.value);
  });
});
