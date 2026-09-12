import type { DraftPick, Position } from '../types';
import { AGE_CLIFF, SKILL_POSITIONS, wouldStartOn, type LeagueDemand } from './analysis';
import type { PlayerRole } from './role';
import type { RosterSummary, ValuedPlayer } from './rosterValue';

/**
 * What kind of future a roster has, rather than how much of one.
 *
 * `totalValue` is a sum and `futureScore` collapses a whole roster into one axis
 * coordinate. Neither can say what a team is actually holding, and that is what
 * makes advice specific: "sell the veterans" is a sentence the app could always
 * write, while "these three are your depreciating half and this is who wants
 * them" needs the roster taken apart.
 *
 * Nothing here revalues anyone. Every test below reads a number the app already
 * computed.
 */
export type Bucket = 'core' | 'depreciating' | 'lottery' | 'dead' | 'depth';

/**
 * Years of service below which a player has not yet established anything.
 *
 * Two, so a rookie and a sophomore are bets and a third-year player is what he
 * has shown. Deliberately coarse: this decides which side of "we know what he
 * is" a man falls on, and no evidence in this app supports a finer line.
 */
export const PROSPECT_YEARS = 2;

export interface BucketedAsset {
  /** Player id, or `DraftPick.id`. */
  id: string;
  kind: 'player' | 'pick';
  label: string;
  /** Null for a pick, which has no position until it is made. */
  position: Position | null;
  /** Dynasty value — what he fetches. Buckets are a holding question. */
  value: number;
  bucket: Bucket;
}

export interface RosterBuckets {
  assets: BucketedAsset[];
  /** Dynasty value held in each bucket. */
  value: Record<Bucket, number>;
  count: Record<Bucket, number>;
  /** Every bucket summed — picks included, K and DEF excluded. */
  total: number;
}

export interface BucketInputs {
  summary: RosterSummary;
  /** Who this roster still starts in `HORIZON_YEARS`. `futureLineup`. */
  futureStarterIds: ReadonlySet<string>;
  demand: LeagueDemand;
  /** This roster's picks, or empty when pick values have not arrived. */
  picks: DraftPick[];
  /**
   * Measured role, when the activity data is in hand.
   *
   * Optional on purpose. Roles come from snap data that can be a season stale
   * or absent entirely, and the decomposition is still worth having without
   * them — `prospect` then falls back to the one thing always known, which is
   * whether the man is in this roster's own lineup.
   */
  roles?: Map<string, PlayerRole>;
}

const EMPTY: Record<Bucket, number> = {
  core: 0,
  depreciating: 0,
  lottery: 0,
  dead: 0,
  depth: 0,
};

/**
 * A bet rather than an asset: too new to have shown what he is.
 *
 * Three conditions, and the third is what stops it swallowing good young
 * players. A rookie receiver already starting for you has established a role —
 * the fact that he did it in year one is the opposite of a reason to call him
 * speculative.
 */
function prospect(entry: ValuedPlayer, { summary, roles }: BucketInputs): boolean {
  const { id, yearsExp } = entry.player;
  if (yearsExp === null || yearsExp > PROSPECT_YEARS) return false;
  if (summary.starterIds.has(id)) return false;
  return roles?.get(id)?.role !== 'starter';
}

/**
 * Which bucket a player falls in, by a **stated precedence**.
 *
 * The four tests the issue names do not partition a roster, and pretending they
 * do is how players get counted twice or not at all. An aging starter satisfies
 * both *core* and *depreciating*; a 26-year-old bench receiver who would start
 * for two other teams satisfies none of them. So the order below is part of the
 * definition rather than an implementation detail:
 *
 * 1. **Lottery** — a bet, and a bet is not an asset whatever else is true of
 *    him.
 * 2. **Dead weight** — nobody in the league would start him. *After* lottery,
 *    which is the ordering that matters most here: a prospect nobody starts yet
 *    is the whole point of holding a prospect, and calling him dead weight
 *    would invert the advice.
 * 3. **Depreciating** — past his position's age cliff. Someone would start him
 *    today, and his price is falling; that is what makes him a sell.
 * 4. **Core** — starts today and still starts in three years.
 * 5. **Depth** — the remainder, and it is real: useful, not declining, not in
 *    the best eleven. Naming it is better than forcing it into one of the four
 *    and reporting a roster the manager does not recognise.
 */
export function bucketOf(entry: ValuedPlayer, inputs: BucketInputs): Bucket {
  const { summary, futureStarterIds, demand } = inputs;
  const { id, position, age } = entry.player;

  if (prospect(entry, inputs)) return 'lottery';
  if (wouldStartOn(demand, entry, summary.rosterId) === 0) return 'dead';
  if (age !== null && age >= (AGE_CLIFF[position] ?? 99)) return 'depreciating';
  if (summary.starterIds.has(id) && futureStarterIds.has(id)) return 'core';
  return 'depth';
}

/**
 * Take a roster apart.
 *
 * Kickers and defences are left out entirely rather than bucketed, because they
 * carry no value in this app at all (#10) — every one of them would land in
 * dead weight and say nothing about the roster's future except that the league
 * starts a kicker.
 *
 * Picks are lottery by definition. A pick is an unnamed player at an unknown
 * position, which is the purest form of the bet the bucket describes.
 */
export function bucketRoster(inputs: BucketInputs): RosterBuckets {
  const { summary, picks } = inputs;

  const assets: BucketedAsset[] = summary.players
    .filter((entry) => SKILL_POSITIONS.includes(entry.player.position))
    .map((entry) => ({
      id: entry.player.id,
      kind: 'player' as const,
      label: entry.player.name,
      position: entry.player.position,
      value: entry.value,
      bucket: bucketOf(entry, inputs),
    }));

  for (const pick of picks) {
    assets.push({
      id: pick.id,
      kind: 'pick',
      // The pick's own display label — "2027 1st (via Ben)" — rather than a
      // second way of spelling the same pick.
      label: pick.label,
      position: null,
      value: pick.value,
      bucket: 'lottery',
    });
  }

  const value = { ...EMPTY };
  const count = { ...EMPTY };
  for (const asset of assets) {
    value[asset.bucket] += asset.value;
    count[asset.bucket] += 1;
  }

  return {
    assets: assets.sort((a, b) => b.value - a.value || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    value,
    count,
    total: Object.values(value).reduce((sum, v) => sum + v, 0),
  };
}
