import type { LineupSlot, Roster } from '../types';
import type { RosterSummary } from './rosterValue';
import { startSit } from './startSit';

/**
 * What a roster *can* field against what its manager has actually set.
 *
 * Every headline number in this app is computed on the first of those.
 * `summarizeRoster` builds `bestLineup` rather than reading the platform's
 * starters, deliberately and for good reasons — "for valuation we want what the
 * roster *can* start" — and `starterValue` is what the contention quadrants,
 * the league rankings and every trade's VORS delta are measured in.
 *
 * That makes the grade a claim about a **roster**, which is a true and useful
 * thing to be. The failure is that nothing on screen said so, and a manager
 * reading "3rd in the league" reasonably believes it describes the team he is
 * putting on the field. If his lineup is stale he is being graded on eleven men
 * he is not starting, and the app was silent about the difference.
 *
 * Both numbers here come straight out of `startSit`, which already computes
 * them for the lineup panel. Nothing re-derives what "can play this week" means
 * — a second copy of that rule is how the panel and this sentence would come to
 * disagree about the same roster on the same Sunday.
 */
export interface FieldedLineup {
  rosterId: number;
  /** The best lineup available this week, byes and injuries applied. */
  ceiling: number;
  /** What the manager has set, counted on the same convention. */
  fielded: number;
  /**
   * No lineup to compare against — none published, or none this app can align
   * to the league's slots. `StartSitPlan.unset`, unchanged.
   */
  unset: boolean;
}

/** One team's place on both counts. */
export interface FieldedStanding {
  ceiling: number;
  fielded: number;
  /** Ceiling less fielded, and zero when the lineup is already best. */
  gap: number;
  /** 1 is the best ceiling in the league. Every team has one. */
  ceilingRank: number;
  /**
   * 1 is the most value actually being fielded — among teams that set a lineup.
   *
   * Restricted to those on purpose. A team with nothing published is not
   * fielding zero, it is unknown, and letting it sit at the bottom of this
   * ranking would flatter everyone above it by exactly the amount the app does
   * not know. `ranked` says how many teams the number is really out of.
   */
  fieldedRank: number;
  /** How many teams have a lineup to be ranked on. */
  ranked: number;
  teamCount: number;
  /** This team is the one with no lineup published. */
  unset: boolean;
}

/**
 * Run the lineup comparison for every roster in the league.
 *
 * `startSit` is called whole rather than reimplemented for its two totals. It
 * does more than is needed here — it arranges, diffs and groups the changes —
 * and that is the right trade: it is the one place that decides what a roster
 * can field this week, and the cost is a handful of milliseconds for a league.
 */
export function leagueFielded(
  rosters: Roster[],
  summaries: RosterSummary[],
  startingSlots: LineupSlot[],
  byeTeams: ReadonlySet<string> | null,
): FieldedLineup[] {
  const byId = new Map(rosters.map((roster) => [roster.rosterId, roster]));

  return summaries.map((summary) => {
    const roster = byId.get(summary.rosterId);
    const plan = startSit({
      entries: summary.players,
      startingSlots,
      setLineup: roster?.setLineup ?? [],
      byeTeams,
    });

    return {
      rosterId: summary.rosterId,
      ceiling: plan.recommendedValue,
      fielded: plan.setValue,
      unset: plan.unset,
    };
  });
}

/** Where one team stands on both counts, or null when it is not in the league. */
export function fieldedStanding(
  rosterId: number,
  all: FieldedLineup[],
): FieldedStanding | null {
  const mine = all.find((team) => team.rosterId === rosterId);
  if (!mine) return null;

  const set = all.filter((team) => !team.unset);

  return {
    ceiling: mine.ceiling,
    fielded: mine.fielded,
    /*
      Floored at zero. A set lineup is a legal selection from the same pool the
      recommendation is chosen out of, so it cannot be worth more — but the
      platform's starters are mapped from outside this app, and a lineup that
      arrived misaligned should read as "nothing to fix" rather than as a
      negative shortfall printed on the page.
    */
    gap: Math.max(mine.ceiling - mine.fielded, 0),
    ceilingRank: all.filter((team) => team.ceiling > mine.ceiling).length + 1,
    fieldedRank: mine.unset
      ? 0
      : set.filter((team) => team.fielded > mine.fielded).length + 1,
    ranked: set.length,
    teamCount: all.length,
    unset: mine.unset,
  };
}
