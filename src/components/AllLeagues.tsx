import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LeagueChoice } from '../platforms/types';
import type { Roster } from '../types';
import { useLeagueSummaries } from '../hooks/useLeagueData';
import { OpenPlayerContext } from '../hooks/useOpenPlayer';
import { weekCalls, type WeekCalls } from '../engine/weekCalls';
import { exposure, type Exposure, type HeldRoster } from '../engine/exposure';
import { ownsRoster } from '../engine/owners';
import { isGameWeek } from '../engine/season';
import { POSITION_STYLES } from '../lib/format';
import { joinWords } from '../lib/scoringText';
import {
  formatShare,
  holdingsHeadline,
  weekHeadline,
  weekSummary,
  type WeekTally,
} from '../lib/allLeaguesText';
import { ChangeRow, Wire } from './WeeklyLineup';
import { PlayerAvatar } from './PlayerAvatar';
import { Tile } from './TeamAnalysis';

/**
 * Every league a manager is in, on one screen (#161).
 *
 * Two answers. **This week**: every lineup change and waiver claim the app
 * would make, league by league, so a manager in six leagues does not open six
 * of them on a Sunday morning to find the two with something to do.
 * **Exposure**: the players he holds in more than one league, and how much of
 * each roster rides on them.
 *
 * A screen of its own rather than a seventh tab, because every tab describes
 * one league and this describes all of them. It is reached from the league
 * switcher in the header, which is where the leagues it covers are listed.
 *
 * Each league is loaded by the same hook that loads it on its own, minus the
 * playoff simulation, and its calls come from the same `weekCalls` the lineup
 * panel runs. So this screen cannot disagree with a league's own My team tab,
 * and opening a league from here finds everything already in the cache.
 *
 * Three things are left out, and each is a tap away on the league itself: the
 * playoff odds, the bid model, which walks seventy requests of a league's
 * history, and the facts line under each call. The facts were the largest cost
 * of loading a league. Measured 2026-11-16 on a production build, a manager
 * with 22 leagues spent 2.3 s of main-thread time on them, against 1.4 s on
 * valuing the leagues.
 */

interface Props {
  /** The manager, by platform user id: whose team to read in each league. */
  userId: string;
  leagues: LeagueChoice[];
  /** Open a league, with this manager's team claimed, on its My team tab. */
  onOpen: (leagueId: string) => void;
}

/** One league's answer, reported up to the screen once it has one. */
type LeagueReport =
  | { leagueId: string; state: 'loading' }
  | { leagueId: string; state: 'failed' }
  /** Loaded, but no roster is his, as owner or co-owner. */
  | { leagueId: string; state: 'unmatched' }
  | {
      leagueId: string;
      state: 'ready';
      gameWeek: boolean;
      week: number | null;
      bestBall: boolean;
      /**
       * No players at all: a team chopped from a guillotine league, seen live
       * 2026-11-16 with 9 of 18 rosters emptied. Every slot is empty, so the
       * wire would fill all of them, for a team that can no longer claim.
       */
      empty: boolean;
      roster: Roster;
      /** Null out of season, in best ball, and for an empty roster: no lineup to set. */
      calls: WeekCalls | null;
      activityCurrent: boolean;
      held: HeldRoster;
    };

type Ready = Extract<LeagueReport, { state: 'ready' }>;

/**
 * Loads one league and reports what it found. Renders nothing.
 *
 * A component rather than a loop, because the load is a chain of hooks and
 * hooks cannot be called in a loop. Each probe mounts its own copy.
 */
