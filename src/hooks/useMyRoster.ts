import { useCallback, useEffect, useState } from 'react';

/**
 * Which roster belongs to the person using the app.
 *
 * Keyed per league, so following several leagues doesn't cross wires. This is
 * the whole "profile" — no account, no backend. Everything personalized in the
 * app (team analysis, trade suggestions, second-person warnings) hangs off it.
 */
const keyFor = (leagueId: string) => `dynasty:myRoster:${leagueId}`;

function read(leagueId: string | null): number | null {
  if (!leagueId) return null;
  try {
    const raw = localStorage.getItem(keyFor(leagueId));
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isInteger(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function useMyRoster(leagueId: string | null) {
  const [myRosterId, setState] = useState<number | null>(() => read(leagueId));

  // Switching leagues must re-read rather than carry the previous league's
  // roster id, which would point at an unrelated team.
  useEffect(() => {
    setState(read(leagueId));
  }, [leagueId]);

  const setMyRoster = useCallback(
    (rosterId: number | null) => {
      setState(rosterId);
      if (!leagueId) return;
      try {
        if (rosterId === null) localStorage.removeItem(keyFor(leagueId));
        else localStorage.setItem(keyFor(leagueId), String(rosterId));
      } catch {
        // Storage disabled — the claim just won't survive a reload.
      }
    },
    [leagueId],
  );

  return { myRosterId, setMyRoster };
}
