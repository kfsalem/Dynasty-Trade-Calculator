import { useCallback, useEffect, useRef, useState } from 'react';
import type { League, Player, PlayerValue } from '../types';
import type { RosterSummary } from '../engine/rosterValue';
import type { PlayerRole } from '../engine/role';
import { analyzeTeam, type SeasonOdds } from '../engine/analysis';
import {
  changesSince,
  readVisit,
  writeVisit,
  type VisitChange,
  type VisitSnapshot,
} from '../engine/sinceLastVisit';
import { isSampleId } from '../platforms/sleeper/sample';

interface Input {
  leagueId: string | null;
  myRosterId: number | null;
  /**
   * True once My team is on screen with everything it shows. The snapshot is
   * taken then and not before: taking it while the reader is on another tab
   * would mark changes as seen that nobody saw.
   */
  active: boolean;
  league: League | undefined;
  players: Map<string, Player> | undefined;
  values: Map<string, PlayerValue> | undefined;
  summaries: RosterSummary[] | undefined;
  roles: Map<string, PlayerRole> | undefined;
  season: SeasonOdds | undefined;
}

/**
 * The changes to lead My team with on this visit (#167), and the snapshot the
 * next visit compares against.
 *
 * Taken once per league and team per page load. The new snapshot is written in
 * the same breath as the old one is read, so a change is shown on exactly one
 * visit — "gone once seen" — and a reload does not repeat it.
 *
 * Never for the sample league (#159): it is not the visitor's league, and
 * nothing about it is worth remembering on their device.
 */
export function useSinceLastVisit({
  leagueId,
  myRosterId,
  active,
  league,
  players,
  values,
  summaries,
  roles,
  season,
}: Input) {
  const [changes, setChanges] = useState<VisitChange[]>([]);
  const [since, setSince] = useState<string | null>(null);
  const taken = useRef<string | null>(null);

  // A different league or team starts from nothing. Declared before the
  // effect below so that, in the commit where both run, its clearing comes
  // first and the fresh changes win.
  useEffect(() => {
    setChanges([]);
    setSince(null);
  }, [leagueId, myRosterId]);

  useEffect(() => {
    if (!active || !leagueId || myRosterId === null || isSampleId(leagueId)) return;
    if (!league || !players || !values || !summaries) return;
    const key = `${leagueId}:${myRosterId}`;
    if (taken.current === key) return;

    const roster = league.rosters.find((r) => r.rosterId === myRosterId);
    const analysis = analyzeTeam(myRosterId, summaries, league.settings, season);
    if (!roster || !analysis) return;
    taken.current = key;

    const snapshot: VisitSnapshot = {
      version: 1,
      at: new Date().toISOString(),
      rosterId: myRosterId,
      players: Object.fromEntries(
        roster.playerIds.map((id) => [
          id,
          { market: values.get(id)?.marketValue ?? null, role: roles?.get(id)?.role ?? null },
        ]),
      ),
      nowRank: analysis.contention.nowGrade.rank,
      laterRank: analysis.contention.laterGrade.rank,
      teamCount: analysis.contention.nowGrade.teamCount,
    };

    const previous = readVisit(leagueId);
    setChanges(changesSince(previous, snapshot, (id) => players.get(id)?.name ?? 'A player'));
    setSince(previous?.at ?? null);
    writeVisit(leagueId, snapshot);
  }, [active, leagueId, myRosterId, league, players, values, summaries, roles, season]);

  const dismiss = useCallback(() => setChanges([]), []);
  return { changes, since, dismiss };
}
