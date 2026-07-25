import { useState } from 'react';
import type { RosterSummary, ValuedPlayer } from '../engine/rosterValue';
import type { League } from '../types';
import {
  POSITION_ORDER,
  POSITION_STYLES,
  formatAge,
  formatInjury,
  formatSlot,
  formatValue,
} from '../lib/format';

interface Props {
  summary: RosterSummary;
  league: League;
  rank: number;
  /** Starter value of the top-ranked roster, for the comparison bar. */
  topStarterValue: number;
  /** Highlights the claimed team so it's findable at a glance. */
  isMine?: boolean;
}

function PlayerLine({ entry }: { entry: ValuedPlayer }) {
  const style = POSITION_STYLES[entry.player.position];
  return (
    <>
      <span
        className={`inline-flex w-11 shrink-0 justify-center rounded px-1.5 py-0.5 text-xs font-semibold ${style.chip}`}
      >
        {style.label}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {entry.player.name}
        {entry.player.team ? (
          <span className="ml-1.5 text-xs text-gray-400">{entry.player.team}</span>
        ) : (
          <span className="ml-1.5 text-xs text-gray-400">FA</span>
        )}
        {entry.player.injury ? (
          <span
            className="ml-1.5 text-xs font-semibold text-fantasy-red"
            title={entry.player.injury.description ?? entry.player.injury.status}
          >
            {formatInjury(entry.player.injury.status)}
          </span>
        ) : null}
      </span>
      <span className="shrink-0 tabular-nums text-gray-500">
        {entry.valued ? formatValue(entry.value) : '~0'}
      </span>
    </>
  );
}

export function TeamCard({ summary, league, rank, topStarterValue, isMine }: Props) {
  const [open, setOpen] = useState(false);

  const roster = league.rosters.find((r) => r.rosterId === summary.rosterId);
  if (!roster) return null;

  const bench = summary.players.filter((p) => !summary.starterIds.has(p.player.id));
  const positionTotal = POSITION_ORDER.reduce(
    (sum, pos) => sum + (summary.byPosition[pos] ?? 0),
    0,
  );
  const barWidth = topStarterValue > 0 ? (summary.starterValue / topStarterValue) * 100 : 0;

  return (
    <div
      className={`card !p-0 overflow-hidden ${
        isMine ? 'ring-2 ring-primary-500 ring-offset-2' : ''
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-gray-50 sm:p-5"
      >
        <span className="w-6 shrink-0 text-lg font-bold tabular-nums text-gray-400">
          {rank}
        </span>

        {roster.avatar ? (
          <img
            src={roster.avatar}
            alt=""
            loading="lazy"
            className="h-10 w-10 shrink-0 rounded-full bg-gray-100 object-cover"
          />
        ) : (
          <span className="h-10 w-10 shrink-0 rounded-full bg-gray-200" aria-hidden="true" />
        )}

        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">
            {roster.teamName}
            {isMine && (
              <span className="ml-2 rounded bg-primary-100 px-1.5 py-0.5 text-xs font-semibold text-primary-700">
                You
              </span>
            )}
          </span>
          <span className="block truncate text-sm text-gray-500">
            {roster.ownerName} · {roster.wins}-{roster.losses}
            {roster.ties > 0 ? `-${roster.ties}` : ''} · avg {formatAge(summary.weightedAge)}
          </span>
        </span>

        <span className="shrink-0 text-right">
          <span className="block text-lg font-bold tabular-nums">
            {formatValue(summary.starterValue)}
          </span>
          <span className="block text-xs text-gray-500">starters</span>
        </span>

        <svg
          className={`h-5 w-5 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {/* Starter strength relative to the strongest roster in the league. */}
      <div className="h-1 w-full bg-gray-100">
        <div className="h-full bg-primary-500" style={{ width: `${barWidth}%` }} />
      </div>

      {/* Positional value mix. */}
      {positionTotal > 0 && (
        <div className="flex h-1.5 w-full">
          {POSITION_ORDER.map((pos) => {
            const share = ((summary.byPosition[pos] ?? 0) / positionTotal) * 100;
            if (share <= 0) return null;
            return (
              <div
                key={pos}
                className={POSITION_STYLES[pos].bar}
                style={{ width: `${share}%` }}
                title={`${pos}: ${formatValue(summary.byPosition[pos] ?? 0)}`}
              />
            );
          })}
        </div>
      )}

      {open && (
        <div className="border-t border-gray-200 bg-gray-50 p-4 sm:p-5">
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Best lineup · {formatValue(summary.starterValue)}
              </h4>
              <ul className="mt-3 space-y-1.5 text-sm">
                {summary.lineup.map((assignment, i) => (
                  <li key={`${assignment.slot}-${i}`} className="flex items-center gap-2">
                    <span className="w-12 shrink-0 text-xs font-medium text-gray-400">
                      {formatSlot(assignment.slot)}
                    </span>
                    {assignment.entry ? (
                      <PlayerLine entry={assignment.entry} />
                    ) : (
                      <span className="flex-1 italic text-gray-400">empty</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Bench · {formatValue(summary.benchValue)} ({bench.length})
              </h4>
              <ul className="mt-3 space-y-1.5 text-sm">
                {bench.length === 0 && <li className="text-gray-400">No bench players.</li>}
                {bench.slice(0, 15).map((entry) => (
                  <li key={entry.player.id} className="flex items-center gap-2">
                    <PlayerLine entry={entry} />
                  </li>
                ))}
                {bench.length > 15 && (
                  <li className="pt-1 text-xs text-gray-400">
                    + {bench.length - 15} more
                  </li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
