import { useMemo, useState } from 'react';
import type { DraftPick, League, Player, PlayerValue, Position, TradeSideResult } from '../types';
import { evaluateTrade, FAIRNESS_LABEL, type TradeContext } from '../engine/trade';
import { AssetPicker } from './AssetPicker';
import type { SnapShare } from '../engine/snapShare';
import type { Opportunity } from '../engine/opportunity';
import type { PlayerRole } from '../engine/role';
import type { ActivityAdjustment } from '../engine/activityFactor';
import { formatValue } from '../lib/format';

/**
 * A trade handed to the builder pre-filled — currently from the suggestion
 * engine, so an idea can be inspected and edited rather than only read.
 */
export interface PendingTrade {
  teamA: number;
  teamB: number;
  givesA: { playerIds: string[]; pickIds: string[] };
  givesB: { playerIds: string[]; pickIds: string[] };
}

interface Props {
  league: League;
  players: Map<string, Player>;
  values: Map<string, PlayerValue>;
  picks: DraftPick[];
  picksUnavailable: boolean;
  snaps?: Map<string, SnapShare>;
  usage?: Map<string, Opportunity>;
  roles?: Map<string, PlayerRole>;
  chartSeason?: number | null;
  /** What a changing role did to each value, keyed by Sleeper id. */
  adjustments?: Map<string, ActivityAdjustment>;
  /** Positions the value source prices, so an unvalued player can say which. */
  priced?: Set<Position>;
  /** Claimed team, if any — anchors the left side to you. */
  myRosterId: number | null;
  /**
   * Seeds the builder. The parent remounts on change (via `key`), so this is
   * read once — after that the selections belong to the user.
   */
  initial?: PendingTrade | null;
}

