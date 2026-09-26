/**
 * Which weeks a playoff round was played in (#52).
 *
 * Sleeper's `playoff_round_type`, per its settings: 0 is one week per round,
 * 1 is one week per round with a two-week final, 2 is two weeks per round.
 * Only type 0 has been checked against a live league (the test league's 2025
 * bracket: rounds 1-3 in weeks 15-17). Types 1 and 2 follow Sleeper's stated
 * meaning and are unverified; a league using one should be checked before its
 * playoff scores are trusted.
 */
export function roundWeeks(
  weekStart: number,
  roundType: number | null,
  round: number,
  rounds: number,
): number[] {
  if (roundType === 2) {
    const first = weekStart + (round - 1) * 2;
    return [first, first + 1];
  }
  const week = weekStart + round - 1;
  // A two-week final: the last round spans its week and the next.
  if (roundType === 1 && round === rounds) return [week, week + 1];
  return [week];
}

/** The last week any round of a bracket with `rounds` rounds was played in. */
export function lastPlayoffWeek(weekStart: number, roundType: number | null, rounds: number): number {
  if (rounds <= 0) return weekStart - 1;
  const weeks = roundWeeks(weekStart, roundType, rounds, rounds);
  return weeks[weeks.length - 1];
}
