import { useCallback, useState } from 'react';
import type { StandingsMode } from '../engine/leagueHistory';

const KEY = 'dynasty:standingsMode';

const read = (): StandingsMode => {
  try {
    return localStorage.getItem(KEY) === 'bracket' ? 'bracket' : 'points';
  } catch {
    return 'points';
  }
};

/**
 * How final standings are decided, remembered in this browser (#52).
 *
 * A display preference, so it lives in localStorage beside the league id and
 * the claimed team, per `DESIGN.md` §7 decision 2. Points-based is the
 * default: it works in every league, and the bracket-based rule only where
 * placement games were played.
 */
export function useStandingsMode() {
  const [mode, setMode] = useState<StandingsMode>(read);

  const change = useCallback((next: StandingsMode) => {
    setMode(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Storage refused (private mode): the choice holds for this visit.
    }
  }, []);

  return { mode, setMode: change };
}
