import type { ReactNode } from 'react';
import type { League } from '../types';
import { pprLabel, scoringBadges } from '../lib/scoringText';
import { valuesLine } from '../lib/valuesText';
import type { ValueOrigin } from '../values/source';
import { HeaderPopover } from './HeaderPopover';

interface Props {
  league: League;
  /** Which copy of the market the values are (#43). */
  valuesOrigin?: ValueOrigin;
  onReset: () => void;
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-raised px-2.5 py-1 text-xs font-medium text-muted">
      {children}
    </span>
  );
}

/**
 * The league, as a pill in the header that opens onto its rules (#120).
 *
 * It used to be a page title with a row of badges over every tab. The badges
 * are still all here, one tap away; the pill carries the name and the three
 * facts that change how every number reads — team count, QB format, reception
 * scoring. The name is also the page's `h1`, visually hidden, so the document
 * outline still starts with the league.
 */
export function LeagueHeader({ league, valuesOrigin, onReset }: Props) {
  const { settings } = league;
  const values = valuesLine(valuesOrigin);
  const format = `${settings.teamCount}-team · ${settings.numQbs === 2 ? 'Superflex' : '1QB'} · ${pprLabel(settings.ppr)}`;

  return (
    <>
      <h1 className="sr-only">{league.name}</h1>
      <HeaderPopover
        label={`${league.name}, ${format}. League details`}
        summary={
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate font-semibold">{league.name}</span>
            <span className="hidden truncate text-subtle md:inline">{format}</span>
          </span>
        }
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-subtle">League rules</p>
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
        {values && <p className="mt-3 text-xs text-subtle">{values}</p>}
        <button type="button" onClick={onReset} className="btn-secondary mt-4 w-full text-sm">
          Change league
        </button>
      </HeaderPopover>
    </>
  );
}
