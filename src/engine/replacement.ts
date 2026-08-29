import type { LeagueSettings, Player, PlayerValue, Position, Roster } from '../types';
import { summarizeRoster, type RosterSummary } from './rosterValue';
import { activityFactor, type ActivityAdjustment } from './activityFactor';
import type { SnapShare } from './snapShare';
import type { Opportunity } from './opportunity';
import {
  NO_PREMIUM,
  premiumFor,
  scoringPremium,
  type ScoringPremium,
} from './scoringPremium';
import type { ScoringFile } from '../data/types';

/**
 * Replacement level: what a position is actually worth in *this* league.
 *
 * Market values price a player against the whole dynasty world. They cannot
 * know that in a 10-team single-QB league every manager already starts a top-10
 * quarterback, so the realistic cost of losing yours is the gap to QB11 — who
 * is nearly as good, and who you can stream on matchup. The same league makes a
 * workhorse running back precious, because roughly 26 of them start each week
 * and the supply of true 15-20 touch backs runs out at about 32.
 *
 * So a player is worth what he adds *over the best player who starts nowhere*:
 *
 *     leagueValue = marketValue² / (marketValue + replacement)
 *
 * Nothing here is hand-tuned per position. The starter counts come from the
 * lineups the league actually fields, so the same code says quarterbacks matter
 * enormously in superflex — twenty of them have to start — and barely at all in
 * a shallow single-QB league. Change the roster settings and the weighting
 * follows on its own.
 */

export type StarterCounts = Partial<Record<Position, number>>;

export interface ReplacementLevel {
  position: Position;
  /** How many players at this position hold a starting slot league-wide. */
  startersNeeded: number;
  /** Dynasty market value of the best player at the position who starts nowhere. */
  value: number;
  /**
   * The same rank read off the redraft column — and usually a different player.
   *
   * "The best quarterback nobody has to start" has two answers, because the two
   * scales do not order the position the same way. The dynasty answer is
   * whoever the market thinks will be worth the most over the coming years; the
   * win-now answer is whoever will score the most points this season. On the
   * real league those diverge hard at the top of every position — Christian
   * McCaffrey is worth 4,136 on dynasty and 7,175 on redraft at 30, and Jaxson
   * Dart 2,469 against 877 at 23 — so taking the dynasty replacement's *own*
   * redraft value would be a third number belonging to neither question.
   */
  winNow: number;
}

/**
 * How many of each position the league actually starts.
 *
 * Counted from the best lineups rather than from `roster_positions`, because
 * only the real lineups reveal how the flex breaks down. A FLEX slot is
 * nominally RB/WR/TE; in practice it is filled by whoever is best, and that
 * split is what sets the true scarcity of each position.
 *
 * Only starters the value source actually prices are counted, and the reason is
 * arithmetic rather than tidiness. A count is an *index into the sorted value
 * list*: `startersNeeded` of 26 means "the 27th best running back is the
 * replacement". A starter carrying no value is not in that list at all, so
 * counting him shifts the index one place deeper and overstates the replacement
 * level for everyone at his position.
 *
 * Kickers and defences are the standing case. FantasyCalc publishes no values
 * for either, so a league starting both — as most do — was reporting `K: 9,
 * DEF: 8` alongside its skill positions. Those counts could never produce a
 * replacement level, because `replacementLevels` iterates the value pool and
 * the pool has no kickers in it, so they were dead data that read as live. The
 * same rule also catches a genuine skill starter too fringe for the source to
 * rank, where the index shift is not harmless at all.
 */
