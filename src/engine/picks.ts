import type { DraftPick, League, Roster } from '../types';
import { lookupPickValue, type PickTier, type PickValueTable } from '../values/dynastyprocess';

/**
 * What a rookie pick is really worth, as a share of its quoted value.
 *
 * An NFL draft class yields roughly 10-15 offensive players good enough to
 * matter in fantasy in their first two years — first and early second round
 * talent. After that the hit rate falls off a cliff: most later picks never
 * become starters and never see meaningful snaps. Market pick values are
 * smoother than that, because they average across league formats and because
 * hope is priced in. This curve reimposes the cliff.
 *
 * Anchors are absolute pick numbers, because the supply of NFL talent does not
 * care how many teams are in your league. That has a consequence worth stating:
 * a third-rounder is worth appreciably more in a 10-team league (picks 21-30)
 * than in a 14-team one (picks 29-42), which is correct — the bigger league is
 * drafting further into the same pool.
 *
 * An earlier version short-circuited on `round >= 3` before consulting the pick
 * number at all, which contradicted the paragraph above and produced an 11x drop
 * between two *adjacent* picks in a 10-team league: 2.10 kept 33% and 3.01 kept
 * 3%. Projected draft slots are not precise to one pick, so a discontinuity that
 * large was an artifact rather than a model. It also flattened every third-round
 * pick onto the same near-zero number, losing the ordering between them for the
 * same reason the old value clamp did — see `replacement.RESIDUAL_SHARE`.
 */
const REALISM_ANCHORS: readonly (readonly [pick: number, factor: number])[] = [
  [10, 1], //  the class's genuine fantasy contributors
  [15, 0.7], // real talent, fading
  [20, 0.3], // the cliff
  [30, 0.08], // dart throws
  [45, 0.03], // lottery tickets, and the floor past here
];

export function pickRealismFactor(overallPick: number): number {
  const first = REALISM_ANCHORS[0];
  const last = REALISM_ANCHORS[REALISM_ANCHORS.length - 1];
  if (overallPick <= first[0]) return first[1];
  if (overallPick >= last[0]) return last[1];

  for (let i = 1; i < REALISM_ANCHORS.length; i++) {
    const [prevPick, prevFactor] = REALISM_ANCHORS[i - 1];
    const [pick, factor] = REALISM_ANCHORS[i];
    if (overallPick > pick) continue;
    // Linear between anchors, so the curve is continuous everywhere and no two
    // adjacent picks can differ by more than one segment's slope.
    return prevFactor + ((overallPick - prevPick) / (pick - prevPick)) * (factor - prevFactor);
  }
  return last[1];
}

/**
 * Where a team is likely to pick, from how good it is now.
 *
 * Rookie draft order is the reverse of the standings, so the worst roster holds
 * 1.01. Valuing every first identically ignores the largest single factor in
 * what a pick is worth — a bottom team's first and the champion's first are not
 * remotely the same asset, and treating them as equal is how you end up trading
 * one for the other.
 */
export function projectedSlots(rosterIdsWorstFirst: number[]): Map<number, number> {
  const slots = new Map<number, number>();
  rosterIdsWorstFirst.forEach((rosterId, index) => slots.set(rosterId, index + 1));
  return slots;
}

/** Slot to early/mid/late, for seasons too far out for the source to name slots. */
export function slotTier(slot: number, teamCount: number): PickTier {
  if (teamCount <= 0) return null;
  const third = teamCount / 3;
  if (slot <= third) return 'early';
  if (slot <= third * 2) return 'mid';
  return 'late';
}

export interface TradedPickRef {
  season: string;
  round: number;
  /** Roster the pick originally belonged to. */
  originalRosterId: number;
  /** Roster holding it now. */
  ownerRosterId: number;
}

const ordinal = (round: number): string =>
  ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th'][round] ?? `${round}th`;

/**
 * Reconstruct who owns which rookie picks.
 *
 * Sleeper only reports picks that have *changed hands*. Every other pick is
 * still held by whoever it originally belonged to, so ownership is "each roster
 * owns its own pick for every season and round" with the traded ones applied on
 * top. Omitting that base set is the classic way to end up valuing only the
 * handful of picks that happen to have been traded.
 */