const toggle = (set: Set<string>, id: string): Set<string> => {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

function VorsBadge({ delta }: { delta: number }) {
  const positive = delta > 0;
  const neutral = delta === 0;
  return (
    <span
      className={`font-semibold tabular-nums ${
        neutral ? 'text-gray-500' : positive ? 'text-fantasy-green' : 'text-fantasy-red'
      }`}
    >
      {positive ? '+' : ''}
      {formatValue(delta)}
    </span>
  );
}

function SideSummary({ side }: { side: TradeSideResult }) {
  return (
    <div className="min-w-0">
      <h4 className="truncate font-semibold">{side.teamName}</h4>
      <dl className="mt-2 space-y-1 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-gray-500">Receives</dt>
          <dd className="tabular-nums">{formatValue(side.incomingValue)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-gray-500">Sends</dt>
          <dd className="tabular-nums">{formatValue(side.outgoingValue)}</dd>
        </div>
        <div className="flex justify-between gap-4 border-t border-gray-200 pt-1">
          <dt className="text-gray-500">Net value</dt>
          <dd
            className={`font-semibold tabular-nums ${
              side.netValue > 0
                ? 'text-fantasy-green'
                : side.netValue < 0
                  ? 'text-fantasy-red'
                  : ''
            }`}
          >
            {side.netValue > 0 ? '+' : ''}
            {formatValue(side.netValue)}
          </dd>
        </div>
        <div className="flex justify-between gap-4 border-t border-gray-200 pt-1">
          <dt
            className="text-gray-500"
            title="Change in best-lineup strength, measured on win-now value — what these players do for you this season, not what they are worth as assets."
          >
            Starting lineup
          </dt>
          <dd>
            <VorsBadge delta={side.vorsDelta} />
          </dd>
        </div>
        <div className="flex justify-between gap-4 text-xs text-gray-400">
          <dt>&nbsp;</dt>
          <dd className="tabular-nums">
            {formatValue(side.starterValueBefore)} → {formatValue(side.starterValueAfter)}
          </dd>
        </div>
      </dl>

      {side.warnings.length > 0 && (
        <ul className="mt-3 space-y-1">
          {side.warnings.map((warning) => (
            <li key={warning} className="flex gap-1.5 text-xs text-amber-700">
              <span aria-hidden="true">▲</span>
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TradeBuilder({
  league,
  players,
  values,
  picks,
  picksUnavailable,
  myRosterId,
  initial,
  snaps,
  usage,
  roles,
  chartSeason,
  adjustments,
  priced,
}: Props) {
  // Anchor the left side to the claimed team so the trade reads from your
  // perspective, and make sure the right side is never the same roster.
  const defaultA = initial?.teamA ?? myRosterId ?? league.rosters[0]?.rosterId ?? 1;
  const defaultB =
    initial?.teamB ??
    league.rosters.find((r) => r.rosterId !== defaultA)?.rosterId ??
    defaultA + 1;

  const [teamA, setTeamA] = useState(defaultA);
  const [teamB, setTeamB] = useState(defaultB);
  const [givesA, setGivesA] = useState({
    playerIds: new Set<string>(initial?.givesA.playerIds),
    pickIds: new Set<string>(initial?.givesA.pickIds),
  });
  const [givesB, setGivesB] = useState({
    playerIds: new Set<string>(initial?.givesB.playerIds),
    pickIds: new Set<string>(initial?.givesB.pickIds),
  });

  const ctx: TradeContext = useMemo(
    () => ({ league, players, values, picks }),
    [league, players, values, picks],
  );

  const anySelected =
    givesA.playerIds.size + givesA.pickIds.size + givesB.playerIds.size + givesB.pickIds.size >
    0;

  const analysis = useMemo(() => {
    if (!anySelected) return null;
    return evaluateTrade(
      { rosterId: teamA, playerIds: [...givesA.playerIds], pickIds: [...givesA.pickIds] },
      { rosterId: teamB, playerIds: [...givesB.playerIds], pickIds: [...givesB.pickIds] },
      ctx,
    );
  }, [anySelected, teamA, teamB, givesA, givesB, ctx]);

  // Market value, to match the "Sends"/"Receives" figures in the verdict below —
  // both are the numbers the other manager will check.
  const sumValue = (playerIds: Set<string>, pickIds: Set<string>) => {
    let total = 0;
    for (const id of playerIds) total += values.get(id)?.marketValue ?? 0;
    for (const id of pickIds) total += picks.find((p) => p.id === id)?.marketValue ?? 0;
    return total;
  };

  function changeTeam(side: 'a' | 'b', rosterId: number) {
    // Selections belong to the old roster; carrying them over would price
    // players the new team doesn't own.
    if (side === 'a') {
      setTeamA(rosterId);
      setGivesA({ playerIds: new Set(), pickIds: new Set() });
    } else {
      setTeamB(rosterId);
      setGivesB({ playerIds: new Set(), pickIds: new Set() });
    }
  }

  function reset() {
    setGivesA({ playerIds: new Set(), pickIds: new Set() });
    setGivesB({ playerIds: new Set(), pickIds: new Set() });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Trade calculator</h2>
          <p className="mt-1 text-sm text-gray-500">
            Check the assets each team sends. Values reflect this league's format.
          </p>
        </div>
        {anySelected && (
          <button type="button" onClick={reset} className="btn-secondary text-sm">
            Clear
          </button>
        )}
      </div>

      {picksUnavailable && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Draft pick values are unavailable right now, so only players can be traded.
        </p>
      )}

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <AssetPicker
          league={league}
          rosterId={teamA}
          onRosterChange={(id) => changeTeam('a', id)}
          excludeRosterId={teamB}
          players={players}
          values={values}
          picks={picks}
          selectedPlayerIds={givesA.playerIds}
          selectedPickIds={givesA.pickIds}
          onTogglePlayer={(id) =>
            setGivesA((s) => ({ ...s, playerIds: toggle(s.playerIds, id) }))
          }
          onTogglePick={(id) => setGivesA((s) => ({ ...s, pickIds: toggle(s.pickIds, id) }))}
          outgoingValue={sumValue(givesA.playerIds, givesA.pickIds)}
          snaps={snaps}
          usage={usage}
          roles={roles}
          chartSeason={chartSeason}
          adjustments={adjustments}
          priced={priced}
        />
        <AssetPicker
          league={league}
          rosterId={teamB}
          onRosterChange={(id) => changeTeam('b', id)}
          excludeRosterId={teamA}
          players={players}
          values={values}
          picks={picks}
          selectedPlayerIds={givesB.playerIds}
          selectedPickIds={givesB.pickIds}
          onTogglePlayer={(id) =>
            setGivesB((s) => ({ ...s, playerIds: toggle(s.playerIds, id) }))
          }
          onTogglePick={(id) => setGivesB((s) => ({ ...s, pickIds: toggle(s.pickIds, id) }))}
          outgoingValue={sumValue(givesB.playerIds, givesB.pickIds)}
          snaps={snaps}
          usage={usage}
          roles={roles}
          chartSeason={chartSeason}
          adjustments={adjustments}
          priced={priced}
        />
      </div>

      {analysis ? (
        <div className="card mt-4">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`rounded-full px-3 py-1 text-sm font-semibold ${
                analysis.fairnessRating === 'very_fair' || analysis.fairnessRating === 'fair'
                  ? 'bg-emerald-100 text-emerald-800'
                  : analysis.fairnessRating === 'slightly_unfair'
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-red-100 text-red-800'
              }`}
            >
              {FAIRNESS_LABEL[analysis.fairnessRating]}
            </span>
            <span className="text-sm text-gray-500 tabular-nums">
              {formatValue(analysis.valueDifference)} apart (
              {Math.round(analysis.valueDifferencePct * 100)}%)
            </span>
          </div>

          <p className="mt-3 text-gray-700">{analysis.summary}</p>

          <div className="mt-5 grid gap-6 border-t border-gray-200 pt-5 sm:grid-cols-2">
            <SideSummary side={analysis.sides[0]} />
            <SideSummary side={analysis.sides[1]} />
          </div>
        </div>
      ) : (
        <p className="mt-6 text-center text-sm text-gray-400">
          Select at least one asset to evaluate a trade.
        </p>
      )}
    </div>
  );
}
