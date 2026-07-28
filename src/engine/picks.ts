import type { DraftPick, League, Roster } from '../types';
import { lookupPickValue, type PickTier, type PickValueTable } from '../values/dynastyprocess';

/**
 * What a rookie pick is really worth.
 *
 * An NFL draft class yields roughly 10-15 offensive players good enough to
 * matter in fantasy in their first two years — first and early second round
 * talent. In a 10-team rookie draft that is the first round and the top of the
 * second, and after that the hit rate falls off a cliff: most later picks never
 * become starters and never see meaningful snaps. Third-rounders are close to
 * worthless as trade currency, which is why nobody will give you anything real
 * for one.
 *
 * Market pick values are smoother than that, because they average across league
 * formats and because hope is priced in. This curve reimposes the cliff.
 *
 * The thresholds are absolute pick numbers, not rounds, because the supply of
 * NFL talent does not care how many teams are in your league.
 */
export function pickRealismFactor(overallPick: number, round: number): number {
  if (round >= 3) return 0.03;
  if (overallPick <= 10) return 1;
  // Still real talent, fading.
  if (overallPick <= 15) return 1 - (overallPick - 10) * 0.05;
  // The cliff: pick 16 is worth barely half of pick 15.
  if (overallPick <= 20) return 0.45 - (overallPick - 16) * 0.03;
  return 0.2;
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
        // round. The round-based part of the curve — third-rounders being worth
        // nothing — needs no slot at all, and skipping it entirely priced a
        // third at full value.
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
          marketValue = Math.round(quoted * pickRealismFactor(overall, round));
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
 * Which draft classes are still tradeable.
 *
 * Anchored to the current NFL season rather than the league's own season field,
 * which goes stale on a completed league. Bounded by what the value source
 * actually publishes, so we never show a pick we cannot price.
 */
export function tradeableSeasons(
  currentSeason: string,
  available: string[],
): string[] {
  return available.filter((season) => season >= currentSeason).sort();
}

export function picksForRoster(picks: DraftPick[], rosterId: number): DraftPick[] {
  return picks
    .filter((p) => p.ownerRosterId === rosterId)
    .sort((a, b) => a.season.localeCompare(b.season) || a.round - b.round);
}
