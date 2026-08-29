import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { sleeperProvider } from '../platforms/sleeper';
import { fetchFantasyCalcValues } from '../values/fantasycalc';
import { fetchPickValues } from '../values/dynastyprocess';
import type { RosterSummary } from '../engine/rosterValue';
import { buildDraftPicks, tradeableSeasons } from '../engine/picks';
import { isGameWeek, regularSeasonWeek } from '../engine/season';
import { freeAgentBoard, type FreeAgentBoard } from '../engine/freeAgents';
import { pricedPositions, valueLeague, type LeagueActivity } from '../engine/replacement';
import { snapShares } from '../engine/snapShare';
import { opportunities } from '../engine/opportunity';
import { checkScoring, scoringIsUsable } from '../engine/scoringCheck';
import { playerRoles } from '../engine/role';
import { byeTeams as teamsOnBye } from '../engine/byes';
import { roleTrends } from '../engine/roleTrend';
import type { SeasonOdds } from '../engine/analysis';
import { usePlayoffOdds } from './usePlayoffOdds';
import {
  fetchByeWeeks,
  fetchDepthCharts,
  fetchOpportunity,
  fetchScoring,
  fetchSnapCounts,
} from '../data/activity';
import {
  calibrate,
  playedFixtures,
  remainingFixtures,
  teamStates,
  type OddsContext,
} from '../engine/playoffOdds';
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
 * The regular-season schedule, for the playoff simulation and nothing else.
 *
 * Its own query rather than part of the league load: it costs a request per
 * week, and no roster, value or trade calculation waits on it. A league whose
 * provider cannot supply one — or whose schedule fails to load — renders
 * exactly as it did before, minus the odds.
 */
