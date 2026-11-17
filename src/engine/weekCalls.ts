import type { LeagueSettings, Roster } from '../types';
import type { RosterSummary } from './rosterValue';
import type { FreeAgentBoard } from './freeAgents';
import { startSit, type StartSitPlan } from './startSit';
import { wireUpgrades, type WireUpgrade } from './wire';

/**
 * A week's calls for one roster: the lineup changes and the waiver claims.
 *
 * One function for both places that make them, the lineup panel on My team
 * and the All leagues screen (#161). The second promises to show the same calls
 * as the first, and two copies of this wiring would be two places for that
 * promise to break: the wire has to see the lineup the plan recommends, and the
 * same projections, byes and locks, or its comparisons are against a lineup
 * nobody is fielding.
 */
export interface WeekCallsInput {
  roster: Roster;
  summary: RosterSummary;
  settings: LeagueSettings;
  /** The wire as the lineup may use it (`lineupBoard`), when it has loaded. */
  board?: FreeAgentBoard;
  byeTeams?: ReadonlySet<string> | null;
  /** This week's projected points in the league's scoring, when there are any. */
  projected?: ReadonlyMap<string, number>;
  /** NFL teams whose game has kicked off. */
  locked?: ReadonlySet<string> | null;
}

export interface WeekCalls {
  plan: StartSitPlan;
  wire: WireUpgrade[];
}

export function weekCalls({
  roster,
  summary,
  settings,
  board,
  byeTeams,
  projected,
  locked,
}: WeekCallsInput): WeekCalls {
  const plan = startSit({
    entries: summary.players,
    startingSlots: settings.startingSlots,
    setLineup: roster.setLineup,
    byeTeams,
    projected,
    locked,
  });

  const wire = wireUpgrades({
    lineup: plan.lineup,
    entries: summary.players,
    board,
    byeTeams,
    roster,
    activeLimit: settings.allSlots.length,
    projected,
    locked,
  });

  return { plan, wire };
}