function LeagueProbe({
  choice,
  userId,
  onReport,
}: {
  choice: LeagueChoice;
  userId: string;
  onReport: (report: LeagueReport) => void;
}) {
  const {
    league,
    values,
    summaries,
    wireBoard,
    byeTeams,
    projected,
    lockedTeams,
    seasonPhase,
    currentWeek,
    activityCurrent,
    isLoading,
    weekPending,
    error,
  } = useLeagueSummaries(choice.leagueId, { odds: false, evidence: false });

  const report = useMemo<LeagueReport>(() => {
    const leagueId = choice.leagueId;
    if (error) return { leagueId, state: 'failed' };
    if (isLoading || weekPending || !league || !values) return { leagueId, state: 'loading' };

    const roster = league.rosters.find((r) => ownsRoster(r, userId));
    const summary = roster && summaries.find((s) => s.rosterId === roster.rosterId);
    if (!roster || !summary) return { leagueId, state: 'unmatched' };

    const gameWeek = isGameWeek(seasonPhase ?? 'unknown');
    const bestBall = league.settings.bestBall;
    const empty = roster.playerIds.length === 0;
    return {
      leagueId,
      state: 'ready',
      gameWeek,
      week: currentWeek,
      bestBall,
      empty,
      roster,
      calls:
        gameWeek && !bestBall && !empty
          ? weekCalls({
              roster,
              summary,
              settings: league.settings,
              board: wireBoard,
              byeTeams,
              projected,
              locked: lockedTeams,
            })
          : null,
      activityCurrent,
      held: {
        leagueId,
        name: choice.name,
        players: summary.players,
        totalValue: summary.totalValue,
      },
    };
  }, [
    choice.leagueId,
    choice.name,
    userId,
    error,
    isLoading,
    weekPending,
    league,
    values,
    summaries,
    wireBoard,
    byeTeams,
    projected,
    lockedTeams,
    seasonPhase,
    currentWeek,
    activityCurrent,
  ]);

  useEffect(() => onReport(report), [report, onReport]);
  return null;
}

/** How many shared players show before "Show all". */
const EXPOSURE_ROWS = 8;

/**
 * How many leagues load at once.
 *
 * Valuing a league takes about 80 ms of main thread, and when every league is
 * loaded together their answers arrive together and are valued in one go.
 * Measured 2026-11-16 on a production build with a manager in 22 leagues, that
 * froze the page for 1.6 s in a single task. Three at a time keeps a task to
 * about three leagues' worth. The next league starts as each one finishes, and
 * those after the first few find the shared files and values already cached.
 */
const AT_ONCE = 3;

/**
 * How far down the list may load now: every league that has finished, and the
 * next `AT_ONCE` that have not.
 */
function loadingReach(leagues: LeagueChoice[], reports: ReadonlyMap<string, LeagueReport>): number {
  let waiting = 0;
  let reach = 0;
  for (const choice of leagues) {
    if ((reports.get(choice.leagueId)?.state ?? 'loading') === 'loading') {
      if (waiting === AT_ONCE) break;
      waiting += 1;
    }
    reach += 1;
  }
  return reach;
}

/** Rows the league shows: every decisive change and every claim. */
const rowCount = (calls: WeekCalls) => calls.plan.decisive.length + calls.wire.length;

/**
 * Moves a manager can make in his own lineup: changes that start somebody.
 *
 * A change with nobody to start is a slot no one on the roster can fill, a
 * starter on bye with no one behind him. It is shown, because it is why the
 * claim beside it exists, but it is not a move of its own. Counting it as one
 * counted every such slot twice once the wire filled it, seen live 2026-11-16:
 * "4 lineup moves and 2 waiver claims" for two moves and two claims.
 */
const moves = (calls: WeekCalls) => calls.plan.decisive.filter((change) => change.start).length;

/** Slots nobody on the roster can fill, and no claim fills either. */
const unfilled = (calls: WeekCalls) =>
  calls.plan.decisive.filter(
    (change) => !change.start && !calls.wire.some((claim) => claim.index === change.index),
  ).length;

export function AllLeagues({ userId, leagues, onOpen }: Props) {
  const [reports, setReports] = useState<ReadonlyMap<string, LeagueReport>>(() => new Map());
  /*
    A report that says nothing new is dropped, so the screen does not render
    again for it. Only a ready report carries data. Any two reports of the
    other states are the same answer, even when they are different objects.
  */
  const onReport = useCallback((report: LeagueReport) => {
    setReports((prev) => {
      const seen = prev.get(report.leagueId);
      if (seen === report || (seen?.state === report.state && report.state !== 'ready')) {
        return prev;
      }
      return new Map(prev).set(report.leagueId, report);
    });
  }, []);

  const entries = leagues.map((choice) => ({
    choice,
    report: reports.get(choice.leagueId) ?? { leagueId: choice.leagueId, state: 'loading' as const },
  }));
  const settled = entries.filter((e) => e.report.state !== 'loading').length;
  const ready = entries.filter(
    (e): e is { choice: LeagueChoice; report: Ready } => e.report.state === 'ready',
  );
  const problems = entries.filter(
    (e) => e.report.state === 'failed' || e.report.state === 'unmatched',
  );

  /*
    Only ever widened. A league can go back to loading, as every league does
    when the week turns over, and narrowing then would unmount the leagues past
    it and value them all again.
  */
  const reachNow = loadingReach(leagues, reports);
  const [reached, setReached] = useState(reachNow);
  useEffect(() => {
    if (reachNow > reached) setReached(reachNow);
  }, [reachNow, reached]);
  const started = leagues.slice(0, Math.max(reached, reachNow));

  const exposures = useMemo(
    () =>
      exposure(
        leagues.flatMap((choice) => {
          const report = reports.get(choice.leagueId);
          return report?.state === 'ready' ? [report.held] : [];
        }),
      ),
    [reports, leagues],
  );

  return (
    /*
      The probes come first and always at the same place in the tree, so the
      screen changing from loading to loaded never remounts them, which would
      value every league a second time. Names stay plain text below: the player
      panel reads the open league, and a player here may belong to any of them.
    */
    <OpenPlayerContext.Provider value={null}>
      {started.map((choice) => (
        <LeagueProbe key={choice.leagueId} choice={choice} userId={userId} onReport={onReport} />
      ))}
      {settled < leagues.length ? (
        <Checking settled={settled} total={leagues.length} />
      ) : (
        <Loaded
          leagues={leagues.length}
          ready={ready}
          problems={problems}
          exposures={exposures}
          onOpen={onOpen}
        />
      )}
    </OpenPlayerContext.Provider>
  );
}