export function useSchedule(leagueId: string | null, playoffWeekStart: number | undefined) {
  return useQuery({
    queryKey: ['schedule', leagueId, playoffWeekStart],
    queryFn: () =>
      sleeperProvider.loadSchedule!(leagueId as string, (playoffWeekStart as number) - 1),
    enabled: Boolean(leagueId && playoffWeekStart && sleeperProvider.loadSchedule),
    // A schedule is fixed when the league is created and does not move.
    staleTime: 24 * 60 * 60 * 1000,
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

/**
 * Per-week stat lines, so the app can score players in the league's own rules.
 *
 * Its own query rather than a widening of `useOpportunity`: different columns,
 * different players — this one keeps kickers — and a different question. See
 * `SCORING_COLUMNS`.
 */
export function useScoringStats() {
  return useQuery({
    queryKey: ['scoring'],
    queryFn: fetchScoring,
    staleTime: Infinity,
    retry: 1,
  });
}

/** When each team is off, for the lineup panel. */
export function useByeWeeks() {
  return useQuery({
    queryKey: ['byeWeeks'],
    queryFn: fetchByeWeeks,
    staleTime: Infinity,
    retry: 1,
  });
}

export function useLeagueSummaries(leagueId: string | null) {
  const leagueQuery = useLeague(leagueId);
  const settings = leagueQuery.data?.league.settings;
  const valuesQuery = useValues(settings);
  const pickValuesQuery = usePickValues(settings);
  const scheduleQuery = useSchedule(leagueId, settings?.playoffWeekStart);
  const snapsQuery = useSnapShares();
  const opportunityQuery = useOpportunity();
  const scoringQuery = useScoringStats();
  const depthQuery = useDepthCharts();
  const byesQuery = useByeWeeks();

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
   * Teams with no game this week.
   *
   * Gated on `isGameWeek`, the same test the lineup panel uses to decide
   * whether it is correcting a lineup or merely describing one. The two must
   * agree: the panel only speaks about byes in its game-week register, so any
   * phase this admits that the panel does not is a claim nobody reads, and any
   * phase the panel admits that this does not is a claim it cannot support.
   *
   * That rules out the preseason, which is the phase that actually matters
   * here. Sleeper reuses the week counter — week 2 in August and week 2 in
   * September are both "week 2", which `engine/season` exists to disambiguate —
   * so an ungated read would answer a September question with an August number.
   * Byes start in week 4 at the earliest, so the collision is harmless today
   * and would be silent the year it stops being.
   *
   * The NFL postseason is deliberately *in*. Its weeks run past 18, where no
   * team has a bye, so the honest answer is an empty set — "nobody is off" —
   * rather than the null that would have the panel report data it has as data
   * it could not load.
   *
   * Everything else the answer depends on — a missing file, a season that does
   * not match, an unknown week — is `engine/byes`' job, and it returns null for
   * all of them. Null is the pre-bye behaviour exactly, and it is deliberately
   * not the same value as the empty set a week with no byes produces.
   */
  const byeTeams = useMemo(() => {
    const bundle = leagueQuery.data;
    if (!isGameWeek(bundle?.seasonPhase ?? 'unknown')) return null;
    return teamsOnBye(
      byesQuery.data,
      bundle?.currentSeason ? Number(bundle.currentSeason) : null,
      bundle?.currentWeek ?? null,
    );
  }, [byesQuery.data, leagueQuery.data]);

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
  /**
   * Whether this app can reproduce the league's own scoring, and how closely.
   *
   * Computed from data already in hand: the stat lines ship in `scoring.json`
   * and the awarded points ride along in the matchup responses the schedule
   * already fetches, so the answer costs one pass over a few hundred rows and
   * no extra request.
   *
   * Above `adjusted` because it now gates it. A league whose scoring this app
   * cannot reproduce must not have its market prices corrected by a rulebook
   * the app is demonstrably reading wrong.
   */
  const scoringFidelity = useMemo(
    () =>
      settings
        ? checkScoring(scoringQuery.data, scheduleQuery.data?.awarded, settings.scoring)
        : undefined,
    [scoringQuery.data, scheduleQuery.data, settings],
  );

  /**
   * The stat lines, but only where the scoring engine has earned the right.
   *
   * `scoringIsUsable` is the degrade path #73 built and left unwired: a league
   * whose published points this engine cannot reproduce falls back to the
   * market ranking rather than having every position reweighted by arithmetic
   * that is already known to disagree with the platform's own.
   *
   * An unplayed season counts as usable. No week has been checked, but the
   * premium is a ratio between two *rulebooks* scored over the same players —
   * it is not a claim about this season, and refusing to compute it every
   * August would mean the feature never works when dynasty leagues are busiest.
   */
  const scoringStats = useMemo(
    () =>
      scoringFidelity && scoringIsUsable(scoringFidelity) ? scoringQuery.data : null,
    [scoringFidelity, scoringQuery.data],
  );

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
      scoringStats,
    );
  }, [leagueQuery.data, valuesQuery.data, activity, scoringStats]);

  /**
   * The waiver wire, priced against the levels the rostered pool produced.
   *
   * Computed after `adjusted` and from its output, never alongside it. The
   * levels are an answer about *this league's rosters*, and the ~900 players
   * nobody rosters must not get a vote in them — see `LeagueBundle.freeAgents`.
   *
   * Fed the *ungated* activity maps for the same reason `trends` is: the season
   * gate is a rule about pricing, not a claim that nothing happened. Which
   * season the shares describe is `snapsMeta`'s job to say, and the board says
   * it on screen.
   */
  const freeAgents = useMemo<FreeAgentBoard | undefined>(() => {
    const bundle = leagueQuery.data;
    const market = valuesQuery.data?.bySleeperId;
    if (!bundle || !market || !adjusted) return undefined;

    return freeAgentBoard({
      freeAgents: bundle.freeAgents,
      market,
      levels: adjusted.levels,
      snaps,
      usage,
      current: activity?.current ?? false,
    });
  }, [leagueQuery.data, valuesQuery.data, adjusted, snaps, usage, activity]);

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

  /**
   * Everything the playoff simulation needs, or undefined if it cannot run.
   *
   * Undefined rather than an empty context, because "no games left" and "no
   * schedule" produce the same empty fixture list and mean opposite things —
   * one is a season that is over, the other is a question this app cannot
   * answer. The UI has to be able to tell them apart to know whether to say
   * nothing or to say the season is done.
   */
  const oddsContext = useMemo<OddsContext | undefined>(() => {
    const bundle = leagueQuery.data;
    const schedule = scheduleQuery.data?.matchups;
    if (!bundle || !schedule || !adjusted || summaries.length === 0) return undefined;

    const teams = teamStates(bundle.league, summaries);
    const playoffWeekStart = bundle.league.settings.playoffWeekStart;

    return {
      teams,
      remaining: remainingFixtures(
        schedule,
        // The week as a regular-season position, not as the platform's raw
        // counter. Through August that counter reads 1 or 2 and means
        // *preseason* — taken at face value it retired the first fortnight of a
        // season nobody had played. See `engine/season`.
        regularSeasonWeek(bundle.currentWeek, bundle.seasonPhase, playoffWeekStart - 1),
        playoffWeekStart,
      ),
      playoffTeams: bundle.league.settings.playoffTeams,
      // Measured from this league's completed weeks where there are enough of
      // them, and assumed where there are not — see `calibrate`.
      model: calibrate(teams, playedFixtures(schedule)),
    };
  }, [leagueQuery.data, scheduleQuery.data, adjusted, summaries]);

  /**
   * The league as it stands, simulated — no trade, just the season.
   *
   * A third simulation alongside the trade builder's before/after pair, and
   * worth the worker: this is the one the *team* page and the suggestion engine
   * read, and both need it whether or not anyone has opened the calculator.
   * `usePlayoffOdds` returns null until an answer exists, so nothing here waits
   * on it.
   */
  const baselineOdds = usePlayoffOdds(oddsContext ?? null);

  /**
   * Playoff odds paired with how much season is behind them.
   *
   * Gated on `regular`, and the gate is doing real work rather than tidying.
   * Out of season `remainingFixtures` is empty, so the simulation reports the
   * standings of a season already finished as though they were a forecast —
   * "100% to make the playoffs" about last year, which would then drive this
   * year's advice. The preseason is excluded for the opposite reason: nothing
   * has been played, so the odds are a restatement of `starterValue` and
   * blending them in would be the roster projection counted twice. `weight`
   * would be zero there anyway; this makes it explicit rather than incidental.
   */
  const season = useMemo<SeasonOdds | undefined>(() => {
    const bundle = leagueQuery.data;
    if (!bundle || bundle.seasonPhase !== 'regular' || !baselineOdds.odds) return undefined;

    const weeksTotal = bundle.league.settings.playoffWeekStart - 1;
    const week = regularSeasonWeek(bundle.currentWeek, bundle.seasonPhase, weeksTotal);
    if (week === null || weeksTotal <= 0) return undefined;

    // The week being played is not yet behind us — `remainingFixtures` counts
    // it as remaining for the same reason, since a trade agreed on Tuesday is
    // in the lineup on Sunday.
    return {
      odds: baselineOdds.odds,
      weeksPlayed: Math.min(Math.max(week - 1, 0), weeksTotal),
      weeksTotal,
    };
  }, [leagueQuery.data, baselineOdds.odds]);

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

  /**
   * Ask again for whatever failed — and only for that.
   *
   * Deliberately not a blanket "refetch everything". `refetch` in react-query
   * v5 ignores `enabled`, so calling it on the values query while the league is
   * the thing that broke would run `fetchFantasyCalcValues` with undefined
   * settings, turning a retryable network error into a thrown one. Retrying the
   * league is enough on its own: the values query is keyed on settings that
   * arrive with it, so it starts by itself the moment the league lands.
   */
  const leagueRefetch = leagueQuery.refetch;
  const valuesRefetch = valuesQuery.refetch;
  const retry = useCallback(() => {
    if (leagueQuery.isError) void leagueRefetch();
    else if (valuesQuery.isError) void valuesRefetch();
  }, [leagueQuery.isError, valuesQuery.isError, leagueRefetch, valuesRefetch]);

  return {
    league: leagueQuery.data?.league,
    players: leagueQuery.data?.players,
    /** What the app can and cannot reproduce of this league's scoring rules. */
    scoringFidelity,
    /** How this league's scoring moved each position against the market's. */
    premium: adjusted?.premium,
    /** Where the NFL calendar stands, so a week number can be read correctly. */
    seasonPhase: leagueQuery.data?.seasonPhase,
    currentWeek: leagueQuery.data?.currentWeek ?? null,
    values: adjusted?.values,
    scarcity: adjusted?.scarcity,
    /** Positions with a published market, for telling "~0" from "no market". */
    priced,
    /** Every player nobody rosters, priced where anyone prices him. */
    freeAgents,
    /**
     * Whether the activity data describes the season being played.
     *
     * Exposed because the free-agent board *orders* on activity, which makes
     * the answer part of the reading rather than a footnote: last season's snap
     * shares are the best evidence there is out of season, and presenting them
     * as current would be the app lying about which year it is describing.
     */
    activityCurrent: activity?.current ?? false,
    summaries,
    picks,
    picksUnavailable: pickValuesQuery.isError,
    /**
     * Whether `picks` above is the finished list, either way.
     *
     * `picks` is an empty array both before the values arrive and when a league
     * genuinely has none, and a consumer that must not confuse the two needs to
     * be told which it is looking at. A shared link is exactly that consumer:
     * validating its pick ids against a list that has not loaded yet silently
     * discards every one of them.
     *
     * Note what the list is built from: the pick *table* from DynastyProcess
     * and `adjusted` from FantasyCalc, two hosts behind two caches, racing from
     * the same trigger. The pick query settling proves nothing on its own — a
     * returning user with a warm pick cache and an expired value cache reaches
     * it while `picks` is still empty, which is precisely the window this flag
     * exists to keep callers out of. Both halves, or the error.
     */
    picksSettled: (pickValuesQuery.isSuccess && adjusted !== undefined) || pickValuesQuery.isError,
    /** Standings, remaining fixtures and the playoff cut. Undefined = cannot simulate. */
    oddsContext,
    /**
     * Live playoff odds and the season behind them, for advice and suggestions.
     *
     * Undefined out of season, which is what makes both fall back to the
     * roster verdict alone.
     */
    season,
    snaps,
    usage,
    roles,
    /** Teams off this week, so the lineup panel does not start a man on bye. */
    byeTeams,
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
    /** Re-run the failed query, so a failure has a way out short of a reload. */
    retry,
    /** True while that retry is in flight. */
    retrying: leagueQuery.isFetching || valuesQuery.isFetching,
  };
}
