import { useState } from 'react';
import type { RosterSummary, ValuedPlayer } from '../engine/rosterValue';
import type { SnapShare } from '../engine/snapShare';
import type { Opportunity } from '../engine/opportunity';
import type { PlayerRole } from '../engine/role';
import type { ActivityAdjustment } from '../engine/activityFactor';
import type { League, Position } from '../types';
import { SnapShareCell } from './SnapShareCell';
import { UsageCell } from './UsageCell';
import { RoleMarker } from './RoleMarker';
import { ActivityMarker } from './ActivityMarker';
import {
  POSITION_ORDER,
  POSITION_STYLES,
  formatAge,
  formatInjury,
  formatSlot,
  formatValue,
} from '../lib/format';
import { UnvaluedCell } from './UnvaluedCell';

interface Props {
  summary: RosterSummary;
  league: League;
  rank: number;
  /** Starter value of the top-ranked roster, for the comparison bar. */
  topStarterValue: number;
  /** Highlights the claimed team so it's findable at a glance. */
  isMine?: boolean;
  /** Snap shares by Sleeper id. Undefined until the static file loads. */
  snaps?: Map<string, SnapShare>;
  /** Position-appropriate opportunity metrics by Sleeper id. */
  usage?: Map<string, Opportunity>;
  /** Role from snap share, cross-checked against the published chart. */
  roles?: Map<string, PlayerRole>;
  /** Season the published chart covers, for the role description. */
  chartSeason?: number | null;
  /** What a changing role did to each value, keyed by Sleeper id. */
  adjustments?: Map<string, ActivityAdjustment>;
  /** Positions the value source prices, so an unvalued player can say which. */
  priced?: Set<Position>;
}

function PlayerLine({
  entry,
  scale,
  snaps,
  usage,
  roles,
  chartSeason,
  adjustments,
  priced,
}: {
  entry: ValuedPlayer;
  /**
   * Which number to show. The lineup is a win-now question and the bench is an
   * asset one, so each list shows the figure its own heading totals — a row
   * that did not add up to the number above it would read as a bug.
   */
  scale: 'winNow' | 'dynasty';
  snaps?: Map<string, SnapShare>;
  usage?: Map<string, Opportunity>;
  roles?: Map<string, PlayerRole>;
  chartSeason?: number | null;
  adjustments?: Map<string, ActivityAdjustment>;
  priced?: Set<Position>;
}) {
  const role = roles?.get(entry.player.id);
  const style = POSITION_STYLES[entry.player.position];
  return (
    <>
      <span
        className={`inline-flex w-11 shrink-0 justify-center rounded px-1.5 py-0.5 text-xs font-semibold ${style.chip}`}
      >
        {style.label}
      </span>
      {/* Four columns of numbers leave a long name truncating, so the full one
          stays available on hover rather than being lost. */}
      <span className="min-w-0 flex-1 truncate" title={entry.player.name}>
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
      {/* Outside the name span on purpose: inside it, a long name truncated
          the badge away entirely. */}
      <RoleMarker role={role} chartSeason={chartSeason ?? null} />
      <SnapShareCell share={snaps?.get(entry.player.id)} role={role} chartSeason={chartSeason} />
      <UsageCell usage={usage?.get(entry.player.id)} />
      <ActivityMarker adjustment={adjustments?.get(entry.player.id)} />
      {entry.valued ? (
        <span
          className="shrink-0 tabular-nums text-gray-500"
          title={
            scale === 'winNow'
              ? `Win-now ${formatValue(entry.winNowValue)} · dynasty ${formatValue(entry.value)}`
              : `Dynasty ${formatValue(entry.value)} · win-now ${formatValue(entry.winNowValue)}`
          }
        >
          {formatValue(scale === 'winNow' ? entry.winNowValue : entry.value)}
        </span>
      ) : (
        <UnvaluedCell
          position={entry.player.position}
          priced={priced}
          className="shrink-0 text-right tabular-nums text-gray-400"
        />
      )}
    </>
  );
}

export function TeamCard({
  summary,
  league,
  rank,
  topStarterValue,
  isMine,
  snaps,
  usage,
  roles,
  chartSeason,
  adjustments,
  priced,
}: Props) {
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
          {/* Say how much of the lineup the number covers whenever it is not all
              of it. Kickers and defences have no dynasty market, so in a league
              that starts them two of ten slots contribute exactly zero — and an
              empty slot and a filled one are otherwise indistinguishable in the
              one figure the rankings rank on. */}
          <span
            className="block text-xs text-gray-500"
            title={
              summary.pricedSlots < summary.totalSlots
                ? `Win-now strength of the best lineup this roster can field. ${summary.pricedSlots} of ${summary.totalSlots} starting slots hold a player the value source prices. Kickers, defences and deep-bench players have no market, so they count as zero here.`
                : 'Win-now strength of the best lineup this roster can field.'
            }
          >
            {summary.pricedSlots < summary.totalSlots
              ? `${summary.pricedSlots} of ${summary.totalSlots} starters · win-now`
              : 'starters · win-now'}
          </span>
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
              <h4
                className="text-xs font-semibold uppercase tracking-wide text-gray-500"
                title="What this lineup does for you this season. Aging starters are worth more here than their dynasty price says; prospects are worth less."
              >
                Best lineup · win-now {formatValue(summary.starterValue)}
              </h4>
              <ul className="mt-3 space-y-1.5 text-sm">
                {summary.lineup.map((assignment, i) => (
                  <li key={`${assignment.slot}-${i}`} className="flex items-center gap-2">
                    <span className="w-12 shrink-0 text-xs font-medium text-gray-400">
                      {formatSlot(assignment.slot)}
                    </span>
                    {assignment.entry ? (
                      <PlayerLine
                        entry={assignment.entry}
                        scale="winNow"
                        snaps={snaps}
                        usage={usage}
                        roles={roles}
                        chartSeason={chartSeason}
                        adjustments={adjustments}
                        priced={priced}
                      />
                    ) : (
                      <span className="flex-1 italic text-gray-400">empty</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4
                className="text-xs font-semibold uppercase tracking-wide text-gray-500"
                title="What the bench is worth as assets, on the dynasty scale — a prospect who cannot start yet is still something you can trade."
              >
                Bench · dynasty {formatValue(summary.benchValue)} ({bench.length})
              </h4>
              <ul className="mt-3 space-y-1.5 text-sm">
                {bench.length === 0 && <li className="text-gray-400">No bench players.</li>}
                {bench.slice(0, 15).map((entry) => (
                  <li key={entry.player.id} className="flex items-center gap-2">
                    <PlayerLine
                      entry={entry}
                      scale="dynasty"
                      snaps={snaps}
                      usage={usage}
                      roles={roles}
                      chartSeason={chartSeason}
                      adjustments={adjustments}
                      priced={priced}
                    />
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
