import { useState, type ReactNode } from 'react';
import type {
  LeagueHistoryStats,
  ManagerKey,
  SeasonStanding,
  StandingsMode,
  TableRow,
  WeekRecord,
} from '../engine/leagueHistory';
import { EmptyState } from './EmptyState';

interface Props {
  stats: LeagueHistoryStats | undefined;
  loading: boolean;
  failed: boolean;
  /** The walk could not reach every season, so "all time" is a floor. */
  truncated: boolean;
  mode: StandingsMode;
  onModeChange: (mode: StandingsMode) => void;
  /** The claimed team's manager, so the rivalries open on him. */
  myKey: ManagerKey | null;
}

const points = (n: number) => n.toFixed(2);
const pct = (wins: number, losses: number, ties = 0) => {
  const games = wins + losses + ties;
  return games === 0 ? '—' : `${Math.round(((wins + ties / 2) / games) * 1000) / 10}%`;
};

function Section({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <h3 className="font-display text-xl font-bold tracking-tight">{title}</h3>
      {note && <p className="mt-1 text-sm text-muted">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * The league's history: champions, records, the all-time table, rivalries (#52).
 *
 * The fun surface, and honest about being one. Every figure is real arithmetic
 * over the league's own results, and none of it feeds into what a player is
 * worth. Records and the table read the regular season only — placement games
 * and the toilet bowl are played by teams already out of contention.
 */
export function LeagueHistory({
  stats,
  loading,
  failed,
  truncated,
  mode,
  onModeChange,
  myKey,
}: Props) {
  const [rival, setRival] = useState<ManagerKey | null>(null);

  if (failed && !stats) {
    return (
      <EmptyState title="The league's history didn't load">
        Every past season is a separate request per week, and one of them failed. Nothing
        else in the app depends on this; try again later.
      </EmptyState>
    );
  }
  if (loading || !stats) {
    return (
      <div role="status" aria-label="Loading the league's history" className="space-y-4">
        <div className="skeleton h-10 w-64" />
        <div className="skeleton h-40 w-full rounded-card" />
        <div className="skeleton h-64 w-full rounded-card" />
      </div>
    );
  }

  const name = (key: ManagerKey) => stats.managers.get(key)?.name ?? 'Unknown';
  const owned = (key: ManagerKey) => stats.managers.get(key)?.owned ?? true;
  const finished = stats.seasons.filter((season) => season.complete);
  const seasonCount = stats.seasons.length;
  const focus = rival ?? myKey ?? stats.table[0]?.key ?? null;

  const who = (standing: SeasonStanding | undefined) =>
    standing ? (
      <>
        <span className="font-semibold text-ink">{standing.teamName}</span>
        <span className="text-subtle">
          {' '}
          · {owned(standing.key) ? name(standing.key) : 'no manager'}
        </span>
      </>
    ) : (
      '—'
    );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
          League history
        </h2>
        <p className="mt-1 text-sm text-muted">
          {seasonCount} {seasonCount === 1 ? 'season' : 'seasons'} ·{' '}
          <span className="tabular">{stats.games.toLocaleString('en-US')}</span> regular-season
          games{truncated ? ', as far back as Sleeper still publishes' : ''}. Real results, for
          fun: none of this feeds into what a player is worth.
        </p>
      </div>

      <Section
        title="Champions"
        note={
          finished.length === 0
            ? 'No season has finished yet. Champions appear here once a final has been played.'
            : undefined
        }
      >
        {finished.length > 0 && (
          <>
            <div
              role="radiogroup"
              aria-label="How final standings are decided"
              className="mb-4 inline-flex gap-1 rounded-full border border-line bg-surface p-1"
            >
              {(
                [
                  ['points', 'Points-based'],
                  ['bracket', 'Official bracket'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={mode === value}
                  onClick={() => onModeChange(value)}
                  className={`min-h-11 rounded-full px-4 text-sm font-medium transition-colors focus-visible:[outline-offset:-2px] fine:min-h-8 ${
                    mode === value ? 'bg-raised text-ink elevation-raised' : 'text-subtle hover:text-ink'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mb-4 max-w-3xl text-xs text-subtle">
              {mode === 'points'
                ? 'Playoff teams rank by how long they survived; two knocked out in the same round are split by what they scored in that game. Placement games and the toilet bowl are ignored — nobody sets a lineup after being knocked out. Everyone else ranks by regular-season record.'
                : 'Where a placement game was played, it decides the two places it was for. The bottom of the table is by regular-season record.'}
            </p>

            <ul className="space-y-3">
              {[...finished].reverse().map((season) => {
                const standings = season.standings;
                return (
                  <li key={season.season} className="rounded-xl border border-line bg-raised p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <p className="font-display text-2xl font-bold tracking-tight tabular">
                        {season.season}
                      </p>
                      <p className="text-sm">
                        <span className="text-subtle">Champion </span>
                        {who(standings[0])}
                      </p>
                    </div>
                    <p className="mt-1 text-sm text-muted">
                      Runner-up {who(standings[1])} · last {who(standings.at(-1))}
                    </p>
                    <details className="group mt-2">
                      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-sm font-medium text-accent fine:min-h-8 [&::-webkit-details-marker]:hidden">
                        Final standings
                      </summary>
                      <ol className="mt-1 space-y-1 text-sm">
                        {standings.map((standing) => (
                          <li key={standing.rosterId} className="flex items-baseline gap-3">
                            <span className="w-6 shrink-0 text-right font-semibold tabular text-subtle">
                              {standing.finish}
                            </span>
                            <span className="min-w-0 flex-1">{who(standing)}</span>
                            <span className="shrink-0 tabular text-subtle">
                              {standing.wins}–{standing.losses}
                              {standing.ties > 0 ? `–${standing.ties}` : ''}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </details>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Section>

      <Section title="Records" note="Regular season only.">
        <dl className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ['Highest week', stats.records.highestWeek],
              ['Lowest week', stats.records.lowestWeek],
              ['Biggest blowout', stats.records.biggestBlowout],
              ['Narrowest win', stats.records.narrowestWin],
              ['Highest-scoring loss', stats.records.highestScoringLoss],
              ['Lowest-scoring win', stats.records.lowestScoringWin],
            ] as [string, WeekRecord | null][]
          ).map(([label, entry]) =>
            entry ? (
              <div key={label} className="rounded-xl border border-line bg-raised p-4">
                <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">{label}</dt>
                <dd className="mt-1 font-display text-3xl font-bold tracking-tight tabular">
                  {points(entry.points)}
                </dd>
                <dd className="mt-1 text-sm text-muted">
                  {name(entry.key)}
                  {entry.opponent &&
                    ` vs ${name(entry.opponent.key)} (${points(entry.opponent.points)})`}{' '}
                  · {entry.season} week {entry.week}
                </dd>
              </div>
            ) : null,
          )}
          {stats.records.bestSeason && (
            <div className="rounded-xl border border-line bg-raised p-4">
              <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">Best season</dt>
              <dd className="mt-1 font-display text-3xl font-bold tracking-tight tabular">
                {stats.records.bestSeason.wins}–{stats.records.bestSeason.losses}
              </dd>
              <dd className="mt-1 text-sm text-muted">
                {name(stats.records.bestSeason.key)} · {stats.records.bestSeason.season}
              </dd>
            </div>
          )}
          {stats.records.worstSeason && (
            <div className="rounded-xl border border-line bg-raised p-4">
              <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">Worst season</dt>
              <dd className="mt-1 font-display text-3xl font-bold tracking-tight tabular">
                {stats.records.worstSeason.wins}–{stats.records.worstSeason.losses}
              </dd>
              <dd className="mt-1 text-sm text-muted">
                {name(stats.records.worstSeason.key)} · {stats.records.worstSeason.season}
              </dd>
            </div>
          )}
        </dl>
      </Section>

      <Section
        title="All-time table"
        note={
          <>
            <strong className="text-ink">All-play</strong> is the record you would have had
            playing every team every week. <strong className="text-ink">Luck</strong> is how far
            your real win rate sits above or below it: the schedule, separated from the team.
          </>
        }
      >
        <div className="-mx-5 overflow-x-auto px-5">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-subtle">
                <th scope="col" className="py-2 pr-3">Manager</th>
                <th scope="col" className="px-2 py-2 text-right">Seasons</th>
                <th scope="col" className="px-2 py-2 text-right">Record</th>
                <th scope="col" className="px-2 py-2 text-right">Titles</th>
                <th scope="col" className="px-2 py-2 text-right">Playoffs</th>
                <th scope="col" className="px-2 py-2 text-right">Last</th>
                <th scope="col" className="px-2 py-2 text-right">All-play</th>
                <th scope="col" className="px-2 py-2 text-right">Luck</th>
                <th scope="col" className="py-2 pl-2 text-right">Streaks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {stats.table.map((row: TableRow) => {
                const real = (row.wins + row.ties / 2) / Math.max(1, row.wins + row.losses + row.ties);
                const allPlay = row.allPlayWins / Math.max(1, row.allPlayWins + row.allPlayLosses);
                const luck = Math.round((real - allPlay) * 1000) / 10;
                return (
                  <tr key={row.key} className={row.key === myKey ? 'bg-accent-soft' : undefined}>
                    <th scope="row" className="py-2 pr-3 text-left font-medium">
                      {owned(row.key) ? name(row.key) : `${name(row.key)} (no manager)`}
                    </th>
                    <td className="px-2 py-2 text-right tabular">{row.seasons}</td>
                    <td className="px-2 py-2 text-right tabular">
                      {row.wins}–{row.losses}
                      {row.ties > 0 ? `–${row.ties}` : ''}
                    </td>
                    <td className="px-2 py-2 text-right tabular font-semibold">{row.titles || '—'}</td>
                    <td className="px-2 py-2 text-right tabular">{row.playoffs || '—'}</td>
                    <td className="px-2 py-2 text-right tabular">{row.lastPlaces || '—'}</td>
                    <td className="px-2 py-2 text-right tabular">
                      {pct(row.allPlayWins, row.allPlayLosses)}
                    </td>
                    <td
                      className={`px-2 py-2 text-right tabular ${
                        luck > 0 ? 'text-positive' : luck < 0 ? 'text-negative' : 'text-subtle'
                      }`}
                    >
                      {luck > 0 ? '+' : luck < 0 ? '−' : ''}
                      {Math.abs(luck).toFixed(1)}
                    </td>
                    <td className="py-2 pl-2 text-right tabular text-muted">
                      W{row.longestWinStreak} · L{row.longestLossStreak}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {focus && (
        <Section title="Rivalries" note="Head-to-head across every regular season.">
          <label htmlFor="rival" className="text-xs font-semibold uppercase tracking-wide text-subtle">
            Manager
          </label>
          <select
            id="rival"
            value={focus}
            onChange={(event) => setRival(event.target.value)}
            className="mt-1 block min-h-11 w-full max-w-sm rounded-xl border border-control bg-surface px-3 text-ink fine:min-h-9"
          >
            {stats.table.map((row) => (
              <option key={row.key} value={row.key}>
                {name(row.key)}
              </option>
            ))}
          </select>
          <ul className="mt-4 divide-y divide-line text-sm">
            {[...(stats.headToHead.get(focus) ?? new Map()).entries()]
              .sort(
                ([, a], [, b]) =>
                  b.wins + b.losses + b.ties - (a.wins + a.losses + a.ties) || b.wins - a.wins,
              )
              .map(([other, line]) => (
                <li key={other} className="flex items-baseline gap-3 py-2">
                  <span className="min-w-0 flex-1">vs {name(other)}</span>
                  <span className="shrink-0 font-semibold tabular">
                    {line.wins}–{line.losses}
                    {line.ties > 0 ? `–${line.ties}` : ''}
                  </span>
                  <span className="w-28 shrink-0 text-right tabular text-subtle">
                    {points(line.pointsFor)} – {points(line.pointsAgainst)}
                  </span>
                </li>
              ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
