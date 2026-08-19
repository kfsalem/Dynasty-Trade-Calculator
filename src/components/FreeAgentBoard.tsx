import { useMemo, useState } from 'react';
import type { Position } from '../types';
import type { FreeAgent, FreeAgentBoard as Board } from '../engine/freeAgents';
import type { PlayerRole } from '../engine/role';
import { availability, injuryNote } from '../engine/availability';
import { POSITION_STYLES, formatInjury, formatValue } from '../lib/format';
import { SnapShareCell } from './SnapShareCell';
import { UsageCell } from './UsageCell';
import { UnvaluedCell } from './UnvaluedCell';
import { ActivityMarker } from './ActivityMarker';
import { EmptyState } from './EmptyState';

interface Props {
  board: Board;
  roles?: Map<string, PlayerRole>;
  snapsMeta?: { season: number; throughWeek: number | null; chartSeason: number | null };
  /** Whether the activity data describes the season being played. */
  activityCurrent: boolean;
  /** Positions the value source prices at all. */
  priced?: Set<Position>;
}

const POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

/**
 * How many rows of each block render before the reader asks for more.
 *
 * The wire is 893 players on the test league. Every one of them in the DOM is
 * both slow and useless — nobody scrolls a nine-hundred-row list — so the
 * filters are the primary way through it and this is the backstop for someone
 * who really does want to page down.
 */
const PAGE = 50;

/**
 * The waiver wire, priced where anyone prices it.
 *
 * **Two blocks, not one ranked list, and the split is the honest part.**
 * FantasyCalc's universe is about one league's worth of players, so it prices
 * roughly a quarter of the wire and has never heard of the rest. Ranking all of
 * them together would mean inventing a number for two-thirds of the list, and
 * this app's standing rule is that a missing value is not a zero (#10). So the
 * priced block is ordered by value, the unpriced block by who is on the field,
 * and the two are never added together.
 */
export function FreeAgentBoard({
  board,
  roles,
  snapsMeta,
  activityCurrent,
  priced,
}: Props) {
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState<Position | 'ALL'>('ALL');
  const [expanded, setExpanded] = useState(false);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (entry: FreeAgent) =>
      (position === 'ALL' || entry.player.position === position) &&
      (needle === '' ||
        entry.player.name.toLowerCase().includes(needle) ||
        (entry.player.team ?? '').toLowerCase().includes(needle));
  }, [query, position]);

  const pricedRows = useMemo(() => board.priced.filter(matches), [board.priced, matches]);
  const unpricedRows = useMemo(
    () => board.unpriced.filter(matches),
    [board.unpriced, matches],
  );

  const total = pricedRows.length + unpricedRows.length;
  const limit = expanded ? Infinity : PAGE;

  return (
    <div>
      <h2 className="text-xl font-bold tracking-tight">Free agents</h2>
      <p className="mt-1 text-sm text-subtle">
        {board.all.length.toLocaleString('en-US')} players on an NFL team that nobody in
        this league rosters. Values are league-adjusted, so a free agent's number means
        the same thing as a rostered player's.
      </p>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <label htmlFor="fa-search" className="sr-only">
          Search free agents by name or team
        </label>
        <input
          id="fa-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name or team"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-lg border border-control px-4 py-2.5 text-ink shadow-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent fine:py-2"
        />

        {/*
          A real radio group rather than a row of buttons: these are one choice
          out of seven, and arrow keys are what a screen-reader user will reach
          for once the role says so.
        */}
        <div
          role="radiogroup"
          aria-label="Filter by position"
          className="flex gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {(['ALL', ...POSITIONS] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={position === value}
              onClick={() => setPosition(value)}
              className={`shrink-0 rounded-lg border px-3 py-3 text-xs font-semibold transition-colors focus-visible:[outline-offset:-2px] fine:py-1.5 ${
                position === value
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-line text-subtle hover:text-ink'
              }`}
            >
              {value === 'ALL' ? 'All' : value}
            </button>
          ))}
        </div>
      </div>

      {snapsMeta && !activityCurrent && (
        /*
          Said before any number is read, not after. Through the offseason the
          only activity data in the app is last season's, and the unpriced block
          is ordered by it — so a reader who assumes it describes this year is
          being misled by the ordering itself, not by a column he can check.
        */
        <p className="mt-3 rounded-lg border border-line bg-raised px-3 py-2 text-xs text-muted">
          Playing time below is from the <strong>{snapsMeta.season} season</strong>
          {snapsMeta.throughWeek ? `, through week ${snapsMeta.throughWeek}` : ''} — the
          most recent there is. It is not this season, and it is not a projection of it.
        </p>
      )}

      {total === 0 ? (
        <div className="mt-4">
          <EmptyState title="Nobody matches">
            No free agent matches that search{position === 'ALL' ? '' : ` at ${position}`}.
            Try a different name, or clear the filter.
          </EmptyState>
        </div>
      ) : (
        <>
          <Block
            title="Priced by the market"
            count={pricedRows.length}
            explain="Ordered by league-adjusted value, the same figure every rostered player carries."
            rows={pricedRows.slice(0, limit)}
            roles={roles}
            snapsMeta={snapsMeta}
            priced={priced}
          />

          <Block
            title="No published price"
            count={unpricedRows.length}
            explain="FantasyCalc ranks about one league's worth of players, and these are outside it. Ordered by snap share instead, whoever has played most recently first — for a waiver claim, whether a man is on the field beats what a dynasty market has not gotten round to saying. The column shows his season share, so a player who has picked up snaps lately can sit above a bigger number."
            rows={unpricedRows.slice(0, limit)}
            roles={roles}
            snapsMeta={snapsMeta}
            priced={priced}
          />

          {!expanded && total > PAGE && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="btn-secondary mt-4 w-full text-sm sm:w-auto"
            >
              Show every match ({total.toLocaleString('en-US')})
            </button>
          )}
        </>
      )}
    </div>
  );
}

