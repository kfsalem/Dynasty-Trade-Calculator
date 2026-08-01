import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { sleeperProvider } from '../platforms/sleeper';
import { fetchFantasyCalcValues } from '../values/fantasycalc';
import { fetchPickValues } from '../values/dynastyprocess';
import type { RosterSummary } from '../engine/rosterValue';
import { buildDraftPicks, tradeableSeasons } from '../engine/picks';
import { pricedPositions, valueLeague, type LeagueActivity } from '../engine/replacement';
import { snapShares } from '../engine/snapShare';
import { opportunities } from '../engine/opportunity';
import { playerRoles } from '../engine/role';
import { roleTrends } from '../engine/roleTrend';
import { fetchDepthCharts, fetchOpportunity, fetchSnapCounts } from '../data/activity';
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

/**
 * Weekly snap shares, from the static file the build-time ingest produces.
 *
 * Never blocks the app: `fetchSnapCounts` returns null rather than throwing, so
 * a missing file costs a column of dashes and nothing else. `staleTime` is
 * infinite because this is a build artifact — it cannot change without a
 * redeploy, and a redeploy reloads the page.
 */
export function useSnapShares() {
  return useQuery({
    queryKey: ['snapCounts'],
    queryFn: fetchSnapCounts,
    staleTime: Infinity,
    retry: 1,
  });
}

/** The current depth chart, reduced to one entry per player. */
export function useDepthCharts() {
  return useQuery({
    queryKey: ['depthCharts'],
    queryFn: fetchDepthCharts,
    staleTime: Infinity,
    retry: 1,
  });
}

/** Target share, air yards, WOPR and carry share, from the same build artifact. */
export function useOpportunity() {
  return useQuery({
    queryKey: ['opportunity'],
    queryFn: fetchOpportunity,
    staleTime: Infinity,
    retry: 1,
  });
}

