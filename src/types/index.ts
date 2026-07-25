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
  season: string;
  round: number;
  /** Roster that originally owned the pick. */
  originalRosterId: number;
  /** Roster that holds it now. */
  ownerRosterId: number;
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

export interface TradeSide {
  rosterId: number;
  players: Player[];
  picks: DraftPick[];
  totalValue: number;
  averageAge: number;
  positionBreakdown: Partial<Record<Position, number>>;
  /**
   * Change in starting-lineup strength — value over replacement starter.
   * This, not `totalValue`, is what makes a trade good or bad for a team.
   */
  vorsDelta: number;
}

export interface TradeAnalysis {
  sides: [TradeSide, TradeSide];
  valueDifference: number;
  fairnessRating: 'very_unfair' | 'unfair' | 'slightly_unfair' | 'fair' | 'very_fair';
  recommendation: string;
  warnings: string[];
}
