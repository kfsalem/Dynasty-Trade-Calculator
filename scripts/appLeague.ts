/**
 * A real league, valued the way the app values it, in node.
 *
 * `check:slots` (#64, #65) and the ingest's odds record (#164) both need the
 * app's own numbers for a real league. Every copy of this wiring is a chance
 * to drift from `useLeagueData`, which is the one that ships, so it is written
 * once, here, step for step as the hook does it:
 *
 * - the league through the app's own provider;
 * - the activity and scoring files the app fetches from `/data`, read from
 *   disk, since they are the same files;
 * - activity counted only for the season being played;
 * - the league's own scoring applied only where `checkScoring` says this
 *   engine reproduces it;
 * - `valueLeague` on all of that, and the playoff simulation's input built
 *   as the hook builds it.
 *
 * The values are the caller's. `check:slots` asks FantasyCalc live, as the app
 * does; the odds record reads the snapshot the same ingest run has just
 * written, which is the same market read through the same mapping.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sleeperProvider } from '../src/platforms/sleeper';
import type { LeagueBundle, Schedule } from '../src/platforms/types';
import { DATA_FILES, type OpportunityFile, type ScoringFile, type SnapCountsFile } from '../src/data/types';
import { snapShares } from '../src/engine/snapShare';
import { opportunities } from '../src/engine/opportunity';
import { checkScoring, scoringIsUsable, type ScoringFidelity } from '../src/engine/scoringCheck';
import { valueLeague, type LeagueActivity, type LeagueValuation } from '../src/engine/replacement';
import {
  calibrate,
  playedFixtures,
  remainingFixtures,
  teamStates,
  type OddsContext,
} from '../src/engine/playoffOdds';
import { regularSeasonWeek } from '../src/engine/season';
import type { RosterSummary } from '../src/engine/rosterValue';
import type { ValueBundle } from '../src/values/fantasycalc';
import type { LeagueSettings } from '../src/types';

const PUBLIC_DATA = fileURLToPath(new URL('../public/data/', import.meta.url));

export interface AppLeagueOptions {
  /** Where the market's values come from, once the league's format is known. */
  values: (settings: LeagueSettings) => Promise<ValueBundle>;
  /** The folder holding the app's `/data` files. Defaults to `public/data`. */
  dataDir?: string;
}

export interface AppLeague {
  bundle: LeagueBundle;
  values: ValueBundle;
  /** Ungated: whichever season the files describe, as the hook keeps them. */
  snaps: ReturnType<typeof snapShares> | undefined;
  usage: ReturnType<typeof opportunities> | undefined;
  /** Gated to the season being played, as `valueLeague` is given it. */
  activity: LeagueActivity;
  fidelity: ScoringFidelity;
  /** Whether the league's own scoring corrected market prices. */
  scoringApplied: boolean;
  valuation: LeagueValuation;
  /** Strongest lineup first, as `useLeagueData` sorts them. */
  summaries: RosterSummary[];
  schedule: Schedule | null;
  /** Regular-season weeks, so the week before the playoffs start. */
  weeksTotal: number;
  /** The regular-season week as the app reads it, or null if Sleeper did not say. */
  week: number | null;
  /** The playoff simulation's input, as the hook builds it, or undefined with no schedule. */
  odds: OddsContext | undefined;
}

export async function loadAppLeague(leagueId: string, options: AppLeagueOptions): Promise<AppLeague> {
  const dataDir = options.dataDir ?? PUBLIC_DATA;
  const bundle = await sleeperProvider.loadLeague(leagueId);
  const { league, players } = bundle;
  const values = await options.values(league.settings);

  const file = <T,>(name: string): T | null => {
    try {
      return JSON.parse(readFileSync(`${dataDir}${name}`, 'utf8')) as T;
    } catch {
      return null;
    }
  };
  const snapFile = file<SnapCountsFile>(DATA_FILES.snaps);
  const usageFile = file<OpportunityFile>(DATA_FILES.opportunity);
  const scoringFile = file<ScoringFile>(DATA_FILES.scoring);
  const snaps = snapFile ? snapShares(snapFile) : undefined;
  const usage = usageFile ? opportunities(usageFile) : undefined;

  // Activity counts only for the season being played, as in the app.
  const played = Number(bundle.currentSeason);
  const snapsLive = snapFile?.season === played;
  const usageLive = usageFile?.season === played;
  const activity: LeagueActivity = {
    snaps: snapsLive && snaps ? snaps : new Map(),
    usage: usageLive && usage ? usage : new Map(),
    current: snapsLive || usageLive,
  };

  // The schedule carries both the awarded points the scoring check needs and
  // the fixtures the playoff odds need, so it is loaded once, here.
  const playoffWeekStart = league.settings.playoffWeekStart;
  const weeksTotal = playoffWeekStart - 1;
  const schedule =
    sleeperProvider.loadSchedule && weeksTotal > 0
      ? await sleeperProvider.loadSchedule(leagueId, weeksTotal)
      : null;

  // The league's own scoring corrects market prices only where this engine
  // reproduces it — the gate the app applies.
  const fidelity = checkScoring(scoringFile, schedule?.awarded, league.settings.scoring);
  const scoringStats = scoringIsUsable(fidelity) ? scoringFile : null;

  const valuation = valueLeague(
    league.rosters,
    players,
    values.bySleeperId,
    league.settings,
    activity,
    scoringStats,
  );
  const summaries = [...valuation.summaries].sort((a, b) => b.starterValue - a.starterValue);

  const week = regularSeasonWeek(bundle.currentWeek, bundle.seasonPhase, weeksTotal);
  let odds: OddsContext | undefined;
  if (schedule) {
    const teams = teamStates(league, summaries);
    odds = {
      teams,
      remaining: remainingFixtures(schedule.matchups, week, playoffWeekStart),
      playoffTeams: league.settings.playoffTeams,
      model: calibrate(teams, playedFixtures(schedule.matchups, week)),
    };
  }

  return {
    bundle,
    values,
    snaps,
    usage,
    activity,
    fidelity,
    scoringApplied: scoringStats !== null,
    valuation,
    summaries,
    schedule,
    weeksTotal,
    week,
    odds,
  };
}
