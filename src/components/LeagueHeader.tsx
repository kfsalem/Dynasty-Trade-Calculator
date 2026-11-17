import type { MouseEvent, ReactNode } from 'react';
import type { LeagueChoice } from '../platforms/types';
import type { League, Manager } from '../types';
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
  /** Open the All leagues screen (#161), listed first whenever there is a list. */
  onOverview?: () => void;
  /**
   * That screen is showing. The pill then names it rather than the league
   * behind it, and the league's rules step aside, since they describe one
   * league and the screen describes all of them.
   */
  overview?: boolean;
  /**
   * The claimed team's managers, owner first, when it has several and none is
   * known to be the visitor. Asked here because the answer is used here: it
   * decides whose leagues the switcher lists (#161).
   */
  managers?: Manager[];
  onPickManager?: (userId: string) => void;
}

/**
 * Close the popover a choice was made in.
 *
 * Picking a league used to close it by accident: the header unmounted while
 * the new league loaded. A league already in the cache loads with no gap, and
 * the All leagues screen changes no league at all, so neither closes it that way.
 */
const closing = (then: () => void) => (event: MouseEvent<HTMLButtonElement>) => {
  const details = event.currentTarget.closest('details');
  if (details) details.open = false;
  then();
};

const ROW =
  'flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 text-left text-sm fine:min-h-9';

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
export function LeagueHeader({
  league,
  valuesOrigin,
  onReset,
  leagues,
  onSwitch,
  onOverview,
  overview = false,
  managers,
  onPickManager,
}: Props) {
  const { settings } = league;
  const values = valuesLine(valuesOrigin);
  // Only alongside a values line: before values load there is no price to qualify.
  const size = values ? valuesSizeLine(settings.teamCount) : null;
  const format = `${settings.teamCount}-team · ${settings.numQbs === 2 ? 'Superflex' : '1QB'} · ${pprLabel(settings.ppr)}`;
  // A list is only worth showing when there is somewhere else to go.
  const switchable =
    onSwitch && leagues && leagues.some((choice) => choice.leagueId !== league.id) ? leagues : null;
  const showsAll = Boolean(overview && switchable);
  // In the overview no league is the open one, so each is a way back into it.
  const current = showsAll ? null : league.id;

  return (
    <>
      <h1 className="sr-only">{showsAll ? 'All your leagues' : league.name}</h1>
      <HeaderPopover
        label={
          showsAll
            ? `All your leagues, ${switchable?.length} of them. Switch league`
            : `${league.name}, ${format}. ${switchable ? 'Switch league, or see its rules' : 'League details'}`
        }
        summary={
          showsAll ? (
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="truncate font-semibold">All leagues</span>
              <span className="hidden truncate text-subtle md:inline">
                {switchable?.length} leagues
              </span>
            </span>
          ) : (
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="truncate font-semibold">{league.name}</span>
              <span className="hidden truncate text-subtle md:inline">{format}</span>
            </span>
          )
        }
      >
        {switchable && onSwitch && (
          <nav
            aria-label="Your leagues"
            className={showsAll ? '' : 'mb-4 border-b border-line pb-4'}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-subtle">Your leagues</p>
            <ul className="mt-2 space-y-1">
              {onOverview &&
                (showsAll ? (
                  <li aria-current="true" className={`${ROW} bg-raised`}>
                    <span className="min-w-0 truncate font-semibold">All leagues</span>
                    <span className="shrink-0 text-xs text-subtle">Open</span>
                  </li>
                ) : (
                  <li>
                    <button
                      type="button"
                      onClick={closing(onOverview)}
                      className={`${ROW} transition-colors hover:bg-raised`}
                    >
                      <span className="min-w-0 truncate font-medium">All leagues</span>
                      <span className="shrink-0 text-xs text-subtle">
                        This week and shared players
                      </span>
                    </button>
                  </li>
                ))}
              {switchable.map((choice) =>
                choice.leagueId === current ? (
                  <li key={choice.leagueId} aria-current="true" className={`${ROW} bg-raised`}>
                    <span className="min-w-0 truncate font-semibold">{choice.name}</span>
                    <span className="shrink-0 text-xs text-subtle">Open</span>
                  </li>
                ) : (
                  <li key={choice.leagueId}>
                    <button
                      type="button"
                      onClick={closing(() => onSwitch(choice.leagueId))}
                      className={`${ROW} transition-colors hover:bg-raised`}
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
        {managers && onPickManager && !showsAll && (
          <WhoAreYou managers={managers} onPick={onPickManager} />
        )}
        {showsAll ? (
          <button
            type="button"
            onClick={closing(onReset)}
            className="btn-secondary mt-4 w-full text-sm"
          >
            Find another league
          </button>
        ) : (
          <LeagueRules league={league} values={values} size={size} onReset={onReset} switchable={Boolean(switchable)} />
        )}
      </HeaderPopover>
    </>
  );
}

/**
 * Which of a co-owned team's managers is the visitor. The answer stays open
 * in the popover so his leagues can appear where the question was.
 */
function WhoAreYou({ managers, onPick }: { managers: Manager[]; onPick: (userId: string) => void }) {
  return (
    <section aria-labelledby="who-are-you" className="mb-4 border-b border-line pb-4">
      <p id="who-are-you" className="text-xs font-semibold uppercase tracking-wide text-subtle">
        Which manager are you?
      </p>
      <p className="mt-1 text-xs text-muted">
        Your team has {managers.length} managers. Pick yourself to switch between your leagues here.
      </p>
      <ul className="mt-2 space-y-1">
        {managers.map((manager, i) => (
          <li key={manager.id}>
            <button
              type="button"
              onClick={() => onPick(manager.id)}
              className={`${ROW} transition-colors hover:bg-raised`}
            >
              <span className="min-w-0 truncate font-medium">{manager.name}</span>
              <span className="shrink-0 text-xs text-subtle">{i === 0 ? 'Owner' : 'Co-owner'}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The open league's rules, and the way out to a league not in the list. */
function LeagueRules({
  league,
  values,
  size,
  onReset,
  switchable,
}: {
  league: League;
  values: string | null;
  size: string | null;
  onReset: () => void;
  switchable: boolean;
}) {
  const { settings } = league;
  return (
    <>
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
    </>
  );
}
