import type { SeasonPhase } from '../types';

/**
 * The week counter, read as a position in the *regular* season.
 *
 * A platform reports one week number and reuses it for every phase of the
 * calendar. Sleeper says week 2 in the middle of August and week 2 in the
 * middle of September, and only `season_type` separates them. Anything that
 * asks "how much season is left" has to resolve that ambiguity before it
 * subtracts, and this is the one place that does it.
 *
 * The failure this closes was live and silent: through the preseason the
 * playoff simulation filtered its fixture list to weeks 2 and later, deleting
 * the first two weeks of a season nobody had played yet. Every number it
 * produced still rendered, and none of them were wrong in a way a reader could
 * see.
 *
 * - **pre** — the regular season has not started, so week 1 is next. Everything
 *   remains.
 * - **regular**, **post** — the number means what it says.
 * - **off** — the season is finished. Returns `weekCount + 1`, which is past
 *   the last fixture, so callers find nothing remaining rather than being told
 *   the question cannot be answered. Those are different answers and the UI
 *   says different things about them.
 * - **unknown** — no phase published; take the week at face value, which is
 *   what this app did before it asked.
 *
 * A null week means the platform does not know what week it is, and that
 * survives every phase: guessing one is how a season that has already been
 * played gets simulated.
 */
export function regularSeasonWeek(
  week: number | null,
  phase: SeasonPhase,
  weekCount: number,
): number | null {
  if (week === null) return null;
  switch (phase) {
    case 'pre':
      return 1;
    case 'off':
      return weekCount + 1;
    default:
      return week;
  }
}

/**
 * Is a lineup being set for a game that is about to be played?
 *
 * What the start/sit panel turns on. Out of season there is no next game, so
 * "who should I start this week" has no answer — but "what is the best lineup
 * this roster can field" still does, and the panel says the second thing
 * instead of pretending to the first.
 */
export const isGameWeek = (phase: SeasonPhase): boolean =>
  phase === 'regular' || phase === 'post';
