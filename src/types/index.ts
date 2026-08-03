/**
 * Canonical domain model.
 *
 * Everything downstream of `platforms/` speaks these types. Platform adapters
 * (Sleeper, later MFL/Fleaflicker) map their own shapes into this, so no UI or
 * engine code ever knows which site a league came from.
 */

export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF';

/** A slot in a starting lineup. Superset of Position — includes the flexes. */
export type LineupSlot =
  | Position
  | 'FLEX' // RB/WR/TE
  | 'SUPER_FLEX' // QB/RB/WR/TE
  | 'REC_FLEX' // WR/TE
  | 'IDP_FLEX'
  | 'BN'
  | 'IR'
  | 'TAXI';

/** Which positions may fill a given flex slot. */
export const FLEX_ELIGIBILITY: Record<string, Position[]> = {
  FLEX: ['RB', 'WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  REC_FLEX: ['WR', 'TE'],
};

/**
 * A player's availability designation, as the platform reports it.
 *
 * The list is longer than the four words a fantasy manager reads on a Sunday
 * because Sleeper's `injury_status` carries roster designations alongside
 * injuries, and the difference between them is invisible in the field itself.
 * `dnr` is the reserve/did-not-report list and `na` is a player not on an
 * active NFL roster; neither is an injury, and both mean exactly what IR means
 * for the purpose of filling a lineup slot.
 *
 * `unknown` exists so an unrecognised designation survives the mapper with its
 * raw text in `description` rather than being dropped. See `engine/availability`
 * for what each one does to a lineup.
 */
export interface InjuryStatus {
  status:
    | 'healthy'
    | 'questionable'
    | 'doubtful'
    | 'out'
    | 'ir'
    | 'pup'
    | 'sus'
    | 'dnr'
    | 'na'
    | 'unknown';
  description?: string;
}

/**
 * A player, independent of platform.
 *
 * `platformIds` is what makes multi-platform support tractable — FantasyCalc
 * hands us the cross-platform mapping for free, so a player resolved from
 * Sleeper can still be matched against an MFL or ESPN league later.
 */
export interface Player {
  /** Our canonical id. Currently the Sleeper id, since Sleeper is the first provider. */
  id: string;
  name: string;
  position: Position;
  team: string | null;
  age: number | null;
  yearsExp: number | null;
  injury?: InjuryStatus;
  platformIds: {
    sleeper?: string;
    mfl?: string;
    espn?: string;
    fleaflicker?: string;
    ffpc?: string;
  };
}

/**
 * A player's value under a specific league configuration.
 *
 * **Two questions, two scales, four numbers.** The scales answer different
 * questions and must never be summed together:
 *
 * - *What is he worth?* — the **dynasty** pair. `marketValue` is what
 *   KeepTradeCut and FantasyCalc quote, the figure the manager across the table
 *   will check before accepting; `value` is that figure measured against what
 *   this league pays to replace his position. Trade fairness is argued in the
 *   first, and whether an asset is worth holding is decided by the second.
 * - *Does he help me win this year?* — the **win-now** pair. `redraftValue` is
 *   the same source's one-season price, and `winNowValue` is that measured
 *   against a replacement level computed on the same scale. Lineups are built
 *   and scored here, and nowhere else.
 *
 * Keeping them apart is the whole of R8. Ranking a lineup on dynasty value asks
 * a 33-year-old receiver and a rookie who has never played a snap the same
 * question and gets the same answer — on the real league Mike Evans, Davante
 * Adams, Travis Hunter and Cam Ward all price within 10% of each other on
 * dynasty while their redraft values differ by roughly 8x.
 *
 * Both pairs come from FantasyCalc divided by the *same* normalizing constant,
 * so a dynasty figure and a redraft figure are quoted in the same currency even
 * though they price different horizons. That is what makes a ratio between them
 * meaningful; it is not licence to add them.
 */
export interface PlayerValue {
  playerId: string;
  /** Position, carried so replacement level can be computed per position. */
  position: Position | null;
  /** Dynasty value on a 0-10000 scale — market, or above replacement. */
  value: number;
  /** Always the raw dynasty market figure, whatever `value` holds. */
  marketValue: number;
  /** Always the raw one-season figure, whatever `winNowValue` holds. */
  redraftValue: number;
  /**
   * `redraftValue` measured against the win-now replacement level, the same way
   * `value` is derived from `marketValue`. This is what `bestLineup` sorts on.
   */
  winNowValue: number;
  overallRank: number;
  positionRank: number;
  /** 30-day movement in raw source units. Positive = rising. */
  trend30Day: number;
  tier: number | null;
  /** Which source produced this, so blended/fallback values stay auditable. */
  source: string;
}

export interface DraftPick {
  /** Stable key: "2027-1-3" (season, round, original roster). */
  id: string;
  season: string;
  round: number;
  /** Roster that originally owned the pick. */
  originalRosterId: number;
  /** Roster that holds it now. */
  ownerRosterId: number;
  /** League-adjusted, on the same scale as `PlayerValue.value`. */
  value: number;
  /**
   * The figure fairness is argued on, comparable to `PlayerValue.marketValue`.
   *
   * Not the raw source quote: the rookie-pick realism curve is applied here as
   * well as to `value`. That is deliberate. The curve corrects a market that
   * overprices late picks, and applying it to only the league-adjusted side
   * would let the engine hand over third-rounders that "balance" a trade while
   * costing it nothing. The consequence to be aware of is that a third-rounder
   * shows far below what KeepTradeCut would quote for it.
   */
  marketValue: number;
  /** Draft slot of the original owner: the real one when known, else projected. */
  slot: number | null;
  /**
   * True when `slot` came from the platform's published draft order rather
   * than from a projection. Worth distinguishing: leagues set rookie order by
   * lottery or by decree as often as by standings, so a projection can be
   * confidently wrong in a way the published order never is.
   */
  slotKnown: boolean;
  /** Display label, e.g. "2027 1st (via Ben)". */
  label: string;
}

export interface LeagueSettings {
  /** Sleeper: settings.type 0=redraft, 1=keeper, 2=dynasty. */
  isDynasty: boolean;
  teamCount: number;
  /** Points per reception: 1 = PPR, 0.5 = half, 0 = standard. */
  ppr: number;
  /** 2 when the lineup has a SUPER_FLEX slot, else 1. Drives QB valuation. */
  numQbs: number;
  /** Starting slots in order, bench excluded. */
  startingSlots: LineupSlot[];
  /** Full roster_positions including bench, for roster-size math. */
  allSlots: LineupSlot[];
  taxiSlots: number;
  reserveSlots: number;
  /** Rookie draft rounds — how many picks per team per year exist to trade. */
  draftRounds: number;
  /**
   * First week of the playoffs. The regular season is every week before it.
   *
   * The number that decides how much season is left to simulate, and therefore
   * how much a trade can still change. Sleeper's default is 15.
   */
  playoffWeekStart: number;
  /** How many teams make the playoffs. Sleeper's default is 6. */
  playoffTeams: number;
}

/**
 * One head-to-head fixture.
 *
 * `rosterIds` carries no home/away meaning — fantasy has no home field, and
 * inventing one would imply an advantage the scoring does not give.
 */
export interface Matchup {
  week: number;
  rosterIds: [number, number];
  /**
   * What each roster scored, aligned with `rosterIds`, or null if the week has
   * not been played.
   *
   * Carried because it is the only record of how this league actually scores.
   * The simulation's two assumptions — how far apart good and bad lineups
   * finish, and how much a single week bounces — are guesses until they are
   * measured against real weeks, and these are those weeks.
   */
  points: [number, number] | null;
}

export interface Roster {
  rosterId: number;
  /** Null for orphan teams with no current owner. */
  ownerId: string | null;
  teamName: string;
  ownerName: string;
  avatar: string | null;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  /** Every player on the roster, including taxi and IR. */
  playerIds: string[];
  /** Ordered to match `LeagueSettings.startingSlots`. Empty slots are omitted. */
  starterIds: string[];
  taxiIds: string[];
  reserveIds: string[];
}

export interface League {
  id: string;
  platform: 'sleeper' | 'mfl' | 'fleaflicker';
  name: string;
  season: string;
  status: string;
  avatar: string | null;
  settings: LeagueSettings;
  rosters: Roster[];
}

// ---------------------------------------------------------------------------
// Trade analysis — consumed from Phase 2 onward.
// ---------------------------------------------------------------------------

export interface TradeSideResult {
  rosterId: number;
  teamName: string;
  outgoingPlayers: Player[];
  outgoingPicks: DraftPick[];
  incomingPlayers: Player[];
  incomingPicks: DraftPick[];
  /** Raw market value shipped out and brought in. */
  outgoingValue: number;
  incomingValue: number;
  /** incoming - outgoing. The number every other calculator stops at. */
  netValue: number;
  /** Best-lineup strength on the win-now scale, before and after the trade. */
  starterValueBefore: number;
  starterValueAfter: number;
  /**
   * Change in best-lineup strength — value over replacement starter.
   *
   * This, not netValue, decides whether a trade actually helps. Winning a trade
   * on raw value while downgrading your starting lineup is a real and common
   * outcome, and it is the whole reason this app exists.
   *
   * Measured in win-now units (R8). A lineup is a bet on this season, so a
   * rookie who will not play answers this question with a zero however
   * expensive he is — which is exactly what a dynasty-scaled version of this
   * number could not say.
   */
  vorsDelta: number;
  warnings: string[];
}

export type FairnessRating =
  | 'very_unfair'
  | 'unfair'
  | 'slightly_unfair'
  | 'fair'
  | 'very_fair';

export interface TradeAnalysis {
  sides: [TradeSideResult, TradeSideResult];
  /** Absolute raw-value gap between the two sides. */
  valueDifference: number;
  /** Gap as a share of the larger side, 0-1. */
  valueDifferencePct: number;
  fairnessRating: FairnessRating;
  /** Roster id the raw value favors, or null when it is even. */
  favors: number | null;
  summary: string;
}
