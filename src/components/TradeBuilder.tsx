import { useEffect, useMemo, useState } from 'react';
import type { DraftPick, League, Player, PlayerValue, Position, TradeSideResult } from '../types';
import { evaluateTrade, FAIRNESS_LABEL, type TradeContext } from '../engine/trade';
import { AssetPicker } from './AssetPicker';
import type { SnapShare } from '../engine/snapShare';
import type { Opportunity } from '../engine/opportunity';
import type { PlayerRole } from '../engine/role';
import type { ActivityAdjustment } from '../engine/activityFactor';
import { formatValue } from '../lib/format';
import type { TradeSelection } from '../lib/share';

/**
 * A trade handed to the builder pre-filled — from the suggestion engine, so an
 * idea can be inspected and edited rather than only read, or from a shared link.
 *
 * The shape lives in `lib/share` because that is what a permalink encodes, and
 * one definition beats two that must agree.
 */
export type PendingTrade = TradeSelection;

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
  /**
   * Reports the current selection so the parent can keep it in the URL.
   *
   * Null when nothing is selected, which is what clears the trade out of the
   * address bar again — a link is only worth having while there is a trade in
   * it.
   */
  onChange?: (trade: PendingTrade | null) => void;
  /**
   * How many assets a shared link named that its roster no longer holds.
   *
   * Read once at mount, like `initial` and for the same reason: it describes
   * the trade that arrived, not the one on screen a dozen edits later.
   */
  droppedFromLink?: number;
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

/**
 * Copy the current address, which is the trade.
 *
 * The button exists even though the URL is already correct in the address bar,
 * because on a phone the address bar is half-hidden and selecting it is
 * fiddly — and a trade gets discussed in a league group chat, on a phone, far
 * more often than anywhere else.
 *
 * `navigator.clipboard` needs a secure context and a permission that can be
 * refused, so the failure path shows the link instead of insisting. Falling
 * back to a `document.execCommand` trick would be the other option; showing
 * someone the thing they asked for is less clever and never breaks.
 */
function CopyLink() {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state !== 'copied') return;
    const timer = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setState('copied');
    } catch {
      setState('failed');
    }
  }

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={copy}
        className="btn-secondary text-sm"
        title="Copies a link to this exact trade. Anyone who opens it gets the league loaded and both sides filled in."
      >
        {state === 'copied' ? 'Link copied' : 'Copy link'}
      </button>
      {state === 'failed' && (
        <input
          readOnly
          value={window.location.href}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Link to this trade"
          className="mt-2 w-64 max-w-full rounded-lg border border-gray-300 px-2 py-1 text-xs text-gray-600"
        />
      )}
    </div>
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
  onChange,
  droppedFromLink,
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

  /**
   * The link's losses, retired at the first touch.
   *
   * Held here rather than read from the prop on every render because the notice
   * speaks about the trade *as it arrived*. Once the user has moved an asset the
   * trade is theirs, and a standing complaint about a link they have already
   * edited past — or cleared outright — is a statement about something that is
   * no longer on the screen. A fresh seed remounts this component and brings its
   * own count, so nothing needs to be reset by hand.
   */
  const [dropped, setDropped] = useState(droppedFromLink ?? 0);

  const ctx: TradeContext = useMemo(
    () => ({ league, players, values, picks }),
    [league, players, values, picks],
  );

  const anySelected =
    givesA.playerIds.size + givesA.pickIds.size + givesB.playerIds.size + givesB.pickIds.size >
    0;

  // Publish the selection upward so the address bar always describes what is on
  // screen. Doing this only behind the copy button was the tempting shortcut and
  // the wrong one: people copy from the address bar out of habit, and a URL that
  // silently lagged the page would send someone the wrong offer.
  useEffect(() => {
    onChange?.(
      anySelected
        ? {
            teamA,
            teamB,
            givesA: {
              playerIds: [...givesA.playerIds],
              pickIds: [...givesA.pickIds],
            },
            givesB: {
              playerIds: [...givesB.playerIds],
              pickIds: [...givesB.pickIds],
            },
          }
        : null,
    );
  }, [anySelected, teamA, teamB, givesA, givesB, onChange]);

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

  // Every edit below retires the shared-link notice, and only edits do — the
  // mount-time report to `onChange` above must leave it standing, or a link
  // would explain itself and be dismissed in the same commit.
  function togglePlayer(side: 'a' | 'b', id: string) {
    setDropped(0);
    const set = side === 'a' ? setGivesA : setGivesB;
    set((s) => ({ ...s, playerIds: toggle(s.playerIds, id) }));
  }

  function togglePick(side: 'a' | 'b', id: string) {
    setDropped(0);
    const set = side === 'a' ? setGivesA : setGivesB;
    set((s) => ({ ...s, pickIds: toggle(s.pickIds, id) }));
  }

  function changeTeam(side: 'a' | 'b', rosterId: number) {
    // Selections belong to the old roster; carrying them over would price
    // players the new team doesn't own.
    setDropped(0);
    if (side === 'a') {
      setTeamA(rosterId);
      setGivesA({ playerIds: new Set(), pickIds: new Set() });
    } else {
      setTeamB(rosterId);
      setGivesB({ playerIds: new Set(), pickIds: new Set() });
    }
  }

  function reset() {
    setDropped(0);
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
          <div className="flex items-start gap-2">
            <CopyLink />
            <button type="button" onClick={reset} className="btn-secondary text-sm">
              Clear
            </button>
          </div>
        )}
      </div>

      {dropped > 0 && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {dropped === 1 ? 'One asset' : `${dropped} assets`} in that link{' '}
          {dropped === 1 ? 'is' : 'are'} no longer on the roster that was sending{' '}
          {dropped === 1 ? 'it' : 'them'}, so {dropped === 1 ? 'it has' : 'they have'}{' '}
          been left out. The trade below is not quite the one that was shared.
        </p>
      )}

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
          onTogglePlayer={(id) => togglePlayer('a', id)}
          onTogglePick={(id) => togglePick('a', id)}
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
          onTogglePlayer={(id) => togglePlayer('b', id)}
          onTogglePick={(id) => togglePick('b', id)}
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
