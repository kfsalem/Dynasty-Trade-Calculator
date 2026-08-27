import { useMemo } from 'react';
import type { League, Position, SeasonPhase } from '../types';
import type { RosterSummary } from '../engine/rosterValue';
import { analyzeTeam, leagueContention, type Quadrant } from '../engine/analysis';
import type { PositionScarcity } from '../engine/replacement';
import { POSITION_STYLES, formatValue } from '../lib/format';
import { ContentionScatter } from './charts/ContentionScatter';
import { PositionalStrengthChart } from './charts/PositionalStrengthChart';
import { ScarcityChart } from './charts/ScarcityChart';
import { WeeklyLineup } from './WeeklyLineup';

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
  onChangeTeam: () => void;
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
  onChangeTeam,
}: Props) {
  const analysis = analyzeTeam(myRosterId, summaries, league.settings);
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
          />
        </div>
      )}

      <div className={`mt-5 rounded-xl border p-5 ${QUADRANT_STYLE[contention.quadrant]}`}>
        <p className="text-xs font-semibold uppercase tracking-wide opacity-70">
          Contention window
        </p>
        <h3 className="mt-1 text-2xl font-bold">{contention.label}</h3>
        <p className="mt-2 text-sm">{contention.advice}</p>

        <div className="mt-4 flex gap-6 border-t border-current/15 pt-3 text-sm">
          <div>
            <span className="opacity-70">Now</span>{' '}
            <span className="font-semibold tabular-nums">
              #{contention.nowRank} of {contention.teamCount}
            </span>
          </div>
          <div>
            <span className="opacity-70">In 3 years</span>{' '}
            <span className="font-semibold tabular-nums">
              #{contention.futureRank} of {contention.teamCount}
            </span>
          </div>
        </div>
      </div>

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
