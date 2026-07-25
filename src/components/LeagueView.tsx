import type { ReactNode } from 'react';
import type { League } from '../types';
import type { RosterSummary } from '../engine/rosterValue';
import { TeamCard } from './TeamCard';
import { formatValue } from '../lib/format';

interface Props {
  league: League;
  summaries: RosterSummary[];
  onReset: () => void;
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
      {children}
    </span>
  );
}

function pprLabel(ppr: number): string {
  if (ppr >= 1) return 'PPR';
  if (ppr > 0) return `${ppr} PPR`;
  return 'Standard';
}

export function LeagueView({ league, summaries, onReset }: Props) {
  const { settings } = league;
  const topStarterValue = summaries[0]?.starterValue ?? 0;

  // Kickers and defenses have no dynasty market, so they are expected to be
  // unvalued. Flagging only skill positions keeps the warning meaningful.
  const unvalued = summaries.reduce((count, s) => {
    return (
      count +
      s.players.filter(
        (p) => !p.valued && p.player.position !== 'K' && p.player.position !== 'DEF',
      ).length
    );
  }, 0);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">
            {league.name}
          </h1>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge>{settings.isDynasty ? 'Dynasty' : 'Redraft'}</Badge>
            <Badge>{settings.numQbs === 2 ? 'Superflex' : '1QB'}</Badge>
            <Badge>{settings.teamCount}-team</Badge>
            <Badge>{pprLabel(settings.ppr)}</Badge>
            <Badge>{league.season}</Badge>
            {settings.taxiSlots > 0 && <Badge>{settings.taxiSlots} taxi</Badge>}
          </div>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="btn-secondary shrink-0 text-sm"
        >
          Change league
        </button>
      </div>

      <p className="mt-6 text-sm text-gray-500">
        Ranked by the best lineup each roster can field — computed from the league's{' '}
        {settings.startingSlots.length} starting slots, not from whatever lineup was last
        set. Values are dynasty, from FantasyCalc, matched to this league's format.
      </p>

      {unvalued > 0 && (
        <p className="mt-2 text-sm text-gray-400">
          {unvalued} rostered skill {unvalued === 1 ? 'player has' : 'players have'} no
          dynasty value listed and {unvalued === 1 ? 'counts' : 'count'} as 0.
        </p>
      )}

      <div className="mt-6 space-y-3">
        {summaries.map((summary, i) => (
          <TeamCard
            key={summary.rosterId}
            summary={summary}
            league={league}
            rank={i + 1}
            topStarterValue={topStarterValue}
          />
        ))}
      </div>

      <p className="mt-8 text-center text-xs text-gray-400">
        League total:{' '}
        {formatValue(summaries.reduce((sum, s) => sum + s.totalValue, 0))} across{' '}
        {summaries.length} rosters
      </p>
    </div>
  );
}
