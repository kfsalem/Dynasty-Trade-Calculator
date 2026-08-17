import type { League, Position } from '../types';
import type { RosterSummary } from '../engine/rosterValue';
import type { SnapShare } from '../engine/snapShare';
import type { Opportunity } from '../engine/opportunity';
import type { PlayerRole } from '../engine/role';
import type { ActivityAdjustment } from '../engine/activityFactor';
import { TeamCard } from './TeamCard';
import { formatValue } from '../lib/format';
import { useMediaQuery } from '../hooks/useMediaQuery';

interface Props {
  league: League;
  summaries: RosterSummary[];
  myRosterId: number | null;
  snaps?: Map<string, SnapShare>;
  usage?: Map<string, Opportunity>;
  roles?: Map<string, PlayerRole>;
  snapsMeta?: { season: number; throughWeek: number | null; chartSeason: number | null };
  /** What a changing role did to each value, keyed by Sleeper id. */
  adjustments?: Map<string, ActivityAdjustment>;
  /** Positions the value source prices, so an unvalued player can say which. */
  priced?: Set<Position>;
}

export function RosterList({
  league,
  summaries,
  myRosterId,
  snaps,
  usage,
  roles,
  snapsMeta,
  adjustments,
  priced,
}: Props) {
  // `md`, matching the Tailwind breakpoint the summary is hidden at, so the
  // control and the thing it controls agree about where the layout changes.
  const wide = useMediaQuery('(min-width: 768px)');
  const topStarterValue = summaries[0]?.starterValue ?? 0;

  // Kickers and defenses have no dynasty market, so their absence is expected.
  // Only skill positions are worth reporting as unpriced.
  const unvalued = summaries.reduce(
    (count, s) =>
      count +
      s.players.filter(
        (p) => !p.valued && p.player.position !== 'K' && p.player.position !== 'DEF',
      ).length,
    0,
  );

  return (
    <div>
      {/*
        The explanation, folded away on a phone and open on a desktop.

        Five paragraphs is the right amount of writing — every one answers a
        question the standings genuinely raise — but at 375px they measured
        about a screen and a half between the tab bar and the first roster.
        Someone opening this tab wants the table; someone wondering why a
        32-year-old receiver outranks a rookie wants the prose, and will go
        looking for it.

        `<details>` because it is keyboard- and screen-reader-complete with no
        help, and because folding is exactly what this is. `open` is an
        attribute with no CSS equivalent, which is the one thing here that has
        to reach JavaScript — hence `useMediaQuery` rather than a `md:` variant.
        The summary is hidden above `md`, where the paragraphs are simply there
        as before.
      */}
      <details className="group" open={wide}>
        <summary className="-mx-2 cursor-pointer list-none rounded-lg px-2 py-3 text-sm font-medium text-muted hover:bg-surface md:hidden [&::-webkit-details-marker]:hidden">
          <span className="inline-flex items-center gap-2">
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180"
            >
              <path
                fillRule="evenodd"
                d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                clipRule="evenodd"
              />
            </svg>
            How these rankings are built
          </span>
        </summary>

      <p className="text-sm text-subtle">
        Ranked by the best lineup each roster can field — computed from the league's{' '}
        {league.settings.startingSlots.length} starting slots, not from whatever lineup was
        last set. Values come from FantasyCalc, matched to this league's format, then
        measured against what it costs to replace each position <em>in this league</em>.
      </p>
      <p className="mt-2 text-sm text-subtle">
        Two questions, two numbers. <strong>Win-now</strong> ranks the rosters and fills
        the lineups: what these players do for you this season. <strong>Dynasty</strong>{' '}
        prices the bench and every trade: what they are worth to hold. A 32-year-old
        receiver is better than his dynasty price says and a rookie who has not played a
        snap is worse, so a single number was answering both questions with the wrong one.
        Expand a team to see each list in its own units.
      </p>
      <p className="mt-2 text-sm text-subtle">
        Players ruled out for the season — injured reserve, PUP, suspended, or not on an
        active NFL roster — are left out of these lineups, because a slot they cannot fill
        is a hole rather than a starter. Their asset value is untouched. A knock that is
        week to week changes nothing at all: most questionable players play, and the tag
        moves twice a week.
      </p>

      {snapsMeta && (
        <p className="mt-2 text-sm text-subtle">
          Expand a team to see each player's offensive snap share
          {snapsMeta.throughWeek === null
            ? ` (${snapsMeta.season})`
            : `, ${snapsMeta.season} through Week ${snapsMeta.throughWeek}`}
          , alongside his share of the team's work in his own role — targets for a
          receiver, carries for a back. A ▲ or ▼ marks someone whose last four weeks
          differ from his season by more than ten points; a role change is the slowest
          thing the market reprices. That window stops at Week 17 — a locked playoff seed
          rests its starters in Week 18, so the week says more about seeding than about
          anyone's role. Where that change is big enough to matter, a signed
          percentage shows how much it moved the value itself — always a fraction of the
          move in snap share, because a dynasty price is mostly a bet on future role and
          already carries most of this. Hover any number for the full breakdown.
          {snapsMeta.chartSeason === snapsMeta.season
            ? ' A PLAYS UP or PLAYS DOWN badge marks someone the depth chart and the field disagree about — the chart is the slower of the two.'
            : ` Depth chart positions are ${snapsMeta.chartSeason ?? 'a later season'}, so they are not compared against ${snapsMeta.season} snaps.`}
        </p>
      )}

      {unvalued > 0 && (
        <p className="mt-2 text-sm text-subtle">
          {unvalued} rostered skill {unvalued === 1 ? 'player is' : 'players are'} unranked
          by FantasyCalc and shown as ~0. Measured against DynastyProcess, these are worth
          under 0.1% of a roster each.
        </p>
      )}
      </details>

      <div className="mt-6 space-y-3">
        {summaries.map((summary, i) => (
          <TeamCard
            key={summary.rosterId}
            summary={summary}
            league={league}
            rank={i + 1}
            topStarterValue={topStarterValue}
            isMine={summary.rosterId === myRosterId}
            snaps={snaps}
            usage={usage}
            roles={roles}
            chartSeason={snapsMeta?.chartSeason ?? null}
            adjustments={adjustments}
            priced={priced}
          />
        ))}
      </div>

      <p className="mt-8 text-center text-xs text-subtle">
        League total: {formatValue(summaries.reduce((sum, s) => sum + s.totalValue, 0))}{' '}
        across {summaries.length} rosters
      </p>
    </div>
  );
}
