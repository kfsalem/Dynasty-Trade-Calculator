import { useMemo } from 'react';
import type { League, Position, SeasonPhase } from '../types';
import type { RosterSummary } from '../engine/rosterValue';
import {
  analyzeTeam,
  leagueContention,
  type SeasonOdds,
} from '../engine/analysis';
import { fieldedStanding, leagueFielded } from '../engine/fielded';
import type { Grade } from '../engine/grades';
import { bucketRoster, type Bucket } from '../engine/buckets';
import { futureLineup, leagueDemand } from '../engine/analysis';
import type { PlayerRole } from '../engine/role';
import type { DraftPick } from '../types';
import { isGameWeek } from '../engine/season';
import type { PositionScarcity } from '../engine/replacement';
import type { FreeAgentBoard } from '../engine/freeAgents';
import type { WeekProjections } from '../platforms/types';
import type { WeekEvidence } from '../engine/weekEvidence';
import type { BenchReport } from '../engine/benchPoints';
import { POSITION_STYLES, formatValue } from '../lib/format';
import { BenchPoints } from './BenchPoints';
import { ContentionScatter } from './charts/ContentionScatter';
import { PositionalStrengthChart } from './charts/PositionalStrengthChart';
import { SlotStrengthChart } from './charts/SlotStrengthChart';
import { ScarcityChart } from './charts/ScarcityChart';
import { WeeklyLineup } from './WeeklyLineup';
import { PlayerName } from './PlayerName';
import { PlayerAvatar } from './PlayerAvatar';
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
  /**
   * The waiver wire, so the lineup panel can look past the roster — with the
   * undrafted rookie class taken off (`lineupBoard`).
   */
  freeAgents: FreeAgentBoard | undefined;
  /** This week's projected points in the league's scoring, when there are any. */
  projected?: ReadonlyMap<string, number>;
  /** This week's raw projections, for each row's opponent. */
  projections?: WeekProjections;
  /** What each player has done this season, shown beside the lineup's calls. */
  evidence?: ReadonlyMap<string, WeekEvidence>;
  /** The last week that evidence covers. */
  evidenceWeek?: number | null;
  /** NFL teams whose game this week has kicked off. */
  lockedTeams?: ReadonlySet<string>;
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
  /** This roster's picks. Empty until the pick values land — see `picksSettled`. */
  picks: DraftPick[];
  /**
   * Whether `picks` is the finished list.
   *
   * Pick values load in their own query, so an empty `picks` means "not yet" as
   * often as it means "none". The decomposition counts picks as its whole
   * lottery bucket, so drawing it before they arrive would report a manager's
   * bets as smaller than they are.
   */
  picksSettled: boolean;
  /** Measured role, when the activity data is in hand. */
  roles: Map<string, PlayerRole> | undefined;
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

/**
 * Ordered most useful to least, which is the order a manager reads them in.
 *
 * No colour. Buckets are a new categorical dimension and the design system has
 * no palette to spare for one — status hues are reserved and position hues are
 * fixed — so the emphasis here is carried by weight and size, which is what the
 * register asks for anyway.
 */
const BUCKETS: { key: Bucket; label: string; note: string }[] = [
  { key: 'core', label: 'Core', note: 'Starts now, and still starts in three years.' },
  { key: 'depth', label: 'Depth', note: 'Useful, not declining, not in your best eleven.' },
  {
    key: 'depreciating',
    label: 'Depreciating',
    note: 'Past the age cliff for the position. Someone would start him today.',
  },
  {
    key: 'lottery',
    label: 'Lottery',
    note: 'Picks, and players who have not yet shown what they are.',
  },
  { key: 'dead', label: 'Dead weight', note: 'Nobody in this league would start him.' },
];

/**
 * The holdings bar's segments, darkest to lightest in the order the buckets
 * are listed. Shades of ink, not hues — see the bar itself.
 */
