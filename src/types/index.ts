/**
 * Canonical domain model.
 *
 * Everything downstream of `platforms/` speaks these types. Platform adapters
 * (Sleeper, later MFL/Fleaflicker) map their own shapes into this, so no UI or
 * engine code ever knows which site a league came from.
 */

export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF';

/**
 * Where the NFL calendar currently stands.
 *
 * Carried because a week number on its own does not say what it counts.
 * Sleeper's `/state/nfl` reports week 2 in the middle of August, meaning the
 * second week of *preseason* — and read as a regular-season week that quietly
 * deleted the first two weeks of the schedule from the playoff simulation. A
 * week is only a week once the phase says which season it belongs to.
 *
 * `unknown` is for a platform that does not publish a phase, and is treated
 * everywhere as "take the week at face value", which is what this app did
 * before the field existed.
 */
export type SeasonPhase = 'pre' | 'regular' | 'post' | 'off' | 'unknown';

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
  /**
   * Bench spots, counted from `roster_positions` rather than assumed.
   *
   * A league with 7 bench spots and one with 20 value depth completely
   * differently: the first cannot hold a prospect without cutting somebody,
   * the second can stash a whole rookie class. The count was always implicit
   * in `allSlots` — `rosterCap` has read it all along — but never named, so
   * nothing that reasons about depth could ask the question directly.
   */
  benchSlots: number;
  taxiSlots: number;
  /**
   * Seasons a player may be held on the taxi squad. 0 when the league has no
   * taxi squad, and also when it has one with no year limit — read it only
   * alongside `taxiSlots`.
   */
  taxiYears: number;
  /** Whether veterans may occupy a taxi slot, rather than rookies only. */
  taxiAllowVets: boolean;
  reserveSlots: number;
  /**
   * Which injury designations may legally occupy a reserve slot.
   *
   * #9 decided *availability* from the NFL designation rather than from the
   * manager's IR slot, deliberately and correctly — a player on IR is out
   * whether or not his manager stashed him. This is the other question:
   * whether a roster can park him somewhere that does not cost a bench spot,
   * which is what decides the price of holding an injured asset.
   */
  reserveAllows: ReserveEligibility;
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
  /**
   * Bracket shape, as the platform's own codes.
   *
   * Carried rather than named. The app has only ever seen `0` for all three —
   * four seasons of the test league — so translating the other values into
   * words would be inventing meanings for numbers nobody here has observed.
   * #52's standings rule needs the raw codes; it can name them when it has a
   * league that uses one.
   */
  playoffType: number | null;
  playoffRoundType: number | null;
  playoffSeedType: number | null;
  /**
   * Whether draft picks may be traded at all.
   *
   * Some leagues switch this off, and every suggestion built with a pick in it
   * is then *illegal* rather than merely unappealing — `balancePackage` closes
   * uneven offers with a pick by default, so this was the setting that turned
   * silently-wrong output into the visible kind.
   */
  pickTrading: boolean;
  /** Whether the league permits trades at all. */
  tradesDisabled: boolean;
  /**
   * Last week trades are allowed, or null when trading never closes.
   *
   * Null covers both the league that publishes no deadline and the one that
   * publishes a week past the end of the season — Sleeper stores "no deadline"
   * as `99`, verified across four seasons of the test league. Rather than
   * guessing which large numbers are sentinels, any week beyond the NFL
   * regular season is read as "never binds", which is the same answer for both
   * and cannot be wrong about a deadline that could actually arrive.
   */
  tradeDeadline: number | null;
  /**
   * Best ball: lineups are scored optimally after the fact.
   *
   * There is no lineup to set, so the weekly start/sit panel is not merely
   * unhelpful here — it answers a question the league does not ask.
   */
  bestBall: boolean;
  /**
   * Whether every team also plays the league median each week.
   *
   * Parsed and surfaced, not simulated. #13's playoff model is head-to-head,
   * and a median match materially changes the variance it rests on; saying so
   * is honest, and quietly reporting head-to-head odds for a league that does
   * not play head-to-head is not.
   */
  medianMatch: boolean;
  waivers: WaiverSettings;
}

/**
 * Which injury designations may legally occupy a reserve slot.
 *
 * Sleeper publishes one flag per designation. `cov` is the COVID list, which
 * still ships in the settings payload and which the app's own `InjuryStatus`
 * has no member for — kept here because the league's rules are the league's
 * rules whether or not the designation is still issued.
 */
export interface ReserveEligibility {
  out: boolean;
  doubtful: boolean;
  na: boolean;
  sus: boolean;
  dnr: boolean;
  cov: boolean;
}

/**
 * How the league adds free agents. Parsed for #47, which is what will read it.
 */
export interface WaiverSettings {
  /**
   * Sleeper's raw code. `2` is FAAB — verified against the test league, which
   * runs a $100 budget alongside it. The two non-FAAB modes have never been
   * observed by this app, so they are carried as the number rather than given
   * names that would be guesses.
   */
  type: number | null;
  /** FAAB budget, when the league runs one; null when it does not. */
  budget: number | null;
  /**
   * Smallest legal bid. Null when absent — and it *is* absent: Sleeper omits
   * the key entirely in all four seasons of the test league, which is why it
   * cannot be read as a number with a zero default.
   */
  minBid: number | null;
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
  /**
   * The lineup the manager has actually set, one entry per starting slot and
   * aligned to `LeagueSettings.startingSlots`. `null` is a slot left empty.
   *
   * Positional, and that is the point. This was a plain id list with the empty
   * slots stripped out, which is the same data minus the only thing that makes
   * it answerable: *which* slot a man is in. "You have nobody at TE" and "your
   * flex is empty" are different sentences, and a compacted list cannot tell
   * them apart — nor can it say which slot to put a benched starter into.
   *
   * Distinct from `RosterSummary.starterIds`, which is the lineup this app
   * would field. This one is what the platform reports, mistakes and all; the
   * gap between them is what `engine/startSit` reports.
   */
  setLineup: (string | null)[];
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
