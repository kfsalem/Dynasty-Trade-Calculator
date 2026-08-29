import type { ReactNode } from 'react';
import type { League } from '../types';
import { pprLabel, scoringBadges } from '../lib/scoringText';

interface Props {
  league: League;
  onReset: () => void;
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-page px-2.5 py-1 text-xs font-medium text-muted">
      {children}
    </span>
  );
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
          {/*
            The rules that move one position against the others, which "PPR" on
            its own actively hides: the league this was written against is
            TE-premium with six-point passing touchdowns, and the header claimed
            only that it counted receptions.
          */}
          {scoringBadges(settings.scoring).map((badge) => (
            <Badge key={badge}>{badge}</Badge>
          ))}
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
