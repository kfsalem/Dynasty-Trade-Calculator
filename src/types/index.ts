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

export const BENCH_SLOTS: LineupSlot[] = ['BN', 'IR', 'TAXI'];

export interface InjuryStatus {
  status: 'healthy' | 'questionable' | 'doubtful' | 'out' | 'ir' | 'pup' | 'sus';
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

/** A player's market value under a specific league configuration. */
export interface PlayerValue {
  playerId: string;
  /** Dynasty value, normalized to a 0-10000 scale. */
  value: number;
  redraftValue: number;
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
  /** Normalized to the same 0-10000 scale as player values. */
  value: number;
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
  starterValueBefore: number;
  starterValueAfter: number;
  /**
   * Change in best-lineup strength — value over replacement starter.
   *
   * This, not netValue, decides whether a trade actually helps. Winning a trade
   * on raw value while downgrading your starting lineup is a real and common
   * outcome, and it is the whole reason this app exists.
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