/** While any league is still loading: how many have, and the shape of what is coming. */
function Checking({ settled, total }: { settled: number; total: number }) {
  return (
    <section className="card" role="status" aria-live="polite">
      <p className="text-xs font-semibold uppercase tracking-wide text-subtle">All your leagues</p>
      <h2 className="mt-1 font-display text-4xl font-extrabold tracking-tight sm:text-5xl">
        Checking your leagues
      </h2>
      <p className="mt-3 text-base text-muted tabular sm:text-lg">
        {settled} of {total} loaded
      </p>
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-24 rounded-xl" />
        ))}
      </div>
    </section>
  );
}

/** A league whose lineup was checked, with the calls it produced. */
interface Checked {
  choice: LeagueChoice;
  report: Ready;
  calls: WeekCalls;
}

function Loaded({
  leagues,
  ready,
  problems,
  exposures,
  onOpen,
}: {
  leagues: number;
  ready: { choice: LeagueChoice; report: Ready }[];
  problems: { choice: LeagueChoice; report: LeagueReport }[];
  exposures: Exposure[];
  onOpen: (leagueId: string) => void;
}) {
  const gameWeek = ready.some((e) => e.report.gameWeek);
  const week = ready.find((e) => e.report.week !== null)?.report.week ?? null;
  const lineups: Checked[] = ready.flatMap((e) =>
    e.report.calls ? [{ ...e, calls: e.report.calls }] : [],
  );
  const withRows = lineups.filter((e) => rowCount(e.calls) > 0);
  const quiet = lineups.filter((e) => rowCount(e.calls) === 0);
  const bestBall = ready.filter((e) => e.report.bestBall);
  const empty = ready.filter((e) => e.report.empty && !e.report.bestBall);

  const tally: WeekTally = {
    leagues,
    checked: lineups.length,
    changes: lineups.reduce((n, e) => n + moves(e.calls), 0),
    claims: lineups.reduce((n, e) => n + e.calls.wire.length, 0),
    withCalls: lineups.filter((e) => moves(e.calls) + e.calls.wire.length > 0).length,
    unfilled: lineups.reduce((n, e) => n + unfilled(e.calls), 0),
    unchecked: problems.length,
  };
  const marginal = lineups.reduce((n, e) => n + e.calls.plan.marginal.length, 0);

  return (
    <>
      <section className="card rise-in" aria-labelledby="all-leagues-verdict">
        <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
          All your leagues{gameWeek && week !== null ? ` · Week ${week}` : ''}
        </p>
        <h2
          id="all-leagues-verdict"
          className="mt-1 font-display text-4xl font-extrabold tracking-tight sm:text-5xl"
        >
          {gameWeek ? weekHeadline(tally) : holdingsHeadline(exposures.length)}
        </h2>
        <p className="mt-3 max-w-2xl text-base text-muted sm:text-lg">
          {gameWeek
            ? weekSummary(tally)
            : 'No games are being played, so there are no lineups to set. This is what your rosters have in common.'}
        </p>

        <dl className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile
            label="Leagues"
            value={String(leagues)}
            note={problems.length > 0 ? `${problems.length} not checked` : null}
          />
          {gameWeek && (
            <>
              <Tile
                label="Lineup moves"
                value={String(tally.changes)}
                note={marginal > 0 ? `${marginal} too close to call` : null}
              />
              <Tile label="Waiver claims" value={String(tally.claims)} />
            </>
          )}
          <Tile label="Shared players" value={String(exposures.length)} note="on 2 or more rosters" />
        </dl>
      </section>

      <div
        className={`mt-6 grid gap-6 ${gameWeek ? 'lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]' : ''}`}
      >
        {gameWeek && (
          <section className="card min-w-0" aria-labelledby="all-leagues-week">
            <h3 id="all-leagues-week" className="font-display text-xl font-bold tracking-tight">
              This week, league by league
            </h3>
            <p className="mt-1 text-sm text-muted">
              The same calls as each league's own My team tab, ranked on this week's projections in
              that league's scoring.
            </p>

            {withRows.length > 0 && (
              <ul className="mt-4 divide-y divide-line">
                {withRows.map((checked) => (
                  <LeagueCalls key={checked.choice.leagueId} checked={checked} onOpen={onOpen} />
                ))}
              </ul>
            )}

            {quiet.length > 0 && (
              <p className="mt-4 border-t border-line pt-3 text-sm text-muted">
                Nothing to change in {joinWords(quiet.map((e) => e.choice.name))}.
              </p>
            )}
            {bestBall.length > 0 && (
              <p className="mt-3 text-sm text-muted">
                {joinWords(bestBall.map((e) => e.choice.name))}{' '}
                {bestBall.length === 1 ? 'is' : 'are'} best ball, so there is no lineup to set.
              </p>
            )}
            {empty.length > 0 && (
              <p className="mt-3 text-sm text-muted">
                Your {empty.length === 1 ? 'roster' : 'rosters'} in{' '}
                {joinWords(empty.map((e) => e.choice.name))}{' '}
                {empty.length === 1 ? 'is' : 'are'} empty, so there is no lineup to set. In a
                guillotine league, that means the team has been chopped.
              </p>
            )}
            <Problems problems={problems} onOpen={onOpen} />
          </section>
        )}

        <div className="min-w-0 space-y-6">
          <ExposureCard exposures={exposures} leagues={leagues} />
          {!gameWeek && problems.length > 0 && (
            <section className="card">
              <Problems problems={problems} onOpen={onOpen} />
            </section>
          )}
        </div>
      </div>
    </>
  );
}