export function startersByPosition(summaries: RosterSummary[]): StarterCounts {
  const counts: StarterCounts = {};
  for (const summary of summaries) {
    for (const slot of summary.lineup) {
      if (!slot.entry?.valued) continue;
      const position = slot.entry.player.position;
      if (!position) continue;
      counts[position] = (counts[position] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * Positions the value source prices at all.
 *
 * The distinction the roster UI needs, and one it cannot draw from a player's
 * own value: **"nobody publishes a price for this position"** is a different
 * statement from **"this player is too marginal to rank"**, and both arrive as
 * a missing entry in the same map.
 *
 * A fringe receiver really is worth about nothing, and `~0` says so honestly.
 * A starting kicker is not worth about nothing — he is worth something every
 * Sunday and nothing in a trade, because dynasty has no market for the
 * position. Showing him the same `~0` asserts he is a bad player, which is both
 * wrong and the specific thing that made the roster list look broken.
 *
 * Derived from the pool rather than hardcoded to `['K', 'DEF']` on purpose.
 * There is already one list of dynasty-relevant positions in `analysis.ts`, and
 * `docs/DESIGN.md` records what happened the last time this codebase kept the
 * same fact in two places — `AGE_CLIFF` was defined twice with different
 * numbers, so a 27-year-old back was past the cliff on one page and not on
 * another. Reading it from the data also means a source that starts publishing
 * kicker or IDP values is picked up with no code change.
 *
 * Requires a *positive* value, not merely an entry: a position present only as
 * zeroes is not priced in any useful sense.
 */
export function pricedPositions(values: Map<string, PlayerValue>): Set<Position> {
  const priced = new Set<Position>();
  for (const value of values.values()) {
    if (value.position && value.marketValue > 0) priced.add(value.position);
  }
  return priced;
}

/**
 * The replacement player at each position: the best one nobody has to start.
 *
 * Drawn from the whole valued universe rather than only rostered players. A
 * streamable quarterback is streamable precisely because he might be sitting on
 * waivers, and pretending the pool ends at the last rostered player would
 * overstate every position in a shallow league.
 *
 * Computed twice, once per scale, from the *same* starter counts. The counts
 * are a fact about the league's lineup — how many quarterbacks have to start
 * somewhere on a Sunday — and that number does not change because you are
 * asking about a different horizon. What changes is who the Nth best man is.
 */
export function replacementLevels(
  values: Map<string, PlayerValue>,
  starters: StarterCounts,
  /**
   * Positional correction for the league's own scoring.
   *
   * Applied here as well as in `applyReplacement` so the two stay in the same
   * units. A replacement level read off uncorrected prices and then subtracted
   * from corrected ones would charge every position the wrong rent — and by
   * exactly the amount this whole feature exists to find.
   */
  premium: ScoringPremium = NO_PREMIUM,
): Partial<Record<Position, ReplacementLevel>> {
  const byPosition = new Map<Position, { market: number[]; redraft: number[] }>();
  for (const value of values.values()) {
    if (!value.position) continue;
    const lists = byPosition.get(value.position) ?? { market: [], redraft: [] };
    const scale = premiumFor(premium, value.position);
    lists.market.push(value.marketValue * scale);
    lists.redraft.push(value.redraftValue * scale);
    byPosition.set(value.position, lists);
  }

  const levels: Partial<Record<Position, ReplacementLevel>> = {};
  for (const [position, lists] of byPosition) {
    const startersNeeded = starters[position] ?? 0;

    // Nobody starting the position means we have no evidence about it — an
    // empty or pre-draft league produces exactly this. Taking element [0] here
    // would make the best player at the position the replacement level and zero
    // out every player in the league, so fail open and leave values untouched.
    if (startersNeeded <= 0) {
      levels[position] = { position, startersNeeded: 0, value: 0, winNow: 0 };
      continue;
    }

    // Zero-indexed, so element [startersNeeded] is the first player past the
    // last starting job — exactly the man you would pick up instead. Each list
    // is sorted on its own terms, because the two scales rank the position
    // differently and the whole point is to let them.
    const nth = (list: number[]): number => {
      list.sort((a, b) => b - a);
      return list[startersNeeded] ?? list.at(-1) ?? 0;
    };

    levels[position] = {
      position,
      startersNeeded,
      value: nth(lists.market),
      winNow: nth(lists.redraft),
    };
  }

  return levels;
}

/**
 * One player's league value. The model, in one line.
 *
 * Read it as the surplus idea it is, because that is what it is:
 *
 *     market² / (market + replacement)  ===  market - replacement * (market / (market + replacement))
 *
 * You are charged the replacement cost *scaled by how far clear of it you are*.
 * Far above replacement the scale approaches 1 and this is `market -
 * replacement`, exactly the old model. Near replacement the scale falls away, so
 * the charge shrinks with the surplus it is subtracted from and can never
 * overtake it.
 *
 * That last property is the whole reason for the change. Straight subtraction is
 * a VORP operation, and VORP is defined on *projected points* — a scale where
 * "one replacement level" is a real quantity you can take away. A dynasty
 * market value is a **price**, already convex in quality and already carrying
 * scarcity, and subtracting a constant from a price does not deflate it, it
 * shears it. Three symptoms, all measured on a real 10-team league:
 *
 * 1. **The bottom flattened onto the floor.** 94 of 158 rostered players — 59% —
 *    landed on `market * 0.1`, which meant the 10th, 25th and 50th percentiles
 *    of retained value were all exactly 0.100. The median rostered player was
 *    priced by nothing but a tenth of his market value.
 * 2. **Ratios stopped meaning anything.** Jahmyr Gibbs and D'Andre Swift are
 *    4.4x apart on market and came out **34x** apart here. A starting NFL back
 *    who finished RB15 in PPR was worth 230 against Gibbs' 7,846.
 * 3. **Roster rankings inflated.** Every lineup lost roughly eight starters ×
 *    two thousand, so the league's best and worst rosters went from 1.82x apart
 *    on market to 3.93x apart — an artifact of shifting all ten teams by the
 *    same constant, rendered as a proportional bar.
 *
 * The `max(market * 0.1, …)` floor that used to sit here was a patch for the
 * first symptom and the direct cause of the second. It kept the tail ordered,
 * but only by stapling it to a line with a tenth of the slope, so the derivative
 * jumped from 1.0 to 0.1 at the crossover and everything below it was ranked by
 * market value alone. This function needs no floor: it is strictly increasing
 * and strictly positive for any positive market value, so the ordering the floor
 * existed to protect is a property of the curve rather than a repair to it.
 *
 * Bounds, all of which the tests pin:
 *   - `leagueValue(0, r) === 0`, and `leagueValue(m, 0) === m` — a position
 *     nobody starts is left alone, which is what `replacementLevels` relies on.
 *   - Strictly increasing in `market`, strictly decreasing in `replacement`.
 *   - Amplification is bounded: two players at one position can never come out
 *     further apart than the *square* of their market ratio. Straight
 *     subtraction has no such bound, which is exactly how 4.4x became 34x.
 *
 * Deliberately not rounded. `formatValue` rounds for display, which is where
 * rounding belongs; rounding here would put adjacent players back onto identical
 * values and hand `bestLineup` a tie to break on input order.
 */
export const leagueValue = (market: number, replacement: number): number =>
  market > 0 ? (market * market) / (market + replacement) : 0;

/**
 * Share of the priced pool that must carry a redraft value for the win-now
 * scale to be considered published at all.
 *
 * Measured on the live feed: FantasyCalc prices about 400 players at each
 * position group on dynasty and ranks almost exactly half of them on redraft —
 * 199 of 398, and by position QB 42%, RB 59%, WR 49%, TE 45%. That is not a
 * gap. A 10-team league fields 80 skill starters, so a player outside the top
 * 200 on redraft genuinely is worth nothing this season, and a zero is the
 * correct answer rather than a missing one.
 *
 * The gate therefore sits far below the healthy figure, because it is not
 * checking for completeness. It is checking for the column having *vanished* —
 * a renamed field or a schema change reads as 0%, and since `redraftValue` is
 * `nullish` in the schema it would parse cleanly and silently price every
 * lineup in the app at zero. See `applyReplacement`.
 */
export const MIN_REDRAFT_COVERAGE = 0.2;

/**
 * Whether the value source published a usable win-now column.
 *
 * Counts only players it could publish one for: entries carrying a position and
 * a dynasty price. FantasyCalc's draft-pick pseudo-players have neither and
 * would otherwise drag the share down by a third for no reason.
 */
export function hasWinNowScale(values: Map<string, PlayerValue>): boolean {
  let priced = 0;
  let withRedraft = 0;
  for (const value of values.values()) {
    if (!value.position || value.marketValue <= 0) continue;
    priced++;
    if (value.redraftValue > 0) withRedraft++;
  }
  return priced > 0 && withRedraft / priced >= MIN_REDRAFT_COVERAGE;
}

/**
 * Rebuild a value map in league-adjusted terms, on both scales.
 *
 * `marketValue` and `redraftValue` are preserved untouched so the UI can still
 * show the number the other manager will quote, and so trade fairness stays
 * arguable in the terms everyone else uses.
 *
 * The two scales run through the *same* curve with different inputs. That is
 * deliberate and not merely tidy: a redraft value is a price for exactly the
 * same reason a dynasty value is one — it is what the market charges for a
 * season of a player, not a projection of his points — so subtracting a flat
 * replacement level from it would shear it in precisely the way documented at
 * `leagueValue`. One category error is enough.
 */
export function applyReplacement(
  values: Map<string, PlayerValue>,
  levels: Partial<Record<Position, ReplacementLevel>>,
  /**
   * Activity multipliers, already computed per player.
   *
   * Applied on top of the replacement adjustment rather than folded into it,
   * because the two answer different questions: replacement asks what the
   * position costs to fill in this league, activity asks whether this player is
   * currently doing the job. Empty is the neutral case and leaves every value
   * exactly as it was.
   */
  adjustments: Map<string, ActivityAdjustment> = new Map(),
  /** The same positional correction `replacementLevels` was given. */
  premium: ScoringPremium = NO_PREMIUM,
): Map<string, PlayerValue> {
  // An unknown position fails *closed*. Charging nothing would let a player the
  // feed failed to classify keep his full market value while every classified
  // player is docked, floating him to the top of lineups and into the surplus
  // list. FantasyCalc's position is nullable and any unrecognised string maps
  // to null, so this is a feed change away from happening. Both scales need
  // their own strictest level; the harshest dynasty position is not
  // necessarily the harshest win-now one.
  const all = Object.values(levels);
  const strictest = Math.max(0, ...all.map((level) => level.value));
  const strictestWinNow = Math.max(0, ...all.map((level) => level.winNow));

  // Degrade to the pre-R8 model rather than to zero. Every lineup in the app is
  // built and scored on the win-now scale, so a feed that stops publishing one
  // would not produce a slightly worse answer — it would rank all ten rosters
  // at nothing and empty the suggestion engine, while every number still
  // rendered and every test still passed. Mirroring the dynasty scale is a
  // worse model and a working app, which is the right way round.
  const winNowPublished = hasWinNowScale(values);

  const out = new Map<string, PlayerValue>();
  for (const [id, value] of values) {
    const level = value.position ? levels[value.position] : undefined;
    const replacement = level?.value ?? strictest;
    const winNowReplacement = level?.winNow ?? strictestWinNow;
    // One factor, both scales. Activity measures whether a player is currently
    // doing the job, which is a statement about this season *and* evidence
    // about the next few — so applying it to one scale and not the other would
    // make a rising role show up in his asset price and vanish from his lineup
    // contribution, or the reverse.
    const factor = adjustments.get(id)?.factor ?? 1;
    /*
      The market's price, corrected for the rulebook it was quoted under.

      FantasyCalc prices a player for standard scoring at the league's reception
      value and knows nothing else about it, so in a TE-premium league every
      tight end arrives underpriced by the size of the premium. Applied to both
      scales because both are its prices — see `scoringPremium`.

      `marketValue` and `redraftValue` themselves are left untouched below, so
      the number the other manager will quote is still the number on screen.
    */
    const scale = premiumFor(premium, value.position);
    const dynasty = leagueValue(value.marketValue * scale, replacement) * factor;
    out.set(id, {
      ...value,
      value: dynasty,
      winNowValue: winNowPublished
        ? leagueValue(value.redraftValue * scale, winNowReplacement) * factor
        : dynasty,
    });
  }
  return out;
}

/**
 * How much of the league's market value survives the replacement adjustment.
 *
 * Draft picks are priced on the market scale, and comparing a market-priced
 * pick against a replacement-adjusted player would reintroduce exactly the
 * cross-scale mixing the design forbids. Scaling picks by the league's own
 * shrink factor keeps both in the same units. It is an approximation — a pick
 * is not a uniformly average player — but it is a documented one, and it is far
 * better than comparing two different scales.
 */
export function leagueShrinkFactor(
  summaries: RosterSummary[],
  adjusted: Map<string, PlayerValue>,
): number {
  let market = 0;
  let league = 0;
  for (const summary of summaries) {
    for (const slot of summary.lineup) {
      const id = slot.entry?.player.id;
      if (!id) continue;
      const value = adjusted.get(id);
      if (!value) continue;
      market += value.marketValue;
      league += value.value;
    }
  }
  return market > 0 ? league / market : 1;
}

export interface PositionScarcity extends ReplacementLevel {
  /** Market value of the best player at the position. */
  topMarket: number;
  /**
   * Share of that best player's market value that survives replacement, 0-1.
   *
   * This is the number worth showing a human. A *high* replacement level means
   * the position is cheap to replace, which is the opposite of scarce — so
   * plotting replacement level directly reads backwards. Retained share points
   * the right way: elite running backs keep most of their value, elite
   * quarterbacks in a shallow single-QB league keep about half.
   */
  retained: number;
  /** Redraft value of the best player at the position. */
  topRedraft: number;
  /**
   * The same share on the win-now scale.
   *
   * Carried because the panel explains why the app weights positions the way it
   * does, and after R8 there are two weightings. Reporting only the dynasty one
   * left the panel describing a scale the lineup beside it no longer used —
   * "replace for 1,548" against a win-now replacement of 253 for the same
   * position in the same league. That is the same failure the panel was already
   * fixed for once, when it plotted replacement level directly and taught the
   * inverse of the model.
   */
  retainedWinNow: number;
}

export function positionScarcity(
  market: Map<string, PlayerValue>,
  levels: Partial<Record<Position, ReplacementLevel>>,
  /**
   * The same positional correction the levels were computed under.
   *
   * Not optional in spirit, whatever the default says. `level.value` arrives on
   * the corrected scale, so a top-of-position price taken uncorrected would
   * divide two different currencies and hand the explanatory panel a `retained`
   * share that the engine never computes. This panel exists to teach the model
   * the app runs; running a second one here is the specific failure its own
   * comment warns about.
   */
  premium: ScoringPremium = NO_PREMIUM,
): Partial<Record<Position, PositionScarcity>> {
  const top: Partial<Record<Position, number>> = {};
  const topRedraft: Partial<Record<Position, number>> = {};
  for (const value of market.values()) {
    if (!value.position) continue;
    const scale = premiumFor(premium, value.position);
    top[value.position] = Math.max(top[value.position] ?? 0, value.marketValue * scale);
    topRedraft[value.position] = Math.max(
      topRedraft[value.position] ?? 0,
      value.redraftValue * scale,
    );
  }

  const out: Partial<Record<Position, PositionScarcity>> = {};
  for (const level of Object.values(levels)) {
    const market = top[level.position] ?? 0;
    const redraft = topRedraft[level.position] ?? 0;
    out[level.position] = {
      ...level,
      topMarket: market,
      topRedraft: redraft,
      // Through `leagueValue`, not a second copy of the arithmetic — this number
      // is the explanatory panel's whole content, and a panel that teaches a
      // different model than the engine runs is worse than no panel.
      retained: market > 0 ? leagueValue(market, level.value) / market : 0,
      retainedWinNow: redraft > 0 ? leagueValue(redraft, level.winNow) / redraft : 0,
    };
  }
  return out;
}

/**
 * Weekly activity for the whole league, as the valuation consumes it.
 *
 * `current` is false through the offseason, which makes every factor exactly 1
 * and leaves the model as it was before activity existed.
 */
export interface LeagueActivity {
  snaps: Map<string, SnapShare>;
  usage: Map<string, Opportunity>;
  current: boolean;
}

export interface LeagueValuation {
  /** Replacement-adjusted values, for every downstream consumer. */
  values: Map<string, PlayerValue>;
  levels: Partial<Record<Position, ReplacementLevel>>;
  scarcity: Partial<Record<Position, PositionScarcity>>;
  starters: StarterCounts;
  /** Summaries built from the adjusted values, already converged. */
  summaries: RosterSummary[];
  shrink: number;
  /** What activity did to each player, for explaining a value that moved. */
  adjustments: Map<string, ActivityAdjustment>;
  /** How this league's scoring moved each position against the market's. */
  premium: ScoringPremium;
}

const sameCounts = (a: StarterCounts, b: StarterCounts): boolean => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<Position>;
  for (const key of keys) if ((a[key] ?? 0) !== (b[key] ?? 0)) return false;
  return true;
};

/**
 * Value a whole league, iterating until the starter counts settle.
 *
 * The counts and the values define each other: replacement level is derived
 * from who starts, and who starts is decided by the adjusted values. A single
 * pass off market values is not good enough, because replacement subtracts a
 * *different* constant per position — which is exactly the thing that can flip
 * a FLEX slot from one position to another. A back at 3,000 beats a receiver at
 * 2,800 on market, and loses to him once 2,500 and 1,500 are subtracted.
 *
 * On real leagues this reaches a fixed point in two or three passes. It is not
 * guaranteed to: a position that loses its last starter has its replacement
 * level drop to zero, which inflates it, which can win the slot straight back.
 * A cycle means no fixed point exists for this pool, so we fall back to the
 * market pass — the answer is then no better than before, but it is at least
 * deterministic rather than depending on which parity the loop stopped at.
 */
export function valueLeague(
  rosters: Roster[],
  players: Map<string, Player>,
  market: Map<string, PlayerValue>,
  settings: LeagueSettings,
  activity?: LeagueActivity,
  /**
   * Weekly stat lines, so the league's own scoring can correct market prices
   * that were quoted for a different rulebook. Absent leaves every value
   * exactly as it was.
   */
  scoringStats?: ScoringFile | null,
  maxPasses = 5,
): LeagueValuation {
  const summarize = (values: Map<string, PlayerValue>) =>
    rosters.map((roster) => summarizeRoster(roster, players, values, settings));

  /**
   * Computed once, outside the loop, and deliberately so.
   *
   * A factor is a pure function of a player and his own weekly data — it does
   * not read any other player's value, so it cannot vary between passes. That
   * is what keeps it out of the feedback path that the clamp bug ran on: it
   * perturbs the lineups, but it can never respond to the perturbation.
   */
  const adjustments = new Map<string, ActivityAdjustment>();
  if (activity) {
    for (const [id, player] of players) {
      const adjustment = activityFactor(player, {
        snaps: activity.snaps.get(id),
        usage: activity.usage.get(id),
        current: activity.current,
      });
      if (adjustment.factor !== 1) adjustments.set(id, adjustment);
    }
  }

  // Every pass recomputes levels, values and summaries together, so whatever is
  // returned is internally consistent — the counts describe the very lineups
  // the returned values produce.
  /*
    Measured from the starter counts, which are measured from the lineups — so
    the premium has to be recomputed as the counts converge, exactly like the
    levels. It is cheap: a few hundred players scored twice.
  */
  const pass = (counts: StarterCounts) => {
    const premium = scoringStats
      ? scoringPremium(scoringStats, settings.scoring, counts)
      : NO_PREMIUM;
    const levels = replacementLevels(market, counts, premium);
    const values = applyReplacement(market, levels, adjustments, premium);
    const summaries = summarize(values);
    return { levels, values, summaries, starters: counts, premium };
  };

  const baseline = startersByPosition(summarize(market));
  const seen: StarterCounts[] = [baseline];
  let state = pass(baseline);

  for (let n = 0; n < maxPasses; n++) {
    const next = startersByPosition(state.summaries);
    if (sameCounts(next, state.starters)) break;

    if (seen.some((counts) => sameCounts(counts, next))) {
      state = pass(baseline);
      break;
    }

    seen.push(next);
    state = pass(next);
  }

  return {
    ...state,
    scarcity: positionScarcity(market, state.levels, state.premium),
    shrink: leagueShrinkFactor(state.summaries, state.values),
    adjustments,
  };
}
