import type { ReactNode } from 'react';
import type { LeagueChoice } from '../platforms/types';
import type { League } from '../types';
import { pprLabel, scoringBadges } from '../lib/scoringText';
import { valuesLine, valuesSizeLine } from '../lib/valuesText';
import type { ValueOrigin } from '../values/source';
import { HeaderPopover } from './HeaderPopover';

interface Props {
  league: League;
  /** Which copy of the market the values are (#43). */
  valuesOrigin?: ValueOrigin;
  /** Back to the import screen, for a league that is not in `leagues`. */
  onReset: () => void;
  /** The claimed manager's leagues (#161). Absent until a team is claimed. */
  leagues?: LeagueChoice[];
  onSwitch?: (leagueId: string) => void;
}

const FORMAT_LABEL: Record<NonNullable<LeagueChoice['format']>, string> = {
  dynasty: 'Dynasty',
  keeper: 'Keeper',
  redraft: 'Redraft',
};

const choiceLine = (choice: LeagueChoice) =>
  [choice.teams ? `${choice.teams}-team` : null, choice.format ? FORMAT_LABEL[choice.format] : null]
    .filter(Boolean)
    .join(' · ');

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
 *
 * It is also the league switcher (#161). Once a team is claimed, the
 * manager's other leagues are listed first, and picking one opens it with his
 * team there claimed. Leagues he isn't in are still one step away, under "Find
 * another league".
 */
export function LeagueHeader({ league, valuesOrigin, onReset, leagues, onSwitch }: Props) {
  const { settings } = league;
  const values = valuesLine(valuesOrigin);
  // Only alongside a values line: before values load there is no price to qualify.
  const size = values ? valuesSizeLine(settings.teamCount) : null;
  const format = `${settings.teamCount}-team · ${settings.numQbs === 2 ? 'Superflex' : '1QB'} · ${pprLabel(settings.ppr)}`;
  // A list is only worth showing when there is somewhere else to go.
  const switchable =
    onSwitch && leagues && leagues.some((choice) => choice.leagueId !== league.id) ? leagues : null;

  return (
    <>
      <h1 className="sr-only">{league.name}</h1>
      <HeaderPopover
        label={`${league.name}, ${format}. ${switchable ? 'Switch league, or see its rules' : 'League details'}`}
        summary={
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate font-semibold">{league.name}</span>
            <span className="hidden truncate text-subtle md:inline">{format}</span>
          </span>
        }
      >
        {switchable && onSwitch && (
          <nav aria-label="Your leagues" className="mb-4 border-b border-line pb-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-subtle">Your leagues</p>
            <ul className="mt-2 space-y-1">
              {switchable.map((choice) =>
                choice.leagueId === league.id ? (
                  <li
                    key={choice.leagueId}
                    aria-current="true"
                    className="flex min-h-11 items-center justify-between gap-3 rounded-xl bg-raised px-3 text-sm fine:min-h-9"
                  >
                    <span className="min-w-0 truncate font-semibold">{choice.name}</span>
                    <span className="shrink-0 text-xs text-subtle">Open</span>
                  </li>
                ) : (
                  <li key={choice.leagueId}>
                    <button
                      type="button"
                      onClick={() => onSwitch(choice.leagueId)}
                      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 text-left text-sm transition-colors hover:bg-raised fine:min-h-9"
                    >
                      <span className="min-w-0 truncate font-medium">{choice.name}</span>
                      <span className="shrink-0 text-xs text-subtle">{choiceLine(choice)}</span>
                    </button>
                  </li>
                ),
              )}
            </ul>
          </nav>
        )}
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
        {size && <p className="mt-1 text-xs text-subtle">{size}</p>}
        <button type="button" onClick={onReset} className="btn-secondary mt-4 w-full text-sm">
          {switchable ? 'Find another league' : 'Change league'}
        </button>
      </HeaderPopover>
    </>
  );
}
