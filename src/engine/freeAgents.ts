import type { Player, PlayerValue, Position } from '../types';
import type { ReplacementLevel } from './replacement';
import { applyReplacement } from './replacement';
import { activityFactor, type ActivityAdjustment } from './activityFactor';
import type { SnapShare } from './snapShare';
import type { Opportunity } from './opportunity';

/**
 * The waiver wire, valued.
 *
 * Every build before this one discarded unrostered players at import — 893 of
 * them on the test league against 176 rostered — so the app could answer what
 * any player on a roster was worth and had nothing at all to say about the
 * other 84%.
 *
 * **The board is two lists, and that is the whole design.** FantasyCalc's
 * universe is roughly one league's worth of players, so it prices 231 of those
 * 893 and has never heard of the other 662. That is #10's "no published value
 * is not the same as worth nothing" at 74% instead of 10%, and it means a
 * single ranked list is impossible without inventing a number for two-thirds of
 * it. So: market value where it exists, playing time where it does not, and the
 * two never mixed into one score.
 *
 * Playing time is the better signal for a waiver claim anyway. What matters is
 * whether a man is on the field now, not what a dynasty market thinks of a
 * player it has not gotten round to ranking.
 *
 * **Nothing here can move a value anywhere else in the app.** Replacement level
 * is computed by `valueLeague` from the rostered universe alone; this reads the
 * levels it produced and never feeds back into them. The separation is enforced
 * by the shape of the data — free agents arrive in their own field of
 * `LeagueBundle` and are never passed to `valueLeague` — rather than by anyone
 * remembering to keep them apart.
 */

export interface FreeAgent {
  player: Player;
  /**
   * League-adjusted value, on the same scale as every rostered player, or null
   * when no source publishes one for him.
   *
   * Null rather than zero, always. A player outside FantasyCalc's ranked
   * universe is worth close to nothing and not exactly nothing, and a kicker is
   * worth nothing *to trade* while being perfectly useful on Sunday —
   * `UnvaluedCell` is what tells those two apart on screen.
   */
  value: PlayerValue | null;
  snaps: SnapShare | undefined;
  usage: Opportunity | undefined;
  /** What his current role did to his value, for the priced ones. */
  adjustment: ActivityAdjustment | undefined;
}

export interface FreeAgentBoard {
  /** Priced by the market, most valuable first. */
  priced: FreeAgent[];
  /** Nobody publishes a price. Ordered by how much he is playing. */
  unpriced: FreeAgent[];
  /** Every free agent, priced or not — for counting and filtering. */
  all: FreeAgent[];
}

export interface FreeAgentInput {
  freeAgents: Map<string, Player>;
  /** Raw market values, exactly as `valueLeague` was handed them. */
  market: Map<string, PlayerValue>;
  /** Replacement levels this league converged on, from `LeagueValuation.levels`. */
  levels: Partial<Record<Position, ReplacementLevel>>;
  snaps: Map<string, SnapShare> | undefined;
  usage: Map<string, Opportunity> | undefined;
  /**
   * Whether the activity data describes the season being played.
   *
   * Passed straight through to `activityFactor`, which is where the rule lives:
   * out of season every factor is exactly 1, because a role change the market
   * has had months to absorb is not news. The ordering of the unpriced block
   * still uses the shares — a role that changed last November really did change
   * — but the UI has to say which season it is quoting. See `current` in
   * `LeagueActivity`.
   */
  current: boolean;
}

/**
 * How much a player is playing, and how recently that was measured.
 *
 * Deliberately one metric rather than a blend. Target share, carry share and
 * WOPR are position-specific and quoted on different scales; folding them into
 * a single number would be the same category error as adding a dynasty value to
 * a win-now one. Snap share is the one column defined for everybody, so it is
 * the one that orders the list, and the rest are shown beside it.
 *
 * `recent` is not decoration, and the board was wrong without it. Ordering on a
 * bare share put a quarterback who started five games in October above a
 * receiver who played all seventeen weeks, because both averaged high shares
 * across *the games they appeared in* — which is what `SnapShare.season` means,
 * and rightly so: `activity.ts` treats a missed week as no evidence rather than
 * as a zero. The fix is not to re-weight the share by availability, which would
 * contradict that rule. It is to notice that "98% lately" and "98% back then"
 * are different claims and rank them in that order.
 */
export interface PlayingTime {
  share: number;
  /** True when the figure describes the recent window rather than older weeks. */
  recent: boolean;
}

export function playingTime(snaps: SnapShare | undefined): PlayingTime | null {
  if (!snaps) return null;
  if (snaps.recent !== null) return { share: snaps.recent, recent: true };
  return { share: snaps.season, recent: false };
}

/**
 * Three tiers, each ordered by the one metric: on the field lately, on the field
 * at some point, never seen. No arithmetic crosses a tier boundary, so nothing
 * here is a score — it is a ranking of evidence, strongest first.
 */
const byPlayingTime = (a: FreeAgent, b: FreeAgent): number => {
  const left = playingTime(a.snaps);
  const right = playingTime(b.snaps);

  if (left === null || right === null) {
    if (left === right) return byId(a, b);
    return left === null ? 1 : -1;
  }

  if (left.recent !== right.recent) return left.recent ? -1 : 1;
  return right.share - left.share || byId(a, b);
};

/** Arbitrary but stable, so the order never depends on map insertion. */
const byId = (a: FreeAgent, b: FreeAgent): number =>
  a.player.id < b.player.id ? -1 : a.player.id > b.player.id ? 1 : 0;

const byValue = (a: FreeAgent, b: FreeAgent): number =>
  (b.value?.value ?? 0) - (a.value?.value ?? 0) ||
  (b.value?.marketValue ?? 0) - (a.value?.marketValue ?? 0) ||
  byId(a, b);

export function freeAgentBoard({
  freeAgents,
  market,
  levels,
  snaps,
  usage,
  current,
}: FreeAgentInput): FreeAgentBoard {
  // The market, narrowed to this list before anything is computed from it. The
  // rostered players are somebody else's question and their values are already
  // settled; recomputing them here would be a second answer to a question that
  // has one.
  const subset = new Map<string, PlayerValue>();
  const adjustments = new Map<string, ActivityAdjustment>();

  for (const [id, player] of freeAgents) {
    const value = market.get(id);
    if (value) subset.set(id, value);

    const adjustment = activityFactor(player, {
      snaps: snaps?.get(id),
      usage: usage?.get(id),
      current,
    });
    if (adjustment.factor !== 1) adjustments.set(id, adjustment);
  }

  // The same arithmetic every rostered player went through, against the levels
  // this league already converged on — so a free agent's 900 and a rostered
  // player's 900 mean the same thing and can be compared without conversion.
  const values = applyReplacement(subset, levels, adjustments);

  const all: FreeAgent[] = [];
  for (const [id, player] of freeAgents) {
    all.push({
      player,
      value: values.get(id) ?? null,
      snaps: snaps?.get(id),
      usage: usage?.get(id),
      adjustment: adjustments.get(id),
    });
  }

  const priced = all.filter((entry) => entry.value !== null).sort(byValue);
  const unpriced = all.filter((entry) => entry.value === null).sort(byPlayingTime);

  return { priced, unpriced, all };
}
