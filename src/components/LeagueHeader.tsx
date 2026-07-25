import type { ReactNode } from 'react';
import type { League } from '../types';

interface Props {
  league: League;
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

export function LeagueHeader({ league, onReset }: Props) {
  const { settings } = league;

  return (
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
      <button type="button" onClick={onReset} className="btn-secondary shrink-0 text-sm">
        Change league
      </button>
    </div>
  );
}
