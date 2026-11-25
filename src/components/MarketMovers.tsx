import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { League, Player } from '../types';
import type { RosterSummary } from '../engine/rosterValue';
import { fetchValueHistory } from '../data/load';
import type { HistoryQbs } from '../values/valueHistory';
import { marketMovers, pickWindow, trendWindows, type PriceMove } from '../values/valueTrend';
import { useTrendWindow } from '../hooks/useTrendWindow';
import { POSITION_STYLES, formatValue } from '../lib/format';
import { shortDate, signedShare, signedValue } from '../lib/trendText';
import { PlayerAvatar } from './PlayerAvatar';
import { PlayerName } from './PlayerName';
import { PillButton, TrendWindowPicker } from './TrendWindowPicker';

/**
 * Market movers, on My team (#158): whose FantasyCalc price moved most over a
 * window the manager picks, on his roster or across the league.
 *
 * What is listed and why is argued in `values/valueTrend`: ranked by points,
 * only moves bigger than the typical player's over the same span, and worded
 * as a record rather than advice, because a move has not predicted the next
 * one. Loaded on demand from `App`, like the panel's chart: the history is a
 * fetch of its own and the first load has no room for this card's code.
 */

type Scope = 'mine' | 'league';

interface Props {
  league: League;
  summaries: RosterSummary[];
  myRosterId: number;
  numQbs: HistoryQbs;
}

interface Holder {
  player: Player;
  rosterId: number;
}

export function MarketMovers({ league, summaries, myRosterId, numQbs }: Props) {
  // Same key as the panel's chart, so whichever opens second reads the cache.
  const query = useQuery({
    queryKey: ['valueHistory', numQbs],
    queryFn: () => fetchValueHistory(numQbs),
    staleTime: Infinity,
    retry: 1,
  });
  const [preference, setPreference] = useTrendWindow();
  const [scope, setScope] = useState<Scope>('mine');

  const holders = useMemo(() => {
    const map = new Map<string, Holder>();
    for (const summary of summaries) {
      for (const entry of summary.players) {
        map.set(entry.player.id, { player: entry.player, rosterId: summary.rosterId });
      }
    }
    return map;
  }, [summaries]);
  const teamNames = useMemo(
    () => new Map(league.rosters.map((r) => [r.rosterId, r.teamName])),
    [league.rosters],
  );

  const windows = useMemo(() => (query.data ? trendWindows(query.data.dates) : []), [query.data]);
  const span = pickWindow(windows, preference);

  const movers = useMemo(() => {
    if (!query.data || !span) return null;
    const ids = [...holders]
      .filter(([, holder]) => scope === 'league' || holder.rosterId === myRosterId)
      .map(([id]) => id);
    return marketMovers(query.data, ids, span);
  }, [query.data, span, holders, scope, myRosterId]);

  if (query.isPending) {
    return <div className="skeleton h-64 w-full rounded-card" aria-hidden="true" />;
  }
  // No history, or a single point: there is no move to report, and the rest of
  // the tab does not depend on this card.
  if (!movers || !span) return null;

  const whose = scope === 'mine' ? 'on your roster' : 'in this league';
  const ownerOf = (id: string) => {
    if (scope === 'mine') return null;
    const rosterId = holders.get(id)?.rosterId;
    if (rosterId === myRosterId) return 'Your team';
    return rosterId === undefined ? null : (teamNames.get(rosterId) ?? null);
  };

  return (
    <section className="card" aria-labelledby="market-movers-heading">
      <h3 id="market-movers-heading" className="font-display text-xl font-bold tracking-tight">
        Market movers
      </h3>
      <p className="mt-1 text-sm text-muted">
        Whose FantasyCalc price moved most {whose}, {shortDate(span.start)} to{' '}
        {shortDate(span.end)}.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <TrendWindowPicker
          windows={windows}
          value={span.key}
          onChange={setPreference}
          label="Over"
        />
        <div
          role="group"
          aria-label="Whose players"
          className="inline-flex gap-1 rounded-full border border-line bg-surface p-1"
        >
          <PillButton pressed={scope === 'mine'} onClick={() => setScope('mine')}>
            Your roster
          </PillButton>
          <PillButton pressed={scope === 'league'} onClick={() => setScope('league')}>
            League
          </PillButton>
        </div>
      </div>

      {movers.priced === 0 ? (
        <p className="mt-4 text-sm text-subtle">
          Nobody {whose} was priced by FantasyCalc on both {shortDate(span.start)} and{' '}
          {shortDate(span.end)}.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          <MoverList
            title="Rising"
            moves={movers.rising}
            holders={holders}
            ownerOf={ownerOf}
            empty={`Nobody ${whose} gained more than ${formatValue(movers.typical)} points, the typical move over this span.`}
          />
          <MoverList
            title="Falling"
            moves={movers.falling}
            holders={holders}
            ownerOf={ownerOf}
            empty={`Nobody ${whose} lost more than ${formatValue(movers.typical)} points, the typical move over this span.`}
          />
        </div>
      )}

      <details className="group mt-4 text-sm text-muted">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 font-medium text-accent fine:min-h-8 [&::-webkit-details-marker]:hidden">
          About these figures
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
        <div className="mt-2 space-y-2">
          <p>
            The market&apos;s price at each weekly refresh, in a 10-team PPR{' '}
            {numQbs === 2 ? 'superflex' : '1QB'} league, before this league&apos;s adjustment
            — so the figures here will not match the values elsewhere on this page. The same
            price is charted in each player&apos;s panel.
          </p>
          <p>
            Ranked by points gained or lost, and only moves bigger than the typical
            player&apos;s over the same span: {formatValue(movers.typical)} points from{' '}
            {shortDate(span.start)} to {shortDate(span.end)}. A player first priced after{' '}
            {shortDate(span.start)} has no starting price, so he is not listed.
          </p>
          <p>
            This is what happened, not a forecast. Over the weeks kept so far, how far a
            player&apos;s price moved in one span has said little about where it went next.
          </p>
        </div>
      </details>
    </section>
  );
}

