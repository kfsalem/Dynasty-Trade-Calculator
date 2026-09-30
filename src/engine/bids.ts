import { learn, type Learned } from './learned';
import type { TransactionHistory } from '../platforms/types';
import type { LeagueSettings, Position, Roster } from '../types';

/**
 * What a waiver claim costs in this league, learned from what it has cost.
 *
 * ## What was measured, and what was not
 *
 * #76 set out to price a league's *taste* — a multiplier per position, learned
 * from trades and FAAB, applied to what an asset is worth. Measured against
 * both test leagues on 2026-09-10, that does not survive:
 *
 * - **A bid does not track a player's market value.** `spearman(bid, value)` is
 *   -0.036 and +0.055 across the two leagues, and stays inside ±0.09 within
 *   every position in the four-season league. Dollars per unit of value is a
 *   ratio whose denominator carries no information about its numerator.
 * - **The trades cannot carry an index either.** 22 of 137 are priceable once
 *   picks are counted, 15 of those are two-sided with two or more players, and
 *   they hold no quarterback at all.
 *
 * What *does* replicate is this module: the bid itself, by position, with no
 * value in the arithmetic anywhere. Out-of-sample Poisson deviance over 800
 * half-splits, against one league-wide mean:
 *
 * ```
 *                        blind    shrunk    gain
 *   Eternal Rebuild     0.08695   0.07812   10.2%   (n=321)
 *   Tight Ends          0.13198   0.11867   10.1%   (n=297)
 * ```
 *
 * ## The half-life, and how firm it is
 *
 * `BID_PRIOR = 7`. #77's appetite constant was pinned by both leagues landing
 * on the same minimum; this one is weaker than that and the difference is worth
 * stating plainly. Eternal minimises at 3 and Tight Ends at 12 — but both
 * curves are flat between them, and every constant in 3–12 is within 0.6% of
 * each league's own best — 10.4% and 10.2% there against the 10.2% and 10.1%
 * above. Seven is where the two normalised curves cross, not a figure either
 * league insisted on.
 *
 * ## What is deliberately absent
 *
 * **The week.** #47 argues budget has no salvage value, so a bid should be
 * worth more early. Eternal pays 7.1% of budget in the offseason, 5.2% in weeks
 * 5–12 and 7.0% from week 13; Tight Ends climbs from 1.6% to 9.2% across the
 * same span. One league contradicts the premise and the other reverses it, so
 * there is no factor here to ship — the same verdict #77 reached about partner
 * history, and for the same reason.
 *
 * **The player.** Not an omission: the correlation above is the finding. What
 * these leagues pay is a function of the position and not of the man, so a
 * model that scaled its answer by his price would be inventing the one
 * relationship the data says is absent.
 *
 * ## Competition: a spread, not a factor
 *
 * #47 also proposed raising the bid when rivals have a hole at the position
 * and budget left. Measured on 2026-09-29, half of that is the strongest effect
 * in this module and half of it is nothing:
 *
 * - **Rivals move the price.** Counting the other rosters whose claim on the
 *   same player failed that week, the winning bid rises from 4.0% of budget
 *   uncontested to 9.9% against one rival and 17.7% against two or more in the
 *   Eternal Rebuild (ρ 0.48), and from 3.1% to 20.4% in Tight Ends (ρ 0.28) —
 *   inside every position in both.
 * - **Nothing visible beforehand predicts them.** Rebuilt from the weekly
 *   lineups at the moment of each claim, rivals with a hole at the position,
 *   with budget left, in the bottom third, or thinner in depth — and the
 *   player's own points the week before — all correlate with the bid and with
 *   the actual rivals inside ±0.11, with signs that flip between leagues.
 *
 * So the app cannot say whether a claim will be contested, and does not try.
 * What it can say is what contested claims have cost here: `contest` is that
 * spread, learned from the league's own failed claims, and the manager — who
 * knows his league — decides which row he is in.
 */

/** Sleeper's waiver code for a FAAB league. The other modes run no budget. */
const FAAB = 2;

/**
 * Whether this league bids for players at all.
 *
 * Exported because the surface has to know before the walk, not after it. The
 * history is seventy requests, and a rolling-waiver league can produce no bid
 * from any of them — so the gate and the model have to mean the same thing by
 * "runs FAAB", which is one function rather than two copies of `=== 2`.
 */
export function runsFaab(settings: LeagueSettings | undefined): boolean {
  return settings?.waivers.type === FAAB && (settings.waivers.budget ?? 0) > 0;
}

/**
 * Bids at which a position's own record outweighs the league's overall rate.
 *
 * See the note above: chosen at the crossing of two flat curves rather than at
 * a minimum either league is attached to.
 */
export const BID_PRIOR = 7;

/** One position's record of winning bids. */
export interface PositionBids {
  observations: number;
  /** Mean winning bid, as a share of the budget it was spent from. */
  share: number;
}

