import type { DraftPick, League, Roster } from '../types';
import { lookupPickValue, type PickValueTable } from '../values/dynastyprocess';

/**
 * A note on where the rookie-pick cliff comes from, since it used to come from
 * here twice.
 *
 * An NFL draft class yields roughly 10-15 offensive players good enough to
 * matter in fantasy in their first two years. After that the hit rate falls off
 * a cliff, and a pick model that does not show one is wrong.
 *
 * `pickRealismFactor` used to impose that cliff on top of DynastyProcess, on the
 * argument that market pick values are smoother than reality because hope is
 * priced in. Checked against the source, they are not. DynastyProcess's own 2026
 * curve, read by overall pick number, is:
 *
 *     1: 5505   5: 2514   10: 1004   13: 598   20: 195   25: 95   30: 49   45: 11
 *
 * A **28x** drop by pick 20 and 112x by pick 30, before anything of ours ran.
 * The extra factor then took another 70% off at pick 20 and 92% at pick 30, and
 * the compounded result priced a 2026 second-rounder in this league at **44 out
 * of 10,000** — a sixth of a waiver-wire running back, and about a fiftieth of
 * what anyone in the league would accept for one.
 *
 * The curve was also doing a job that belongs to the lookup. Its anchors were
 * absolute pick numbers "because the supply of NFL talent does not care how many
 * teams are in your league" — but the *lookup beneath it* was reading the
 * league's own slot label off DynastyProcess's 12-team board, so the same
 * argument was being made in one direction and contradicted in the other. Going
 * through the overall pick number (see `dynastyprocess.BOARD_SIZE`) delivers the
 * league-size property directly from the source: a 10-team 3.01 is the 21st pick
 * and prices at 168, a 12-team 3.01 is the 25th and prices at 95, a 14-team 3.01
 * is the 29th and prices at 56.
 *
 * So there is no curve here any more. The cliff is real, it is in the data, and
 * imposing it a second time was not conservatism — it was an error large enough
 * to make the app hand out draft capital for nothing.
 */

/**
 * A draft order the platform actually knows, rather than one we inferred.
 *
 * Sleeper publishes the real order the moment a commissioner sets it, and it
 * is frequently nothing like a strength ranking — leagues use lotteries, prior
 * seasons' standings, or simply decide. On a league whose season has not
 * started every roster is 0-0, so a projection has only roster strength to go
 * on and will confidently produce a different answer to the truth sitting in
 * the API.
 */
export interface KnownDraftOrder {
  season: string;
  /** Roster id to draft slot, from Sleeper's `slot_to_roster_id`. */
  slots: Map<number, number>;
  /** Snake reverses even rounds; linear repeats the same order every round. */
  snake: boolean;
}

/**
 * The overall pick number a slot lands on in a given round.
 *
 * Linear repeats the order every round. Snake reverses the even ones, so the
 * team holding 1.01 picks last in the second round — pricing its second as
 * though it picked first overstates it by roughly double, which matters
 * because the realism curve reads the absolute pick number and nothing else.
 */
export function overallPickNumber(
  round: number,
  slot: number,
  teamCount: number,
  snake: boolean,
): number {
  const withinRound = snake && round % 2 === 0 ? teamCount - slot + 1 : slot;
  return (round - 1) * teamCount + withinRound;
}

/**
 * Where a team is likely to pick, from how good it is now.
 *
 * Only used for seasons Sleeper has no draft for — usually everything past
 * next year. Rookie draft order is the reverse of the standings, so the worst
 * roster holds 1.01. Valuing every first identically ignores the largest
 * single factor in what a pick is worth — a bottom team's first and the
 * champion's first are not remotely the same asset, and treating them as equal
 * is how you end up trading one for the other.
 */
export function projectedSlots(rosterIdsWorstFirst: number[]): Map<number, number> {
  const slots = new Map<number, number>();
  rosterIdsWorstFirst.forEach((rosterId, index) => slots.set(rosterId, index + 1));
  return slots;
}

export interface TradedPickRef {
  season: string;
  round: number;
  /** Roster the pick originally belonged to. */
  originalRosterId: number;
  /** Roster holding it now. */
  ownerRosterId: number;
}

/** "1.09" — round and pick within it, the way drafters say it. */
const format = (round: number, overall: number, teamCount: number): string =>
  `${round}.${String(((overall - 1) % teamCount) + 1).padStart(2, '0')}`;

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
  /** Orders Sleeper already knows, which beat any projection. */
  knownOrders: KnownDraftOrder[] = [],
): DraftPick[] {
  const rounds = Math.max(1, league.settings.draftRounds);
  const rosterName = new Map(league.rosters.map((r: Roster) => [r.rosterId, r.teamName]));
  const teamCount = league.rosters.length;
  const projected = projectedSlots(rosterIdsWorstFirst);
  const known = new Map(knownOrders.map((order) => [order.season, order]));
  // A league's draft format does not change year to year, so the one Sleeper
  // reports is the best guess for seasons it has no draft for yet.
  const defaultSnake = knownOrders.some((order) => order.snake);

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
        // finish decides where it lands, no matter who holds it now.
        const order = known.get(season);
        const realSlot = order?.slots.get(roster.rosterId) ?? null;
        const slot = realSlot ?? projected.get(roster.rosterId) ?? null;
        const snake = order?.snake ?? defaultSnake;
        // With no standings to project from, fall back to the middle of the
        // round. The curve reads absolute pick number only, so the round still
        // places the pick correctly on it even when the slot is a guess —
        // skipping the curve entirely here once priced a third at full value.
        const overall = overallPickNumber(
          round,
          slot ?? Math.ceil(teamCount / 2),
          teamCount,
          snake,
        );

        // Straight from the source, by overall pick number. `marketValue` means
        // "the number the other manager will quote" everywhere else in the app,
        // and trade fairness is argued in it — so a private correction applied
        // here would settle every fairness verdict in units nobody else uses.
        const marketValue = pickValues
          ? Math.round(lookupPickValue(pickValues, season, overall))
          : 0;

        // Pick value swings ninefold inside a single round, so the slot is part
        // of the pick's name rather than something to infer from the number.
        const via = viaOther ? `via ${rosterName.get(roster.rosterId) ?? 'unknown'}` : '';
        const where =
          slot === null ? '' : realSlot === null ? `proj ${format(round, overall, teamCount)}` : format(round, overall, teamCount);
        const note = [where, via].filter(Boolean).join(', ');

        picks.push({
          id,
          season,
          round,
          originalRosterId: roster.rosterId,
          ownerRosterId,
          value: Math.round(marketValue * shrink),
          marketValue,
          slot,
          slotKnown: realSlot !== null,
          label: note ? `${season} ${ordinal(round)} (${note})` : `${season} ${ordinal(round)}`,
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
