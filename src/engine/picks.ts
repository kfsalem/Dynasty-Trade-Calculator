import type { DraftPick, League, Roster } from '../types';
import { lookupPickValue, type PickValueTable } from '../values/dynastyprocess';

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
): DraftPick[] {
  const rounds = Math.max(1, league.settings.draftRounds);
  const rosterName = new Map(league.rosters.map((r: Roster) => [r.rosterId, r.teamName]));

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

        picks.push({
          id,
          season,
          round,
          originalRosterId: roster.rosterId,
          ownerRosterId,
          value: pickValues ? lookupPickValue(pickValues, season, round) : 0,
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