/**
 * A league's own waiver market.
 *
 * Shares rather than dollars throughout, because a budget is not a constant of
 * a league: the Eternal Rebuild ran rolling waivers on $100 in 2023 and FAAB on
 * $150 from 2024. Every bid is normalised against the budget of the season it
 * was made in, and only converted back to dollars against the current one at
 * the point a figure is shown.
 */
export interface BidModel {
  /** The current budget, or null in a league that does not run FAAB. */
  budget: number | null;
  /** Smallest legal bid, where the league publishes one. */
  minBid: number | null;
  /** Mean winning bid league-wide, as a share of budget. The prior. */
  leagueShare: number;
  byPosition: Map<Position, PositionBids>;
  /**
   * Winning bids by how many rivals also claimed the player, league-wide:
   * none, one, and two or more. See "Competition" above.
   *
   * League-wide rather than per position, because split four ways the
   * contested rows would be a handful of claims each.
   */
  contest: [PositionBids, PositionBids, PositionBids];
  /** Winning bids behind the whole model. */
  observations: number;
  /** Seasons that contributed a bid, newest first. */
  seasons: string[];
  /** True when the walk could not reach the whole league. */
  truncated: boolean;
}

/**
 * What one claim should cost, and what it would cost this manager.
 *
 * `dollars` is already legal — rounded, and never under a published minimum.
 * The rest is what the surface needs to avoid overclaiming: `learned` carries
 * the evidence clause, and `beyondBudget` is the case where the honest answer
 * is that the league's price is more than this roster still has.
 */
export interface BidAdvice {
  /** Whole dollars, at or above the league's minimum bid. */
  dollars: number;
  /** The unclamped figure, with the evidence behind it. */
  learned: Learned<number>;
  /** This manager's remaining budget, or null when the platform does not say. */
  remaining: number | null;
  /** True when `dollars` exceeds what he has left. */
  beyondBudget: boolean;
}

/**
 * Learn a league's waiver prices from its own completed claims.
 *
 * Four filters, and each one drops a row that would otherwise be counted as a
 * price it is not:
 *
 * - **Winning claims only.** A failed bid says what was *not* enough. It is
 *   real evidence and a different quantity; see the note in `LeagueTransaction`.
 * - **A season that actually ran FAAB.** A rolling-waiver season publishes no
 *   bid, and a league that switched mid-chain has both kinds in one history.
 * - **One added player.** A bid buys a claim, and a claim that brought back two
 *   men cannot be attributed to either. Neither test league has one, so this
 *   costs nothing and prevents a silent halving of some future league's prices.
 * - **A position the platform still knows.** See `TransactionHistory.positions`
 *   for why that table exists rather than a join against the roster.
 */
export function modelBids(
  history: TransactionHistory | undefined,
  settings: LeagueSettings,
): BidModel {
  const budget = runsFaab(settings) ? settings.waivers.budget : null;

  const empty: BidModel = {
    budget,
    minBid: settings.waivers.minBid,
    leagueShare: 0,
    byPosition: new Map(),
    contest: [
      { observations: 0, share: 0 },
      { observations: 0, share: 0 },
      { observations: 0, share: 0 },
    ],
    observations: 0,
    seasons: [],
    truncated: history?.truncated ?? false,
  };
  if (!history) return empty;

  /*
    Who else claimed each player, keyed by the week the claims were processed
    in. A failed claim names the manager who lost it in `rosterIds`, and its one
    add is the player he asked for.
  */
  const claimKey = (season: string, week: number, playerId: string) =>
    `${season}|${week}|${playerId}`;
  const losers = new Map<string, Set<number>>();
  for (const t of history.transactions) {
    if (t.type !== 'waiver' || t.succeeded || t.adds.size !== 1) continue;
    const [playerId] = [...t.adds.keys()];
    const key = claimKey(t.season, t.week, playerId);
    const rosters = losers.get(key) ?? new Set<number>();
    for (const rosterId of t.rosterIds) rosters.add(rosterId);
    losers.set(key, rosters);
  }

  const shares: { position: Position; share: number; rivals: number }[] = [];
  const seasons = new Set<string>();

  for (const t of history.transactions) {
    if (!t.succeeded || t.bid === null || t.adds.size !== 1) continue;

    const seasonWaivers = history.waivers.get(t.season);
    const seasonBudget =
      seasonWaivers?.type === FAAB && (seasonWaivers.budget ?? 0) > 0
        ? seasonWaivers.budget
        : null;
    if (!seasonBudget) continue;

    const [playerId] = [...t.adds.keys()];
    const position = history.positions.get(playerId);
    if (!position) continue;

    const winner = t.adds.get(playerId);
    const rivals = [...(losers.get(claimKey(t.season, t.week, playerId)) ?? [])].filter(
      (rosterId) => rosterId !== winner,
    ).length;

    shares.push({ position, share: t.bid / seasonBudget, rivals });
    seasons.add(t.season);
  }

  if (shares.length === 0) return empty;

  const byPosition = new Map<Position, PositionBids>();
  for (const { position, share } of shares) {
    const row = byPosition.get(position) ?? { observations: 0, share: 0 };
    // Running sum now, divided through below.
    byPosition.set(position, {
      observations: row.observations + 1,
      share: row.share + share,
    });
  }
  for (const [position, row] of byPosition) {
    byPosition.set(position, { ...row, share: row.share / row.observations });
  }

  const contest = empty.contest.map(() => ({ observations: 0, share: 0 })) as BidModel['contest'];
  for (const { share, rivals } of shares) {
    const row = contest[Math.min(rivals, 2)];
    row.observations += 1;
    row.share += share;
  }
  for (const row of contest) if (row.observations > 0) row.share /= row.observations;

  return {
    ...empty,
    leagueShare: shares.reduce((total, s) => total + s.share, 0) / shares.length,
    byPosition,
    contest,
    observations: shares.length,
    seasons: [...seasons].sort().reverse(),
  };
}

