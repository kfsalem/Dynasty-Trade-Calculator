/**
 * The All leagues screen's verdict, in words (#161).
 *
 * The screen adds up the lineup panel's calls across a manager's leagues:
 * decisive changes that start somebody, and waiver claims, because a claim is
 * also something to do before Sunday. A slot nobody on the roster can fill is
 * shown but not counted, since the claim that fills it is the move.
 */

/** What the screen found this week, across every league it could read. */
export interface WeekTally {
  /** Every league the manager is in. */
  leagues: number;
  /** Leagues whose lineup was checked: loaded, team found, not best ball, not an empty roster. */
  checked: number;
  /** Lineup changes that start somebody, summed. */
  changes: number;
  /** Waiver claims it would make, summed. */
  claims: number;
  /** Leagues with at least one of either. */
  withCalls: number;
  /** Starting slots that neither the bench nor the wire can fill this week. */
  unfilled: number;
  /** Leagues that failed to load, or where the manager's team was not found. */
  unchecked: number;
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "all 3", but "both" for two. */
const all = (n: number) => (n === 2 ? 'both' : `all ${n}`);

export function weekHeadline({ checked, changes, claims, unfilled }: WeekTally): string {
  const total = changes + claims;
  if (total > 0) return `${count(total, 'change')} to make`;
  if (unfilled > 0) return `${count(unfilled, 'slot')} nobody can fill`;
  return checked > 0 ? 'Every lineup is set' : 'No lineups to check';
}

export function weekSummary({
  leagues,
  checked,
  changes,
  claims,
  withCalls,
  unfilled,
  unchecked,
}: WeekTally): string {
  const parts: string[] = [];

  if (changes + claims > 0) {
    const what = [
      changes > 0 ? count(changes, 'lineup move') : null,
      claims > 0 ? count(claims, 'waiver claim') : null,
    ]
      .filter(Boolean)
      .join(' and ');
    const where =
      withCalls === leagues ? `${all(leagues)} of your leagues` : `${withCalls} of your ${leagues} leagues`;
    parts.push(`${what}, in ${where}.`);
  } else if (checked > 0 && unfilled === 0) {
    parts.push(
      checked === 1
        ? 'Nothing on the wire or your bench beats the lineup you have set.'
        : `In ${all(checked)} lineups checked, nothing on the wire or your bench beats what you have set.`,
    );
  }

  if (unfilled > 0) {
    parts.push(
      unfilled === 1
        ? "One starting slot can't be filled from your bench or the wire."
        : `${unfilled} starting slots can't be filled from your bench or the wire.`,
    );
  }

  if (unchecked > 0) {
    parts.push(
      unchecked === 1 ? "One league couldn't be checked; it's listed below." : `${unchecked} leagues couldn't be checked; they're listed below.`,
    );
  }

  return parts.join(' ');
}

/**
 * The headline when no games are being played, and so no lineup to set: what
 * the manager's rosters hold in common is then the screen's whole answer.
 */
export function holdingsHeadline(shared: number): string {
  if (shared === 0) return 'No player on more than one roster';
  return `${count(shared, 'player')} on more than one roster`;
}

/** A share of a roster's value, as a whole percentage. A sliver is not "0%". */
export const formatShare = (share: number): string =>
  share > 0 && share < 0.005 ? '<1%' : `${Math.round(share * 100)}%`;
