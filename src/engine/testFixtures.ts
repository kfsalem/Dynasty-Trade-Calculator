import type {
  DraftPick,
  League,
  LeagueSettings,
  LineupSlot,
  Player,
  PlayerValue,
  Position,
  Roster,
} from '../types';

/** Shared fixtures for engine tests. */

export function makePlayer(
  id: string,
  position: Position,
  age: number | null = 25,
): Player {
  return {
    id,
    name: `Player ${id}`,
    position,
    team: 'FA',
    age,
    yearsExp: 3,
    platformIds: { sleeper: id },
  };
}

export function makeValue(
  id: string,
  value: number,
  position: Position | null = null,
  marketValue = value,
): PlayerValue {
  return {
    playerId: id,
    position,
    value,
    marketValue,
    redraftValue: value,
    overallRank: 1,
    positionRank: 1,
    trend30Day: 0,
    tier: 1,
    source: 'test',
  };
}

export function makePick(
  id: string,
  season: string,
  round: number,
  originalRosterId: number,
  value: number,
  overrides: Partial<DraftPick> = {},
): DraftPick {
  return {
    id,
    season,
    round,
    originalRosterId,
    ownerRosterId: originalRosterId,
    value,
    marketValue: value,
    slot: null,
    label: `${season} round ${round}`,
    ...overrides,
  };
}

export function makeRoster(rosterId: number, playerIds: string[]): Roster {
  return {
    rosterId,
    ownerId: `u${rosterId}`,
    teamName: `Team ${rosterId}`,
    ownerName: `Owner ${rosterId}`,
    avatar: null,
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: 0,
    playerIds,
    starterIds: [],
    taxiIds: [],
    reserveIds: [],
  };
}

export function makeSettings(
  startingSlots: LineupSlot[],
  overrides: Partial<LeagueSettings> = {},
): LeagueSettings {
  return {
    isDynasty: true,
    teamCount: 2,
    ppr: 1,
    numQbs: startingSlots.includes('SUPER_FLEX') ? 2 : 1,
    startingSlots,
    allSlots: [...startingSlots, 'BN', 'BN', 'BN', 'BN', 'BN', 'BN'],
    taxiSlots: 0,
    reserveSlots: 0,
    draftRounds: 2,
    ...overrides,
  };
}

export function makeLeague(rosters: Roster[], settings: LeagueSettings): League {
  return {
    id: 'test',
    platform: 'sleeper',
    name: 'Test League',
    season: '2026',
    status: 'in_season',
    avatar: null,
    settings,
    rosters,
  };
}
