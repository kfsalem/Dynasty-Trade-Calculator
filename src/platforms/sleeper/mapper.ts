import type {
  League,
  LeagueSettings,
  LineupSlot,
  Player,
  Position,
  Roster,
  InjuryStatus,
} from '../../types';
import type { PlayerIndex, SlimPlayer } from './client';
import type { SleeperLeague, SleeperRoster, SleeperUser } from './schema';

const POSITIONS = new Set<Position>(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
const BENCH = new Set(['BN', 'IR', 'TAXI']);

/** Sleeper uses "0" as a placeholder for an unfilled starting slot. */
const isRealPlayerId = (id: string): boolean => id !== '0' && id.trim() !== '';

export function avatarUrl(avatar: string | null | undefined): string | null {
  return avatar ? `https://sleepercdn.com/avatars/thumbs/${avatar}` : null;
}

function mapInjury(status: string | null): InjuryStatus | undefined {
  if (!status) return undefined;
  const normalized = status.toLowerCase();
  const known: Record<string, InjuryStatus['status']> = {
    questionable: 'questionable',
    doubtful: 'doubtful',
    out: 'out',
    ir: 'ir',
    pup: 'pup',
    sus: 'sus',
  };
  const mapped = known[normalized];
  return mapped ? { status: mapped, description: status } : undefined;
}

export function mapPlayer(p: SlimPlayer): Player | null {
  if (!POSITIONS.has(p.position as Position)) return null;
  return {
    id: p.id,
    name: p.name,
    position: p.position as Position,
    team: p.team,
    age: p.age,
    yearsExp: p.yearsExp,
    injury: mapInjury(p.injuryStatus),
    platformIds: { sleeper: p.id },
  };
}

export function mapSettings(league: SleeperLeague): LeagueSettings {
  const allSlots = league.roster_positions as LineupSlot[];
  const startingSlots = allSlots.filter((s) => !BENCH.has(s));

  return {
    // type 2 is dynasty; 1 is keeper. Treat keeper as dynasty-ish for valuation,
    // since both carry players across seasons.
    isDynasty: (league.settings?.type ?? 0) >= 1,
    teamCount: league.total_rosters || league.settings?.num_teams || 12,
    ppr: league.scoring_settings?.rec ?? 0,
    // A SUPER_FLEX slot is what actually makes QBs scarce, not the QB count.
    numQbs: startingSlots.includes('SUPER_FLEX') ? 2 : 1,
    startingSlots,
    allSlots,
    taxiSlots: league.settings?.taxi_slots ?? 0,
    reserveSlots: league.settings?.reserve_slots ?? 0,
  };
}

export function mapLeague(
  league: SleeperLeague,
  rosters: SleeperRoster[],
  users: SleeperUser[],
): League {
  const usersById = new Map(users.map((u) => [u.user_id, u]));

  const mapped: Roster[] = rosters.map((r) => {
    const user = r.owner_id ? usersById.get(r.owner_id) : undefined;
    const ownerName = user?.display_name ?? 'Orphan team';
    const fpts = (r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100;

    return {
      rosterId: r.roster_id,
      ownerId: r.owner_id ?? null,
      // Custom team names are optional on Sleeper; most managers never set one.
      teamName: user?.metadata?.team_name?.trim() || ownerName,
      ownerName,
      avatar: avatarUrl(user?.avatar),
      wins: r.settings?.wins ?? 0,
      losses: r.settings?.losses ?? 0,
      ties: r.settings?.ties ?? 0,
      pointsFor: fpts,
      playerIds: (r.players ?? []).filter(isRealPlayerId),
      starterIds: (r.starters ?? []).filter(isRealPlayerId),
      taxiIds: (r.taxi ?? []).filter(isRealPlayerId),
      reserveIds: (r.reserve ?? []).filter(isRealPlayerId),
    };
  });

  return {
    id: league.league_id,
    platform: 'sleeper',
    name: league.name,
    season: league.season,
    status: league.status,
    avatar: avatarUrl(league.avatar),
    settings: mapSettings(league),
    rosters: mapped.sort((a, b) => a.rosterId - b.rosterId),
  };
}

/** Resolve a roster's player ids into full players, dropping anything unknown. */
export function resolvePlayers(ids: string[], index: PlayerIndex): Player[] {
  const out: Player[] = [];
  for (const id of ids) {
    const slim = index[id];
    if (!slim) continue;
    const player = mapPlayer(slim);
    if (player) out.push(player);
  }
  return out;
}