export function useLeagueSummaries(leagueId: string | null) {
  const leagueQuery = useLeague(leagueId);
  const settings = leagueQuery.data?.league.settings;
  const valuesQuery = useValues(settings);
  const pickValuesQuery = usePickValues(settings);
  const snapsQuery = useSnapShares();
  const opportunityQuery = useOpportunity();
  const depthQuery = useDepthCharts();

  const snaps = useMemo(
    () => (snapsQuery.data ? snapShares(snapsQuery.data) : undefined),
    [snapsQuery.data],
  );

  const usage = useMemo(
    () => (opportunityQuery.data ? opportunities(opportunityQuery.data) : undefined),
    [opportunityQuery.data],
  );

  /**
   * Activity, but only the part of it that describes the season being played.
   *
   * The columns above show whatever the ingest last produced, because a snap
   * share from last November is still worth reading in July. Valuation is
   * stricter: by July the market has had months to price that November, so
   * feeding it back in is the same information twice rather than a signal. A
   * file whose season no longer matches is therefore passed as empty, every
   * factor comes out exactly 1, and the model is what it was before activity
   * existed.
   *
   * The two files are dated independently — the snap ingest can roll to a new
   * season a week before the opportunity ingest does — so each is checked on
   * its own rather than trusting one to speak for both.
   */
  const activity = useMemo<LeagueActivity | undefined>(() => {
    const season = leagueQuery.data?.currentSeason;
    if (!season) return undefined;

    const played = Number(season);
    const snapsLive = snapsQuery.data?.season === played;
    const usageLive = opportunityQuery.data?.season === played;

    return {
      snaps: snapsLive && snaps ? snaps : new Map(),
      usage: usageLive && usage ? usage : new Map(),
      current: snapsLive || usageLive,
    };
  }, [leagueQuery.data, snapsQuery.data, opportunityQuery.data, snaps, usage]);

  /**
   * Market values feed one pass of lineups, which reveals how many of each
   * position the league actually starts. That sets replacement level, which
   * produces the league-adjusted values everything downstream runs on.
   *
   * `valueLeague` then iterates that to a fixed point, because the counts and
   * the values define each other and one pass is not enough. Replacement
   * subtracts a *different* constant per position, which is exactly what flips
   * a FLEX slot from one position to another: on this league the market pass
   * gives RB 26 / WR 33 / TE 11 and the converged answer is RB 22 / WR 35 /
   * TE 13.
   */
  const adjusted = useMemo(() => {
    const bundle = leagueQuery.data;
    const market = valuesQuery.data?.bySleeperId;
    if (!bundle || !market) return undefined;

    return valueLeague(
      bundle.league.rosters,
      bundle.players,
      market,
      bundle.league.settings,
      activity,
    );
  }, [leagueQuery.data, valuesQuery.data, activity]);

  const summaries = useMemo<RosterSummary[]>(
    () => [...(adjusted?.summaries ?? [])].sort((a, b) => b.starterValue - a.starterValue),
    [adjusted],
  );

  const picks = useMemo<DraftPick[]>(() => {
    const bundle = leagueQuery.data;
    const table = pickValuesQuery.data;
    if (!bundle || !table || !adjusted) return [];

    const seasons = tradeableSeasons(bundle.currentSeason, table.seasons, bundle.league);
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
      bundle.draftOrders,
    );
  }, [leagueQuery.data, pickValuesQuery.data, adjusted, summaries]);

  const roles = useMemo(() => {
    const snapFile = snapsQuery.data;
    const depthFile = depthQuery.data;
    if (!snaps && !depthFile) return undefined;

    return playerRoles({
      shares: snaps ?? new Map(),
      depth: new Map(Object.entries(depthFile?.players ?? {})),
      // Only a same-season pair can be compared. Through the offseason the
      // chart has already advanced and the snaps are last year's, so every
      // free agent would otherwise read as a disagreement.
      comparable: Boolean(snapFile && depthFile && snapFile.season === depthFile.season),
    });
  }, [snaps, snapsQuery.data, depthQuery.data]);

  /**
   * Buy-low and sell-high, league-wide.
   *
   * Deliberately fed the *ungated* snap and usage maps rather than `activity`.
   * The season gate is a rule about pricing — it stops the model charging twice
   * for a role change the market has already absorbed — and it is not a claim
   * that the change never happened. Out of season these still compute, and
   * `applied` carries the distinction so a previewed gap is never read as money
   * already inside the value.
   */
  const trends = useMemo(() => {
    if (!adjusted) return undefined;
    return roleTrends({
      summaries: adjusted.summaries,
      values: adjusted.values,
      snaps,
      usage,
      current: activity?.current ?? false,
    });
  }, [adjusted, snaps, usage, activity]);

  /**
   * Positions the value source prices at all, computed once for the whole app.
   *
   * Derived from the *market* pool rather than the adjusted one so it answers
   * only "does anybody publish a price for this position", with no dependency
   * on this league's replacement levels. Kickers and defences are the standing
   * answer; see `replacement.pricedPositions`.
   */
  const priced = useMemo(
    () => (valuesQuery.data ? pricedPositions(valuesQuery.data.bySleeperId) : undefined),
    [valuesQuery.data],
  );

  return {
    league: leagueQuery.data?.league,
    players: leagueQuery.data?.players,
    values: adjusted?.values,
    scarcity: adjusted?.scarcity,
    /** Positions with a published market, for telling "~0" from "no market". */
    priced,
    summaries,
    picks,
    picksUnavailable: pickValuesQuery.isError,
    snaps,
    usage,
    roles,
    /** What activity did to each value, so a moved number can explain itself. */
    adjustments: adjusted?.adjustments,
    /** Players whose role has outgrown their price, and the reverse. */
    trends,
    /** Dates the activity data so the UI can say what it is describing. */
    snapsMeta: snapsQuery.data
      ? {
          season: snapsQuery.data.season,
          throughWeek: snapsQuery.data.throughWeek,
          chartSeason: depthQuery.data?.season ?? null,
        }
      : undefined,
    // Snap data deliberately absent: it enriches rows rather than gating them,
    // so the league loads and renders whether or not it arrives.
    isLoading: leagueQuery.isLoading || valuesQuery.isLoading,
    error: leagueQuery.error ?? valuesQuery.error,
  };
}
