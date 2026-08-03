import type {
  League,
  LeagueSettings,
  LineupSlot,
  Player,
  Position,
  Roster,
  InjuryStatus,
} from '../../types';
import type { SlimPlayer } from './client';
import type { SleeperLeague, SleeperRoster, SleeperUser } from './schema';

const POSITIONS = new Set<Position>(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
const BENCH = new Set(['BN', 'IR', 'TAXI']);

/** Sleeper uses "0" as a placeholder for an unfilled starting slot. */
const isRealPlayerId = (id: string): boolean => id !== '0' && id.trim() !== '';

export function avatarUrl(avatar: string | null | undefined): string | null {
  return avatar ? `https://sleepercdn.com/avatars/thumbs/${avatar}` : null;
}

/**
 * Sleeper's `injury_status`, canonicalised.
 *
 * Two of these are not injuries. `DNR` is the reserve/did-not-report list and
 * `NA` marks a player who is not on an active NFL roster; Sleeper reports both
 * in the same field, and both mean the man cannot play. They were missing here
 * until R9, when the real league turned out to roster a receiver whose only
 * designation is `DNR` — dropped on the floor by the old map, and therefore
 * started every week by a model that had just learned to bench injured players.
 */
const KNOWN_STATUS: Record<string, InjuryStatus['status']> = {
  questionable: 'questionable',
  doubtful: 'doubtful',
  out: 'out',
  ir: 'ir',
  pup: 'pup',
  sus: 'sus',
  dnr: 'dnr',
  na: 'na',
};

/**
 * An unrecognised status is kept rather than discarded, carrying its raw text.
 *
 * Returning `undefined` for a word we do not know reports the player as
 * perfectly healthy, which is a claim, and a wrong one — Sleeper adds
 * designations without asking. `unknown` is treated as week-to-week by
 * `engine/availability`, so an unfamiliar word shows on the row and changes no
 * arithmetic, which is the right amount of trust to place in it.
 */
function mapInjury(status: string | null): InjuryStatus | undefined {
  if (!status?.trim()) return undefined;
  const normalized = status.trim().toLowerCase();
  return { status: KNOWN_STATUS[normalized] ?? 'unknown', description: status };
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
    draftRounds: league.settings?.draft_rounds ?? 4,
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