/**
 * What this league pays for a claim at one position, in today's dollars.
 *
 * Null in two cases that are not the same, and neither of which may be shown as
 * a number: a league that does not run FAAB has no bid to give, and a league
 * that runs one but has never recorded a claim has said nothing this could be
 * learned from. #47's rule is to degrade to silence rather than to a figure
 * invented here.
 *
 * A position the league has never claimed is *not* one of those cases. It gets
 * weight zero and the league's own overall rate, which is the shrinkage working
 * rather than a gap in it.
 */
export function priceFor(model: BidModel, position: Position): Learned<number> | null {
  if (!model.budget || model.observations === 0) return null;

  const own = model.byPosition.get(position);
  const share = learn(
    own?.share ?? model.leagueShare,
    model.leagueShare,
    own?.observations ?? 0,
    BID_PRIOR,
  );

  // Same envelope, carried into dollars: `observations` and `weight` are what
  // the evidence clause reads, and they do not change with the unit.
  return {
    ...share,
    value: share.value * model.budget,
    prior: share.prior * model.budget,
  };
}

/** What a claim has cost here at one level of competition, in today's dollars. */
export interface ContestPrice {
  /** 0, 1, or 2 standing for "two or more". */
  rivals: 0 | 1 | 2;
  dollars: number;
  observations: number;
}

/**
 * What claims have cost here with nobody, one rival, and two or more bidding.
 *
 * Each row is shrunk toward the league rate by the same `BID_PRIOR` as a
 * position, and a row is left out until it has `BID_PRIOR` claims behind it —
 * the point where its own record carries half the weight. Below that the row
 * would mostly be the league average wearing a contested label, which is a
 * spread the league never showed.
 *
 * Null unless the uncontested row and at least one contested row both clear
 * that bar, since a spread with one end is not a spread.
 */
export function contestSpread(model: BidModel): ContestPrice[] | null {
  if (!model.budget || model.observations === 0) return null;
  const budget = model.budget;

  const rows = model.contest.flatMap((row, rivals): ContestPrice[] => {
    if (row.observations < BID_PRIOR) return [];
    const share = learn(row.share, model.leagueShare, row.observations, BID_PRIOR).value;
    return [
      {
        rivals: rivals as ContestPrice['rivals'],
        dollars: Math.max(Math.round(share * budget), model.minBid ?? 0, 0),
        observations: row.observations,
      },
    ];
  });

  return rows[0]?.rivals === 0 && rows.length > 1 ? rows : null;
}

/**
 * What this manager has left to spend, or null when the platform does not say.
 *
 * Not clamped at zero, and not capped at the league's budget. FAAB moves
 * between rosters in trades, so `faabUsed` goes negative for a manager who has
 * acquired some: one roster of the four-season test league reads -20 against a
 * $150 league and has $170. A clamp either way would report a manager's own
 * money as not his.
 */
export function budgetLeft(model: BidModel, roster: Roster): number | null {
  if (model.budget === null || roster.faabUsed === null) return null;
  return model.budget - roster.faabUsed;
}

/**
 * The league's price for this position, made legal and measured against what
 * one manager still has.
 *
 * The clamp order matters. A published minimum is a rule of the league and
 * binds before anything else; the manager's own budget is then a fact about
 * him, and the honest report when the price is past it is the price *and* the
 * shortfall — not a smaller number that would lose the claim.
 */
export function adviseBid(
  model: BidModel,
  position: Position,
  roster: Roster,
): BidAdvice | null {
  const learned = priceFor(model, position);
  if (!learned) return null;

  const remaining = budgetLeft(model, roster);
  const dollars = Math.max(Math.round(learned.value), model.minBid ?? 0, 0);

  return {
    dollars,
    learned,
    remaining,
    beyondBudget: remaining !== null && dollars > remaining,
  };
}