const BUCKET_SHADE: Record<Bucket, string> = {
  core: 'bg-ink',
  depth: 'bg-ink/70',
  depreciating: 'bg-ink/45',
  lottery: 'bg-ink/25',
  dead: 'bg-ink/12',
};

/**
 * One figure under the verdict. The contention card used to tint itself by
 * quadrant in the status colours, which are reserved; the verdict is carried by
 * its words now, and the tiles are neutral.
 */
function Tile({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return (
    <div className="rounded-xl border border-line bg-raised p-4">
      <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">{label}</dt>
      <dd className="mt-2 font-display text-3xl font-bold tracking-tight tabular">{value}</dd>
      {note && <dd className="mt-1 text-sm text-muted tabular">{note}</dd>}
    </div>
  );
}

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
  projected,
  projections,
  evidence,
  evidenceWeek,
  lockedTeams,
  activityCurrent,
  bench,
  bids,
  picks,
  picksSettled,
  roles,
  onChangeTeam,
}: Props) {
  // `analyzeTeam` reaches `contentionProfile`, which carries the same
  // once-per-team projection cost as `leagueContention` below — so it is
  // memoised on the same terms rather than re-running on every render.
  const analysis = useMemo(
    () => analyzeTeam(myRosterId, summaries, league.settings, season),
    [myRosterId, summaries, league.settings, season],
  );
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
  /*
    The roster taken apart. Needs the three-year lineup and the league's demand
    for a position, both of which `analyzeTeam` computes for its own reasons —
    recomputed here rather than threaded through it, because the decomposition
    is a property of one roster and `TeamAnalysis` is the only thing that wants
    it. Cheap: one projection and one pass over the league's lineups.
  */
  const buckets = useMemo(() => {
    const summary = summaries.find((s) => s.rosterId === myRosterId);
    if (!summary) return null;

    return bucketRoster({
      summary,
      futureStarterIds: new Set(
        futureLineup(summary, league.settings)
          .map((slot) => slot.entry?.player.id)
          .filter((id): id is string => Boolean(id)),
      ),
      demand: leagueDemand(summaries),
      picks,
      roles,
    });
  }, [summaries, myRosterId, league.settings, picks, roles]);

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

  const { contention, positions, surpluses, focus, slots } = analysis;
  const summary = summaries.find((s) => s.rosterId === myRosterId);
  const showFielded = fielded !== null && !fielded.unset && fielded.gap > 0;

  return (
    <div className="space-y-6">
      {/*
        The verdict first (#120). The contention window is the one answer this
        tab exists to give — contender, rebuilder, or somewhere in between — so
        it leads in display type, with its advice under it and the ranks behind
        it as tiles. The ranks' caveat, which lineup they grade, is one tap
        away rather than a paragraph under every figure.
      */}
      <section
        aria-labelledby="verdict-heading"
        className="rounded-card border border-line bg-surface p-5 elevation-overlay sm:p-8"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 truncate text-sm text-muted">
            <span className="font-semibold text-ink">{roster.teamName}</span>
            <span className="tabular">
              {' · '}
              {roster.wins}–{roster.losses}
              {roster.ties > 0 ? `–${roster.ties}` : ''}
            </span>
            {' · measured against the other '}
            {contention.teamCount - 1} teams
          </p>
          <button type="button" onClick={onChangeTeam} className="btn-secondary text-sm">
            Not my team
          </button>
        </div>

        <p className="mt-6 text-xs font-semibold uppercase tracking-wide text-subtle">
          Contention window
        </p>
        <h2
          id="verdict-heading"
          className="mt-1 font-display text-4xl font-extrabold tracking-tight sm:text-5xl"
        >
          {contention.label}
        </h2>
        <p className="mt-3 max-w-2xl text-base text-muted sm:text-lg">{contention.advice}</p>

        <dl className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile
            label="Lineup now"
            value={`#${contention.nowRank} of ${contention.teamCount}`}
            note={marginPhrase(contention.nowGrade)}
          />
          <Tile
            label="In 3 years"
            value={`#${contention.futureRank} of ${contention.teamCount}`}
            note={marginPhrase(contention.laterGrade)}
          />
          {/*
            The evidence behind the advice, whenever there is a season to read.
            The only figure here that knows the team has been losing.
          */}
          {contention.season && (
            <Tile
              label="Playoff odds"
              value={`${Math.round(contention.season.playoffOdds * 100)}%`}
              note={`after ${contention.season.weeksPlayed} of ${contention.season.weeksTotal}`}
            />
          )}
          {/*
            The rank the two above are silent about: the eleven actually set,
            not the eleven this roster can field. Only when the two disagree.
          */}
          {showFielded && (
            <Tile
              label="Fielding"
              value={`#${fielded.fieldedRank} of ${fielded.ranked}`}
              note="as set this week"
            />
          )}
        </dl>

        {(showFielded || fielded?.unset) && (
          <details className="group mt-4 text-sm text-muted">
            <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 font-medium text-accent fine:min-h-8 [&::-webkit-details-marker]:hidden">
              Which lineup these grade
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-4 w-4 transition-transform group-open:rotate-180"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </summary>
            <p className="mt-1 max-w-2xl">
              {fielded?.unset
                ? 'Every rank above grades the best lineup this roster can field. You have no lineup set, so there is nothing to compare it against.'
                : `Every rank above grades the best lineup this roster can field. What you have set for this week is worth ${formatValue(
                    fielded?.gap ?? 0,
                  )} less than that.`}
            </p>
          </details>
        )}
      </section>

      {/*
        The lineup, straight after the verdict. The window moves twice a season;
        the lineup has a deadline this Sunday, and a returning manager should
        land on the thing he can still do something about.
      */}
      {summary && (
        <WeeklyLineup
          roster={roster}
          summary={summary}
          settings={league.settings}
          seasonPhase={seasonPhase}
          currentWeek={currentWeek}
          byeTeams={byeTeams}
          board={freeAgents}
          projected={projected}
          projections={projections}
          evidence={evidence}
          evidenceWeek={evidenceWeek}
          lockedTeams={lockedTeams}
          activityCurrent={activityCurrent}
          bids={bids}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <section className="card">
            <h3 className="font-display text-xl font-bold tracking-tight">What to focus on</h3>
            <ul className="mt-4 space-y-3">
              {focus.map((item) => (
                <li
                  key={item}
                  className="flex gap-3 rounded-xl border border-line bg-raised p-3 text-sm text-muted"
                >
                  <span
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent"
                    aria-hidden="true"
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          {/*
            The picture behind the weakest spot named above (#101): every
            starting slot against the same slot league-wide. Beside the focus
            list rather than with the league charts, because it is about this
            lineup and something a manager can act on.
          */}
          <SlotStrengthChart slots={slots} />

          {/*
            The seasons already played: the one panel on the tab a manager
            cannot act on, so it sits under the ones he can.
          */}
          <BenchPoints
            report={bench.report}
            loading={bench.loading}
            failed={bench.failed}
            truncated={bench.truncated}
            userId={roster.ownerId}
            bestBall={league.settings.bestBall}
          />
        </div>

        <div className="min-w-0 space-y-6">
          <section className="card">
            <h3 className="font-display text-xl font-bold tracking-tight">Your trade chips</h3>
            <p className="mt-1 text-sm text-muted">
              Benched here, starters somewhere else. These are what you trade from.
            </p>
            {surpluses.length === 0 ? (
              <p className="mt-4 text-sm text-subtle">
                No clear surplus — every player good enough to start somewhere is already in
                your lineup.
              </p>
            ) : (
              <ul className="mt-4 space-y-2">
                {surpluses.map((surplus) => (
                  <li
                    key={surplus.player.id}
                    className="flex items-center gap-3 rounded-xl border border-line bg-raised p-3 text-sm"
                  >
                    <PlayerAvatar player={surplus.player} />
                    <span
                      className={`inline-flex w-11 shrink-0 justify-center rounded px-1.5 py-0.5 text-xs font-semibold ${
                        POSITION_STYLES[surplus.player.position].chip
                      }`}
                    >
                      {surplus.player.position}
                    </span>
                    <span className="min-w-0 flex-1">
                      <PlayerName
                        player={surplus.player}
                        className="block max-w-full truncate font-semibold"
                      />
                      <span className="block text-xs text-subtle">
                        starts on {surplus.wouldStartOn}{' '}
                        {surplus.wouldStartOn === 1 ? 'team' : 'teams'}
                      </span>
                    </span>
                    <span className="shrink-0 font-display text-base font-bold tabular">
                      {formatValue(surplus.value)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/*
            What the roster is made of, after what it is worth. A sum cannot say
            what a manager is actually holding; this can, and it is what makes
            advice specific.
          */}
          {buckets && buckets.total > 0 && (
            <section className="card">
              <div>
                <h3 className="font-display text-xl font-bold tracking-tight">
                  What you are holding
                </h3>
                <p className="mt-1 text-sm text-muted">
                  {formatValue(buckets.total)} in dynasty value, every asset in exactly one
                  bucket.
                  {!picksSettled && ' Picks are still loading and are not counted yet.'}
                </p>

                {/*
                  One stacked bar, with a 2px gap in the surface colour between
                  segments as the design system requires of every stacked bar.
                  Shades of ink rather than hues: buckets are a new categorical
                  dimension and there is no palette to spare for one, so the
                  order and the labels below carry identity.
                */}
                <div className="mt-4 flex h-3 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
                  {BUCKETS.filter(({ key }) => buckets.count[key] > 0).map(({ key }) => (
                    <span
                      key={key}
                      className={BUCKET_SHADE[key]}
                      style={{ width: `${(buckets.value[key] / buckets.total) * 100}%` }}
                    />
                  ))}
                </div>

                <dl className="mt-4 space-y-2">
                  {BUCKETS.filter(({ key }) => buckets.count[key] > 0).map(
                    ({ key, label, note }) => (
                      <div
                        key={key}
                        className="flex items-baseline justify-between gap-4 border-t border-line pt-2 first:border-t-0 first:pt-0"
                      >
                        <div className="flex min-w-0 items-baseline gap-2">
                          <span
                            className={`h-2.5 w-2.5 shrink-0 rounded-sm ${BUCKET_SHADE[key]}`}
                            aria-hidden="true"
                          />
                          <div className="min-w-0">
                            <dt className="font-semibold">{label}</dt>
                            <dd className="text-xs text-subtle">{note}</dd>
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="tabular font-semibold">
                            {formatValue(buckets.value[key])}
                          </div>
                          <div className="tabular text-xs text-subtle">
                            {buckets.count[key]} {buckets.count[key] === 1 ? 'asset' : 'assets'}{' '}
                            · {Math.round((buckets.value[key] / buckets.total) * 100)}%
                          </div>
                        </div>
                      </div>
                    ),
                  )}
                </dl>
              </div>
            </section>
          )}
        </div>
      </div>

      {/*
        The league around the verdict. Context rather than answer, so it comes
        last: where every team sits, what each position holds here, and what a
        position is worth to replace.
      */}
      <section aria-labelledby="league-context-heading" className="space-y-4">
        <h3
          id="league-context-heading"
          className="font-display text-xl font-bold tracking-tight"
        >
          How the league compares
        </h3>
        <ContentionScatter
          contention={contentionPoints}
          teamNames={teamNames}
          myRosterId={myRosterId}
        />
        <PositionalStrengthChart positions={positions} />
        {scarcity && <ScarcityChart scarcity={scarcity} teamCount={contention.teamCount} />}
      </section>
    </div>
  );
}
