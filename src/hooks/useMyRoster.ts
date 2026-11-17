import { useCallback, useEffect, useState } from 'react';

/**
 * Which roster belongs to the person using the app, and, when it is known,
 * which of its managers he is.
 *
 * Keyed per league, so following several leagues doesn't cross wires. This is
 * the whole "profile" — no account, no backend. Everything personalized in the
 * app (team analysis, trade suggestions, second-person warnings) hangs off it.
 *
 * The user id matters only for a team with co-owners (#161): the roster says
 * whose team it is, and the user id says whose leagues to list beside it. It is
 * kept in its own key so a claim saved before it existed reads as it did.
 */
const rosterKey = (leagueId: string) => `dynasty:myRoster:${leagueId}`;
const userKey = (leagueId: string) => `dynasty:myUser:${leagueId}`;

function readRoster(leagueId: string | null): number | null {
  if (!leagueId) return null;
  try {
    const raw = localStorage.getItem(rosterKey(leagueId));
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isInteger(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readUser(leagueId: string | null): string | null {
  if (!leagueId) return null;
  try {
    return localStorage.getItem(userKey(leagueId)) || null;
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage disabled — the claim just won't survive a reload.
  }
}

export function useMyRoster(leagueId: string | null) {
  const [myRosterId, setRosterState] = useState<number | null>(() => readRoster(leagueId));
  const [myUserId, setUserState] = useState<string | null>(() => readUser(leagueId));

  // Switching leagues must re-read rather than carry the previous league's
  // roster id, which would point at an unrelated team.
  useEffect(() => {
    setRosterState(readRoster(leagueId));
    setUserState(readUser(leagueId));
  }, [leagueId]);

  /** Claim a team, or none. `userId` is who claimed it, when that is known. */
  const setMyRoster = useCallback(
    (rosterId: number | null, userId: string | null = null) => {
      setRosterState(rosterId);
      setUserState(rosterId === null ? null : userId);
      if (!leagueId) return;
      write(rosterKey(leagueId), rosterId === null ? null : String(rosterId));
      write(userKey(leagueId), rosterId === null ? null : userId);
    },
    [leagueId],
  );

  /** Say which of the claimed team's managers the visitor is. */
  const setMyUser = useCallback(
    (userId: string) => {
      setUserState(userId);
      if (leagueId) write(userKey(leagueId), userId);
    },
    [leagueId],
  );

  return { myRosterId, myUserId, setMyRoster, setMyUser };
}