/** One league's calls: its lineup moves, then its waiver claims. */
function LeagueCalls({
  checked: { choice, report, calls },
  onOpen,
}: {
  checked: Checked;
  onOpen: (leagueId: string) => void;
}) {
  const { name } = choice;
  const { plan, wire } = calls;
  const marginal = plan.marginal.length;
  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <h4 className="min-w-0 truncate font-semibold">{name}</h4>
        <OpenButton name={name} onOpen={() => onOpen(report.leagueId)} />
      </div>
      {plan.basis === 'value' && (
        <p className="mt-1 text-xs text-subtle">
          This week's projections didn't load for this league, so it is ranked on win-now value.
        </p>
      )}
      {plan.decisive.length > 0 && (
        <ul className="mt-3 space-y-3">
          {plan.decisive.map((change) => (
            <ChangeRow
              key={`${change.slot}-${change.index}`}
              change={change}
              basis={plan.basis}
              facts={null}
            />
          ))}
        </ul>
      )}
      {marginal > 0 && (
        <p className="mt-2 text-xs text-subtle">
          {marginal === 1 ? 'One more swap is' : `${marginal} more swaps are`} too close to call; the
          league's own panel lists {marginal === 1 ? 'it' : 'them'}.
        </p>
      )}
      {wire.length > 0 && (
        <Wire
          upgrades={wire}
          activityCurrent={report.activityCurrent}
          roster={report.roster}
          basis={plan.basis}
          factsFor={() => null}
          compact
        />
      )}
    </li>
  );
}

/** The leagues this screen could not read, each with a way to go and look. */
function Problems({
  problems,
  onOpen,
}: {
  problems: { choice: LeagueChoice; report: LeagueReport }[];
  onOpen: (leagueId: string) => void;
}) {
  if (problems.length === 0) return null;
  return (
    <ul className="mt-3 space-y-1 border-t border-line pt-3 first:mt-0 first:border-t-0 first:pt-0">
      {problems.map(({ choice, report }) => (
        <li key={choice.leagueId} className="flex items-center justify-between gap-3 text-sm text-muted">
          <span className="min-w-0">
            {report.state === 'failed'
              ? `${choice.name} couldn't be loaded.`
              : `Your team in ${choice.name} wasn't found. Open the league to pick it.`}
          </span>
          <OpenButton name={choice.name} onOpen={() => onOpen(choice.leagueId)} />
        </li>
      ))}
    </ul>
  );
}