function Block({
  title,
  count,
  explain,
  rows,
  roles,
  snapsMeta,
  priced,
}: {
  title: string;
  count: number;
  explain: string;
  rows: FreeAgent[];
  roles?: Map<string, PlayerRole>;
  snapsMeta?: Props['snapsMeta'];
  priced?: Set<Position>;
}) {
  if (rows.length === 0) return null;

  return (
    <section className="card mt-4">
      <h3 className="flex items-baseline justify-between gap-2 font-semibold">
        <span>{title}</span>
        <span className="tabular text-sm font-normal text-subtle">
          {count.toLocaleString('en-US')}
        </span>
      </h3>
      <p className="mt-1 text-sm text-subtle">{explain}</p>

      <ul className="mt-3 divide-y divide-line">
        {rows.map((entry) => (
          <Row
            key={entry.player.id}
            entry={entry}
            role={roles?.get(entry.player.id)}
            chartSeason={snapsMeta?.chartSeason}
            priced={priced}
          />
        ))}
      </ul>

      {count > rows.length && (
        <p className="mt-3 text-xs text-subtle">
          Showing the first {rows.length} of {count.toLocaleString('en-US')}.
        </p>
      )}
    </section>
  );
}

function Row({
  entry,
  role,
  chartSeason,
  priced,
}: {
  entry: FreeAgent;
  role: PlayerRole | undefined;
  chartSeason: number | null | undefined;
  priced: Set<Position> | undefined;
}) {
  const style = POSITION_STYLES[entry.player.position];

  return (
    <li className="flex items-center gap-2 py-3 text-sm fine:py-1.5">
      <span
        className={`inline-flex w-11 shrink-0 justify-center rounded px-1.5 py-0.5 text-xs font-semibold ${style.chip}`}
      >
        {style.label}
      </span>

      <span className="min-w-0 flex-1 truncate" title={entry.player.name}>
        {entry.player.name}
        <span className="ml-1.5 text-xs text-subtle">{entry.player.team ?? 'FA'}</span>
        {entry.player.injury && (
          /* Solid red for a season-ending designation, lighter for week-to-week
             — the same two weights the roster tables use, because the two mean
             different things to a pickup: one man is unavailable all year and
             the other might play on Sunday. */
          <span
            className={`ml-1.5 text-xs font-semibold ${
              availability(entry.player) === 'out_for_season'
                ? 'text-negative'
                : 'text-caution'
            }`}
            title={injuryNote(entry.player.injury)}
          >
            {formatInjury(entry.player.injury)}
          </span>
        )}
      </span>

      <SnapShareCell
        share={entry.snaps}
        role={role}
        {...(chartSeason !== undefined ? { chartSeason } : {})}
      />
      <UsageCell usage={entry.usage} />
      <ActivityMarker adjustment={entry.adjustment} />

      {entry.value ? (
        <span
          className="w-24 shrink-0 text-right tabular-nums text-muted"
          title={`Dynasty ${formatValue(entry.value.value)} — what he would be worth to hold. Win-now ${formatValue(entry.value.winNowValue)} — what he would do for a lineup this season.`}
        >
          {formatValue(entry.value.value)}
        </span>
      ) : (
        <UnvaluedCell position={entry.player.position} priced={priced} />
      )}
    </li>
  );
}
