import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { sleeperProvider } from '../platforms/sleeper';
import { fetchFantasyCalcValues } from '../values/fantasycalc';
import { fetchPickValues } from '../values/dynastyprocess';
import { summarizeRoster, type RosterSummary } from '../engine/rosterValue';
import { buildDraftPicks, tradeableSeasons } from '../engine/picks';
import type { DraftPick, LeagueSettings } from '../types';

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

export function usePickValues(settings: LeagueSettings | undefined) {
  return useQuery({
    queryKey: ['pickValues', settings?.numQbs],
    queryFn: () => fetchPickValues(settings as LeagueSettings),
    enabled: Boolean(settings),
    staleTime: 60 * 60 * 1000,
    // Picks are a real part of dynasty value but not worth blocking the whole
    // app over — the UI degrades to players-only if this fails.
    retry: 1,
  });
}

export function useLeagueSummaries(leagueId: string | null) {
  const leagueQuery = useLeague(leagueId);
  const settings = leagueQuery.data?.league.settings;
  const valuesQuery = useValues(settings);
  const pickValuesQuery = usePickValues(settings);

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

  const picks = useMemo<DraftPick[]>(() => {
    const bundle = leagueQuery.data;
    const table = pickValuesQuery.data;
    if (!bundle || !table) return [];

    const seasons = tradeableSeasons(bundle.currentSeason, table.seasons);
    return buildDraftPicks(bundle.league, bundle.tradedPicks, seasons, table);
  }, [leagueQuery.data, pickValuesQuery.data]);

  return {
    league: leagueQuery.data?.league,
    players: leagueQuery.data?.players,
    values: valuesQuery.data?.bySleeperId,
    summaries,
    picks,
    picksUnavailable: pickValuesQuery.isError,
    isLoading: leagueQuery.isLoading || valuesQuery.isLoading,
    error: leagueQuery.error ?? valuesQuery.error,
  };
}