function OpenButton({ name, onOpen }: { name: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${name}`}
      className="min-h-11 shrink-0 px-2 text-sm font-medium text-accent fine:min-h-8"
    >
      Open
    </button>
  );
}

/**
 * The players on more than one roster, heaviest first.
 *
 * Each holding is a share of that roster's value, never the value itself:
 * leagues of different formats price the same man differently, and the share
 * is the figure that means the same thing in all of them. See `engine/exposure`.
 */
function ExposureCard({ exposures, leagues }: { exposures: Exposure[]; leagues: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? exposures : exposures.slice(0, EXPOSURE_ROWS);

  return (
    <section className="card" aria-labelledby="all-leagues-exposure">
      <h3 id="all-leagues-exposure" className="font-display text-xl font-bold tracking-tight">
        On more than one roster
      </h3>
      <p className="mt-1 text-sm text-muted">
        What share of each roster's value he is. Shares, not values, because each league prices
        players on its own scale.
      </p>

      {exposures.length === 0 ? (
        <p className="mt-4 text-sm text-subtle">
          Every priced player you hold is on just one of your rosters.
        </p>
      ) : (
        <ul id="all-leagues-exposure-list" className="mt-4 space-y-2">
          {shown.map((held) => (
            <ExposureRow key={held.player.id} held={held} leagues={leagues} />
          ))}
        </ul>
      )}

      {exposures.length > EXPOSURE_ROWS && (
        <button
          type="button"
          onClick={() => setAll((open) => !open)}
          aria-expanded={all}
          aria-controls="all-leagues-exposure-list"
          className="mt-3 min-h-11 text-sm font-medium text-accent fine:min-h-8"
        >
          {all ? 'Show fewer' : `Show all ${exposures.length}`}
        </button>
      )}
    </section>
  );
}

/**
 * Leagues named on a shared player's row before the rest are summed up. A man
 * held in 15 leagues was a row of 15 lines, seen live 2026-11-16, and the
 * heaviest few are the ones that say how exposed the manager is.
 */
const HOLDING_ROWS = 5;

function ExposureRow({ held, leagues }: { held: Exposure; leagues: number }) {
  const style = POSITION_STYLES[held.player.position];
  // Summing up a single league would take the line it saves, so it is named.
  const named = held.holdings.length > HOLDING_ROWS + 1 ? HOLDING_ROWS : held.holdings.length;
  // Holdings are largest first, so the rest run from the first to the last.
  const rest = held.holdings.slice(named);
  const high = rest.length > 0 ? formatShare(rest[0].share) : '';
  const low = rest.length > 0 ? formatShare(rest[rest.length - 1].share) : '';
  const restRange = high === low ? `${high} each` : `${low}–${high} each`;
  return (
    <li className="flex gap-3 rounded-xl border border-line bg-raised p-3 text-sm">
      <PlayerAvatar player={held.player} />
      <div className="min-w-0 flex-1">
        {/*
          The name wraps rather than truncates, as on the lineup rows: at 375px
          "Bijan …" was all that fitted beside the count, and the name is the
          one thing this row is here to say. The count has a line of its own.
        */}
        <div className="flex items-baseline gap-2">
          <span
            className={`inline-flex w-11 shrink-0 justify-center rounded px-1.5 py-0.5 text-xs font-semibold ${style.chip}`}
          >
            {style.label}
          </span>
          <span className="min-w-0 font-semibold">{held.player.name}</span>
        </div>
        <p className="mt-0.5 text-xs text-subtle tabular">
          In {held.holdings.length} of {leagues} leagues
        </p>
        <ul className="mt-1.5 space-y-0.5 text-xs text-muted">
          {held.holdings.slice(0, named).map((holding) => (
            <li key={holding.leagueId} className="flex justify-between gap-3">
              <span className="min-w-0 truncate">{holding.name}</span>
              <span className="shrink-0 font-semibold text-ink tabular">
                {formatShare(holding.share)}
              </span>
            </li>
          ))}
          {rest.length > 0 && (
            <li className="flex justify-between gap-3">
              <span className="min-w-0">{rest.length} more leagues</span>
              <span className="shrink-0 tabular">{restRange}</span>
            </li>
          )}
        </ul>
      </div>
    </li>
  );
}
