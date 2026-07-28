import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { sleeperProvider } from '../platforms/sleeper';
import { fetchFantasyCalcValues } from '../values/fantasycalc';
import { fetchPickValues } from '../values/dynastyprocess';
import { summarizeRoster, type RosterSummary } from '../engine/rosterValue';
import { buildDraftPicks, tradeableSeasons } from '../engine/picks';
import {
  applyReplacement,
  leagueShrinkFactor,
  replacementLevels,
  startersByPosition,
} from '../engine/replacement';
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

  /**
   * Market values feed one pass of lineups, which reveals how many of each
   * position the league actually starts. That sets replacement level, which
   * produces the league-adjusted values everything downstream runs on.
   *
   * Deliberately a single pass. Re-deriving lineups from adjusted values and
   * looping would chase its own tail for no real gain: replacement subtracts a
   * constant per position, so it almost never reorders who starts.
   */
  const adjusted = useMemo(() => {
    const bundle = leagueQuery.data;
    const market = valuesQuery.data?.bySleeperId;
    if (!bundle || !market) return undefined;

    const marketSummaries = bundle.league.rosters.map((roster) =>
      summarizeRoster(roster, bundle.players, market, bundle.league.settings),
    );
    const levels = replacementLevels(market, startersByPosition(marketSummaries));
    const values = applyReplacement(market, levels);

    return { values, levels, shrink: leagueShrinkFactor(marketSummaries, values) };
  }, [leagueQuery.data, valuesQuery.data]);

  const summaries = useMemo<RosterSummary[]>(() => {
    const bundle = leagueQuery.data;
    if (!bundle || !adjusted) return [];

    return bundle.league.rosters
      .map((roster) =>
        summarizeRoster(roster, bundle.players, adjusted.values, bundle.league.settings),
      )
      .sort((a, b) => b.starterValue - a.starterValue);
  }, [leagueQuery.data, adjusted]);

  const picks = useMemo<DraftPick[]>(() => {
    const bundle = leagueQuery.data;
    const table = pickValuesQuery.data;
    if (!bundle || !table || !adjusted) return [];

    const seasons = tradeableSeasons(bundle.currentSeason, table.seasons);
    // Rookie order is the reverse of the standings, so the weakest roster picks
    // first. `summaries` is sorted strongest-first.
    const worstFirst = [...summaries].reverse().map((s) => s.rosterId);

    return buildDraftPicks(
      bundle.league,
      bundle.tradedPicks,
      seasons,
      table,
      worstFirst,
      adjusted.shrink,
    );
  }, [leagueQuery.data, pickValuesQuery.data, adjusted, summaries]);

  return {
    league: leagueQuery.data?.league,
    players: leagueQuery.data?.players,
    values: adjusted?.values,
    replacement: adjusted?.levels,
    summaries,
    picks,
    picksUnavailable: pickValuesQuery.isError,
    isLoading: leagueQuery.isLoading || valuesQuery.isLoading,
    error: leagueQuery.error ?? valuesQuery.error,
  };
}
