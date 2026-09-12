import { useMemo } from 'react';
import type { League, Position, SeasonPhase } from '../types';
import type { RosterSummary } from '../engine/rosterValue';
import {
  analyzeTeam,
  leagueContention,
  type Quadrant,
  type SeasonOdds,
} from '../engine/analysis';
import { fieldedStanding, leagueFielded } from '../engine/fielded';
import type { Grade } from '../engine/grades';
import { isGameWeek } from '../engine/season';
import type { PositionScarcity } from '../engine/replacement';
import type { FreeAgentBoard } from '../engine/freeAgents';
import type { BenchReport } from '../engine/benchPoints';
import { POSITION_STYLES, formatValue } from '../lib/format';
import { BenchPoints } from './BenchPoints';
import { ContentionScatter } from './charts/ContentionScatter';
import { PositionalStrengthChart } from './charts/PositionalStrengthChart';
import { ScarcityChart } from './charts/ScarcityChart';
import { WeeklyLineup } from './WeeklyLineup';
import type { BidModel } from '../engine/bids';

interface Props {
  league: League;
  summaries: RosterSummary[];
  myRosterId: number;
  scarcity: Partial<Record<Position, PositionScarcity>> | undefined;
  /** Where the NFL calendar stands, for the lineup panel's register. */
  seasonPhase: SeasonPhase | undefined;
  currentWeek: number | null;
  /** Teams with no game this week. Null when unknown or out of season. */
  byeTeams: ReadonlySet<string> | null;
  /** Live playoff odds. Undefined out of season, and the advice then ignores them. */
  season: SeasonOdds | undefined;
  /** The priced waiver wire, so the lineup panel can look past the roster. */
  freeAgents: FreeAgentBoard | undefined;
  /** Whether the activity data describes the season being played. */
  activityCurrent: boolean;
  /**
   * Every season this league has played, reduced to points left on the bench.
   *
   * Passed in rather than fetched here, like everything else on this tab: the
   * app does its loading in one place. Its four fields travel together because
   * the panel has a different thing to say for each — loading, failed, loaded,
   * and loaded but truncated are four states, not one nullable value.
   */
  bench: {
    report: BenchReport | undefined;
    loading: boolean;
    failed: boolean;
    truncated: boolean;
  };
  /**
   * What a waiver claim costs in this league. Undefined until the walk lands,
   * and in every league that does not run FAAB — the lineup panel simply says
   * nothing about price until it has one.
   */
  bids: BidModel | undefined;
  onChangeTeam: () => void;
}

/**
 * The distance a rank throws away, as a phrase — or nothing.
 *
 * The leader's cushion and everyone else's climb, which is the one number that
 * makes a rank mean something: "#1 of 12" reads identically whether the lead is
 * a rounding error or a third of the league.
 *
 * Null below a point, because "0% clear" is not a margin, it is a tie dressed
 * up as an advantage.
 */
function marginPhrase(grade: Grade): string | null {
  const leader = grade.rank === 1;
  const pct = Math.round((leader ? grade.ahead : grade.behind) * 100);
  if (pct < 1) return null;
  return leader ? `${pct}% clear` : `${pct}% back`;
}

const QUADRANT_STYLE: Record<Quadrant, string> = {
  juggernaut: 'bg-positive-soft border-positive text-positive',
  win_now: 'bg-caution-soft border-caution text-caution',
  rebuilding: 'bg-accent-soft border-accent text-accent',
  danger: 'bg-negative-soft border-negative text-negative',
};

