import type { LeagueBundle, WeekProjections } from '../platforms/types';
import type { InjuryStatus, Player } from '../types';

/**
 * The league's players with this week's injury designations (#184).
 *
 * The player index is cached for a day, because Sleeper asks to be called no
 * more often than that, and a day is long enough to miss a Saturday-night
 * ruling: the starter reads as healthy on Sunday morning and the lineup panel
 * keeps him in. The projections are refetched every half hour and carry the
 * same designation, so where they disagree with the index, they win, including
 * when they say a designation has lifted.
 *
 * Applied to the whole bundle rather than to the lineup panel alone, so a man
 * reads the same on every tab. Values do not move: a designation decides who
 * can start (`engine/availability`), never what anyone is worth.
 *
 * Hands back the bundle it was given when nothing differs, which is most loads,
 * so nothing downstream recomputes for an overlay that changed nobody.
 */
export function withFreshInjuries(
  bundle: LeagueBundle | undefined,
  projections: WeekProjections | undefined,
): LeagueBundle | undefined {
  if (!bundle || !projections) return bundle;
  const players = freshen(bundle.players, projections);
  const freeAgents = freshen(bundle.freeAgents, projections);
  if (players === bundle.players && freeAgents === bundle.freeAgents) return bundle;
  return { ...bundle, players, freeAgents };
}

const same = (a: InjuryStatus | undefined, b: InjuryStatus | undefined) =>
  a?.status === b?.status && a?.description === b?.description;

function freshen(
  players: Map<string, Player>,
  projections: WeekProjections,
): Map<string, Player> {
  let out: Map<string, Player> | null = null;
  for (const [id, player] of players) {
    const fresh = projections.get(id)?.injury;
    // Undefined: the projection did not say, so the index stands.
    if (fresh === undefined) continue;
    const injury = fresh ?? undefined;
    if (same(player.injury, injury)) continue;
    out ??= new Map(players);
    out.set(id, { ...player, injury });
  }
  return out ?? players;
}
