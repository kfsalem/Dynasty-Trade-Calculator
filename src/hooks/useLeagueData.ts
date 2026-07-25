import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { sleeperProvider } from '../platforms/sleeper';
import { fetchFantasyCalcValues } from '../values/fantasycalc';
import { summarizeRoster, type RosterSummary } from '../engine/rosterValue';
import type { LeagueSettings } from '../types';

export function useLeague(leagueId: string | null) {
  return useQuery({
    queryKey: ['league', leagueId],
    queryFn: () => sleeperProvider.loadLeague(leagueId as string),
    enabled: Boolean(leagueId),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useValues(settings: LeagueSettings | undefined) {
  return useQuery({
    queryKey: [
      'values',
      settings?.isDynasty,
      settings?.numQbs,
      settings?.teamCount,
      settings?.ppr,
    ],
    queryFn: () => fetchFantasyCalcValues(settings as LeagueSettings),
    enabled: Boolean(settings),
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
}

/**
 * Compose a league with its values into per-roster summaries, ranked by the
 * strength of the best lineup each roster can field.
 */
export function useLeagueSummaries(leagueId: string | null) {
  const leagueQuery = useLeague(leagueId);
  const valuesQuery = useValues(leagueQuery.data?.league.settings);

  const summaries = useMemo<RosterSummary[]>(() => {
    const bundle = leagueQuery.data;
    const values = valuesQuery.data?.bySleeperId;
    if (!bundle || !values) return [];

    return bundle.league.rosters
      .map((roster) =>
        summarizeRoster(roster, bundle.players, values, bundle.league.settings),
      )
      .sort((a, b) => b.starterValue - a.starterValue);
  }, [leagueQuery.data, valuesQuery.data]);

  return {
    league: leagueQuery.data?.league,
    players: leagueQuery.data?.players,
    summaries,
    isLoading: leagueQuery.isLoading || valuesQuery.isLoading,
    error: leagueQuery.error ?? valuesQuery.error,
  };
}
