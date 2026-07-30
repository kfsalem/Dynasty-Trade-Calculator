import type { DraftPick, League, Player, PlayerValue } from '../types';
import { POSITION_STYLES, formatInjury, formatValue } from '../lib/format';
import { valuePlayers } from '../engine/rosterValue';
import type { SnapShare } from '../engine/snapShare';
import { SnapShareCell } from './SnapShareCell';

interface Props {
  league: League;
  rosterId: number;
  onRosterChange: (rosterId: number) => void;
  /** Roster ids already used by the other side, so a team can't trade itself. */
  excludeRosterId: number;
  players: Map<string, Player>;
  values: Map<string, PlayerValue>;
  picks: DraftPick[];
  selectedPlayerIds: Set<string>;
  selectedPickIds: Set<string>;
  onTogglePlayer: (id: string) => void;
  onTogglePick: (id: string) => void;
  outgoingValue: number;
  /** Snap shares by Sleeper id. Undefined until the static file loads. */
  snaps?: Map<string, SnapShare>;
}

/**
 * Two numbers per asset. Market is what the other manager will look up before
 * accepting; league is what the asset is worth once you account for how cheaply
 * this league replaces the position. They diverge most where it matters — a
 * quarterback in a shallow single-QB league is worth a fraction of his sticker
 * price, because the waiver wire is full of near-equivalents.
 */
function ValuePair({ market, league }: { market: number; league: number }) {
  return (
    <span className="flex shrink-0 items-baseline justify-end gap-2 tabular-nums">
      <span className="w-12 text-right text-gray-500" title="Market value">
        {formatValue(market)}
      </span>
      <span
        className="w-12 text-right text-xs font-semibold text-primary-600"
        title="Value over replacement in this league"
      >
        {formatValue(league)}
      </span>
    </span>
  );
}

export function AssetPicker({
  league,
  rosterId,
  onRosterChange,
  excludeRosterId,
  players,
  values,
  picks,
  selectedPlayerIds,
  selectedPickIds,
  onTogglePlayer,
  onTogglePick,
  outgoingValue,
  snaps,
}: Props) {
  const roster = league.rosters.find((r) => r.rosterId === rosterId);
  const entries = roster ? valuePlayers(roster.playerIds, players, values) : [];
  const ownedPicks = picks
    .filter((p) => p.ownerRosterId === rosterId)
    .sort((a, b) => a.season.localeCompare(b.season) || a.round - b.round);

  return (
    <div className="card !p-0 flex min-w-0 flex-col overflow-hidden">
      <div className="border-b border-gray-200 p-4">
        <label className="sr-only" htmlFor={`team-${rosterId}`}>
          Team
        </label>
        <select
          id={`team-${rosterId}`}
          value={rosterId}
          onChange={(e) => onRosterChange(Number(e.target.value))}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-semibold outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200"
        >
          {league.rosters.map((r) => (
            <option key={r.rosterId} value={r.rosterId} disabled={r.rosterId === excludeRosterId}>
              {r.teamName}
            </option>
          ))}
        </select>
        <p className="mt-2 text-sm text-gray-500">
          Sending away:{' '}
          <span className="font-semibold tabular-nums text-gray-900">
            {formatValue(outgoingValue)}
          </span>
        </p>
      </div>

      {/* Widths mirror ValuePair so the headings sit above their columns. */}
      <div className="flex justify-end gap-2 border-b border-gray-100 px-2 py-1.5 pr-2 text-[10px] font-semibold uppercase tracking-wide">
        <span className="w-14 text-right text-gray-400" title="Offensive snap share this season">
          Snaps
        </span>
        <span className="w-12 text-right text-gray-400">Market</span>
        <span className="w-12 text-right text-primary-500">Yours</span>
      </div>

      <div className="max-h-96 overflow-y-auto p-2">
        {ownedPicks.length > 0 && (
          <>
            <p className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Picks
            </p>
            {ownedPicks.map((pick) => (
              <label
                key={pick.id}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-gray-50"
              >
                <input
                  type="checkbox"
                  checked={selectedPickIds.has(pick.id)}
                  onChange={() => onTogglePick(pick.id)}
                  className="h-4 w-4 shrink-0 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="min-w-0 flex-1 truncate">{pick.label}</span>
                {/* A pick has no snaps; hold the column so the grid lines up. */}
                <span className="w-14 shrink-0" aria-hidden="true" />
                <ValuePair market={pick.marketValue} league={pick.value} />
              </label>
            ))}
          </>
        )}

        <p className="px-2 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
          Players
        </p>
        {entries.map((entry) => {
          const style = POSITION_STYLES[entry.player.position];
          return (
            <label
              key={entry.player.id}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-gray-50"
            >
              <input
                type="checkbox"
                checked={selectedPlayerIds.has(entry.player.id)}
                onChange={() => onTogglePlayer(entry.player.id)}
                className="h-4 w-4 shrink-0 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <span
                className={`inline-flex w-10 shrink-0 justify-center rounded px-1 py-0.5 text-xs font-semibold ${style.chip}`}
              >
                {style.label}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {entry.player.name}
                {entry.player.injury && (
                  <span className="ml-1.5 text-xs font-semibold text-fantasy-red">
                    {formatInjury(entry.player.injury.status)}
                  </span>
                )}
              </span>
              <SnapShareCell share={snaps?.get(entry.player.id)} />
              {entry.valued ? (
                <ValuePair
                  market={values.get(entry.player.id)?.marketValue ?? entry.value}
                  league={entry.value}
                />
              ) : (
                <span className="w-24 shrink-0 text-right tabular-nums text-gray-400">~0</span>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}
