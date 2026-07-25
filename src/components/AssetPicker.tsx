import type { DraftPick, League, Player, PlayerValue } from '../types';
import { POSITION_STYLES, formatInjury, formatValue } from '../lib/format';
import { valuePlayers } from '../engine/rosterValue';

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
                <span className="shrink-0 tabular-nums text-gray-500">
                  {formatValue(pick.value)}
                </span>
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
              <span className="shrink-0 tabular-nums text-gray-500">
                {entry.valued ? formatValue(entry.value) : '~0'}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