export function TeamAnalysis({
  league,
  summaries,
  myRosterId,
  scarcity,
  seasonPhase,
  currentWeek,
  byeTeams,
  season,
  freeAgents,
  activityCurrent,
  bench,
  bids,
  onChangeTeam,
}: Props) {
  const analysis = analyzeTeam(myRosterId, summaries, league.settings, season);
  const roster = league.rosters.find((r) => r.rosterId === myRosterId);

  // Projecting every roster three years forward runs `bestLineup` once per
  // team, so this is the most expensive thing on the tab. Memoised above the
  // early return, because a hook cannot hide behind a conditional.
  const contentionPoints = useMemo(
    () => leagueContention(summaries, league.settings),
    [summaries, league.settings],
  );
  const teamNames = useMemo(
    () => new Map(league.rosters.map((r) => [r.rosterId, r.teamName])),
    [league.rosters],
  );

  /*
    What every team is set to field this week, against what it could.

    Gated on `isGameWeek` — the same test the lineup panel uses — because out of
    season the platform's starters are a stale week-17 lineup on every roster in
    the league. Ranking those would be ranking the order twelve managers last
    happened to close the tab in January, and presenting it as a shortfall would
    invent a mistake nobody has made.
  */
  const fielded = useMemo(() => {
    if (!isGameWeek(seasonPhase ?? 'unknown')) return null;
    return fieldedStanding(
      myRosterId,
      leagueFielded(league.rosters, summaries, league.settings.startingSlots, byeTeams),
    );
  }, [seasonPhase, myRosterId, league.rosters, summaries, league.settings.startingSlots, byeTeams]);

  if (!analysis || !roster) {
    return (
      <div className="card">
        <p className="text-muted">That team is no longer in this league.</p>
        <button type="button" onClick={onChangeTeam} className="btn-secondary mt-3 text-sm">
          Pick a different team
        </button>
      </div>
    );
  }

  const { contention, positions, surpluses, focus } = analysis;
  const summary = summaries.find((s) => s.rosterId === myRosterId);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">{roster.teamName}</h2>
          <p className="mt-1 text-sm text-subtle">
            Measured against the other {contention.teamCount - 1} teams in this league.
          </p>
        </div>
        <button type="button" onClick={onChangeTeam} className="btn-secondary text-sm">
          Not my team
        </button>
      </div>

      {/*
        Above the contention window, which is the deliberate part. The window is
        the more interesting number and it moves twice a season; the lineup has
        a deadline this Sunday. A returning manager should land on the thing he
        can still do something about.
      */}
      {summary && (
        <div className="mt-5">
          <WeeklyLineup
            roster={roster}
            summary={summary}
            settings={league.settings}
            seasonPhase={seasonPhase}
            currentWeek={currentWeek}
            byeTeams={byeTeams}
            board={freeAgents}
            activityCurrent={activityCurrent}
            bids={bids}
          />
        </div>
      )}

      <div className={`mt-5 rounded-xl border p-5 ${QUADRANT_STYLE[contention.quadrant]}`}>
        <p className="text-xs font-semibold uppercase tracking-wide opacity-70">
          Contention window
        </p>
        <h3 className="mt-1 text-2xl font-bold">{contention.label}</h3>
        <p className="mt-2 text-sm">{contention.advice}</p>

        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-current/15 pt-3 text-sm">
          <div>
            <span className="opacity-70">Now</span>{' '}
            <span className="font-semibold tabular-nums">
              #{contention.nowRank} of {contention.teamCount}
            </span>
            {marginPhrase(contention.nowGrade) && (
              <span className="tabular opacity-70"> · {marginPhrase(contention.nowGrade)}</span>
            )}
          </div>
          <div>
            <span className="opacity-70">In 3 years</span>{' '}
            <span className="font-semibold tabular-nums">
              #{contention.futureRank} of {contention.teamCount}
            </span>
            {marginPhrase(contention.laterGrade) && (
              <span className="tabular opacity-70"> · {marginPhrase(contention.laterGrade)}</span>
            )}
          </div>
          {/*
            The rank the two above are silent about. "Now" is `starterValue`,
            which `summarizeRoster` builds from `bestLineup` rather than from
            the platform's starters — so it grades the eleven this roster *can*
            field. That is the right number for a roster, and it is not the team
            being put on the field. Shown only when the two disagree: a manager
            already fielding his best does not need a second rank telling him so.
          */}
          {fielded && !fielded.unset && fielded.gap > 0 && (
            <div>
              <span className="opacity-70">Fielding</span>{' '}
              <span className="font-semibold tabular-nums">
                #{fielded.fieldedRank} of {fielded.ranked}
              </span>
            </div>
          )}
          {/*
            The evidence behind the sentence above, whenever there is a season
            to read. The advice quotes this figure, and a claim as strong as
            "this season is not the one to spend on" should show the number it
            rests on rather than asking to be taken on trust.

            The two ranks either side of it are roster quantities and this one
            is not, which is exactly why it earns its place: it is the only
            thing on the card that knows the team has been losing.
          */}
          {contention.season && (
            <div>
              <span className="opacity-70">Playoff odds</span>{' '}
              <span className="font-semibold tabular-nums">
                {Math.round(contention.season.playoffOdds * 100)}%
              </span>
              <span className="opacity-70">
                {' '}
                after {contention.season.weeksPlayed} of {contention.season.weeksTotal}
              </span>
            </div>
          )}
        </div>

        {/*
          The sentence the ranks cannot carry. A bare "#7 of 12" beside "#1 of
          12" reads as a contradiction rather than as two different questions,
          and the whole point is that both are true at once.
        */}
        {fielded && !fielded.unset && fielded.gap > 0 && (
          <p className="mt-3 border-t border-current/15 pt-3 text-sm">
            Every rank above grades the best lineup this roster can field. What you have set
            for this week is worth {formatValue(fielded.gap)} less than that.
          </p>
        )}
        {fielded?.unset && (
          <p className="mt-3 border-t border-current/15 pt-3 text-sm">
            Every rank above grades the best lineup this roster can field. You have no lineup
            set, so there is nothing to compare it against.
          </p>
        )}
      </div>

      {/*
        After the window, and deliberately not before it. Everything above this
        point is about a decision still open — the lineup on Sunday, the trades
        this season is worth making. This is the seasons already played, and it
        is the one panel on the tab a manager cannot act on.
      */}
      <BenchPoints
        report={bench.report}
        loading={bench.loading}
        failed={bench.failed}
        truncated={bench.truncated}
        userId={roster.ownerId}
        bestBall={league.settings.bestBall}
      />

      <ContentionScatter
        contention={contentionPoints}
        teamNames={teamNames}
        myRosterId={myRosterId}
      />

      <PositionalStrengthChart positions={positions} />

      {scarcity && <ScarcityChart scarcity={scarcity} teamCount={contention.teamCount} />}

      <section className="card mt-4">
        <h3 className="font-semibold">Tradeable surplus</h3>
        <p className="mt-1 text-sm text-subtle">
          Players who don't crack your lineup but would start elsewhere. These are what
          you trade from.
        </p>
        {surpluses.length === 0 ? (
          <p className="mt-4 text-sm text-subtle">
            No clear surplus — every player good enough to start somewhere is already in
            your lineup.
          </p>
        ) : (
          /*
            Four columns is one too many for 375px: the chip, the two
            right-hand figures and the gaps left the name 81px, so the list that
            names your tradeable players rendered them "Christ…", "Rhamo…". The
            two figures move to a second line below `sm`, indented under the
            name so the chip still reads as the row's marker rather than as a
            bullet for two rows.
          */
          <ul className="mt-4 space-y-2">
            {surpluses.map((surplus) => (
              <li
                key={surplus.player.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm"
              >
                <span
                  className={`inline-flex w-11 shrink-0 justify-center rounded px-1.5 py-0.5 text-xs font-semibold ${
                    POSITION_STYLES[surplus.player.position].chip
                  }`}
                >
                  {surplus.player.position}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {surplus.player.name}
                </span>
                <span className="order-last flex w-full items-baseline justify-between gap-3 pl-14 text-subtle sm:order-none sm:w-auto sm:justify-end sm:pl-0">
                  <span className="shrink-0">
                    starts on {surplus.wouldStartOn}{' '}
                    {surplus.wouldStartOn === 1 ? 'team' : 'teams'}
                  </span>
                  <span className="w-16 shrink-0 text-right tabular-nums">
                    {formatValue(surplus.value)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card mt-4">
        <h3 className="font-semibold">What to focus on</h3>
        <ul className="mt-3 space-y-2.5">
          {focus.map((item) => (
            <li key={item} className="flex gap-2 text-sm text-muted">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
