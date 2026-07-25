export interface Player {
  id: string;
  name: string;
  position: Position;
  team: string;
  age: number;
  dynastyValue: number;
  redraftValue: number;
  trend: 'up' | 'down' | 'stable';
  tier: number;
  rookie?: boolean;
  injury?: {
    status: 'healthy' | 'questionable' | 'doubtful' | 'out' | 'ir';
    description?: string;
  };
}

export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DST';

export interface TradeAnalysis {
  team1: {
    players: Player[];
    totalValue: number;
    averageAge: number;
    positionBreakdown: Record<Position, number>;
  };
  team2: {
    players: Player[];
    totalValue: number;
    averageAge: number;
    positionBreakdown: Record<Position, number>;
  };
  valueDifference: number;
  fairnessRating: 'very_unfair' | 'unfair' | 'slightly_unfair' | 'fair' | 'very_fair';
  recommendation: string;
  warnings: string[];
}

export interface TradeSettings {
  leagueType: 'dynasty' | 'redraft';
  scoringType: 'ppr' | 'half_ppr' | 'standard';
  teamCount: number;
  startingLineup: {
    QB: number;
    RB: number;
    WR: number;
    TE: number;
    FLEX: number;
    K: number;
    DST: number;
  };
  rosterSize: number;
}

export interface Team {
  id: string;
  name: string;
  players: Player[];
}