function MoverList({
  title,
  moves,
  holders,
  ownerOf,
  empty,
}: {
  title: string;
  moves: PriceMove[];
  holders: Map<string, Holder>;
  ownerOf: (id: string) => string | null;
  empty: string;
}) {
  return (
    <div>
      <h4 className="text-xs font-semibold tracking-wide text-subtle uppercase">{title}</h4>
      {moves.length === 0 ? (
        <p className="mt-2 text-sm text-subtle">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {moves.map((move) => {
            const player = holders.get(move.playerId)?.player;
            if (!player) return null;
            const owner = ownerOf(move.playerId);
            const up = move.change > 0;
            return (
              <li
                key={move.playerId}
                className="flex items-center gap-3 rounded-xl border border-line bg-raised p-3 text-sm"
              >
                {/*
                  No face on a phone: at 375px it left the name and the two
                  prices about 85px between them, and both truncated. The
                  lettered chip says the position either way.
                */}
                <span className="hidden sm:contents">
                  <PlayerAvatar player={player} />
                </span>
                <span
                  className={`inline-flex w-11 shrink-0 justify-center rounded px-1.5 py-0.5 text-xs font-semibold ${
                    POSITION_STYLES[player.position].chip
                  }`}
                >
                  {player.position}
                </span>
                <span className="min-w-0 flex-1">
                  <PlayerName player={player} className="block max-w-full truncate font-semibold" />
                  <span className="block truncate text-xs text-subtle tabular">
                    {owner && `${owner} · `}
                    {formatValue(move.from)} → {formatValue(move.to)}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-display text-base font-bold tabular">
                    <span
                      aria-hidden="true"
                      className={`mr-1 text-xs ${up ? 'text-positive' : 'text-negative'}`}
                    >
                      {up ? '▲' : '▼'}
                    </span>
                    {signedValue(move.change)}
                  </span>
                  {move.share !== null && (
                    <span className="block text-xs text-subtle tabular">
                      {signedShare(move.share)}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