export function buildDraftPicks(
  league: League,
  tradedPicks: TradedPickRef[],
  seasons: string[],
  pickValues: PickValueTable | undefined,
  /** Roster ids ordered worst-first, for projecting draft slots. */
  rosterIdsWorstFirst: number[] = [],
  /** Scales pick values onto the league-adjusted player scale. */
  shrink = 1,
): DraftPick[] {
  const rounds = Math.max(1, league.settings.draftRounds);
  const rosterName = new Map(league.rosters.map((r: Roster) => [r.rosterId, r.teamName]));
  const teamCount = league.rosters.length;
  const slots = projectedSlots(rosterIdsWorstFirst);

  // season-round-originalRoster -> current owner
  const traded = new Map<string, number>();
  for (const pick of tradedPicks) {
    traded.set(
      `${pick.season}-${pick.round}-${pick.originalRosterId}`,
      pick.ownerRosterId,
    );
  }

  const picks: DraftPick[] = [];
  for (const season of seasons) {
    for (let round = 1; round <= rounds; round++) {
      for (const roster of league.rosters) {
        const id = `${season}-${round}-${roster.rosterId}`;
        const ownerRosterId = traded.get(id) ?? roster.rosterId;
        const viaOther = ownerRosterId !== roster.rosterId;

        // The slot belongs to the roster the pick came *from* — that is whose
        // record decides where it lands, no matter who holds it now.
        const slot = slots.get(roster.rosterId) ?? null;
        // With no standings to project from, fall back to the middle of the
        // round. The curve reads absolute pick number only, so the round still
        // places the pick correctly on it even when the slot is a guess —
        // skipping the curve entirely here once priced a third at full value.
        const overall =
          (round - 1) * teamCount + (slot ?? Math.ceil(teamCount / 2));

        // The realism curve is applied to the market figure too, not only the
        // league-adjusted one. It corrects a market that overprices late picks,
        // and applying it to only one side would let the engine hand over
        // third-rounders that "balance" a trade while costing it nothing.
        let marketValue = 0;
        if (pickValues) {
          const quoted = lookupPickValue(
            pickValues,
            season,
            round,
            slot,
            slot === null ? null : slotTier(slot, teamCount),
          );
          marketValue = Math.round(quoted * pickRealismFactor(overall));
        }

        picks.push({
          id,
          season,
          round,
          originalRosterId: roster.rosterId,
          ownerRosterId,
          value: Math.round(marketValue * shrink),
          marketValue,
          slot,
          label: viaOther
            ? `${season} ${ordinal(round)} (via ${rosterName.get(roster.rosterId) ?? 'unknown'})`
            : `${season} ${ordinal(round)}`,
        });
      }
    }
  }

  return picks;
}

/**
 * Sleeper league states in which this season's rookie draft has not yet run.
 *
 * `pre_draft` and `drafting` are the only two; a league reaches `in_season` when
 * its draft completes, and `complete` when the season ends.
 */
const ROOKIE_DRAFT_PENDING = new Set(['pre_draft', 'drafting']);

/**
 * Which draft classes are still tradeable.
 *
 * Anchored to the current NFL season rather than the league's own season field,
 * which goes stale on a completed league. Bounded by what the value source
 * actually publishes, so we never show a pick we cannot price.
 *
 * The current season needs the extra check. Sleeper's `/state/nfl` season rolls
 * over in the spring, but dynasty rookie drafts run any time from May to well
 * into August — so for months after a league drafts, `season >= currentSeason`
 * alone keeps offering picks that have already been used. Those are not cheap
 * mistakes to show: a first-rounder is the most valuable asset the app prices
 * and the usual currency for balancing an offer.
 *
 * The league's own status answers it, but only when the league has rolled over
 * to the current season. A dynasty league still sitting on last year's entry has
 * a `complete` status describing a season that is over and a rookie draft that
 * has not been scheduled, so its status says nothing about this year's class.
 */
export function tradeableSeasons(
  currentSeason: string,
  available: string[],
  league: Pick<League, 'season' | 'status'>,
): string[] {
  const drafted =
    league.season === currentSeason && !ROOKIE_DRAFT_PENDING.has(league.status);
  const earliest = drafted ? String(Number(currentSeason) + 1) : currentSeason;

  return available.filter((season) => season >= earliest).sort();
}

export function picksForRoster(picks: DraftPick[], rosterId: number): DraftPick[] {
  return picks
    .filter((p) => p.ownerRosterId === rosterId)
    .sort((a, b) => a.season.localeCompare(b.season) || a.round - b.round);
}
