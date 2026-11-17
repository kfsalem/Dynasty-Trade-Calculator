import type { Manager, Roster } from '../types';

/**
 * Who manages a team, and which of them is using the app (#161).
 *
 * A Sleeper team can have co-owners as well as an owner. Each has the league
 * in his own league list, so any of them can be the person who claimed it,
 * and "the claimed team's owner" is not the same as "the visitor".
 */

/** Whether this user manages the team, as its owner or as a co-owner. */
export const ownsRoster = (roster: Roster, userId: string): boolean =>
  roster.ownerId === userId || roster.coOwners.some((m) => m.id === userId);

/** The team's managers, owner first. An orphan team may have none. */
export function managersOf(roster: Roster): Manager[] {
  const owner = roster.ownerId ? [{ id: roster.ownerId, name: roster.ownerName }] : [];
  return [...owner, ...roster.coOwners];
}

/**
 * Which of the team's managers is the visitor, or null when it can't be told.
 *
 * `known` is a user id the app was given: a username typed to claim the team,
 * the user whose league list it was opened from, or an answer to "which one
 * are you?". It counts only while that user still manages the team. Without
 * it, a team with one manager is his, and a team with several needs asking:
 * guessing the owner would list somebody else's leagues as the visitor's.
 */
export function whoIsMe(roster: Roster, known: string | null): string | null {
  if (known && ownsRoster(roster, known)) return known;
  const managers = managersOf(roster);
  return managers.length === 1 ? managers[0].id : null;
}
