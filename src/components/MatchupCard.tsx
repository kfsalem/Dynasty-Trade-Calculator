import type { MatchupOdds } from '../engine/matchup';
import { matchupText } from '../lib/matchupText';

interface Props {
  odds: MatchupOdds;
  week: number;
  opponent: string;
  bestBall: boolean;
}

/**
 * Who you play this week and how likely you are to win (#162).
 *
 * Above the lineup panel because it is the question the lineup answers to: the
 * changes below are what move this number.
 */
export function MatchupCard({ odds, week, opponent, bestBall }: Props) {
  const text = matchupText(odds, opponent, { bestBall });

  return (
    <section className="card" aria-label={`Week ${week} matchup`}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
            Week {week} matchup
          </p>
          <h3 className="mt-1 font-display text-xl font-bold tracking-tight">{text.headline}</h3>
        </div>
        <p className="shrink-0 text-right">
          <span className="tabular font-display text-3xl font-bold">{text.figure}</span>
          {!odds.final && <span className="ml-1 text-sm text-muted">to win</span>}
        </p>
      </div>

      <p className="tabular mt-2 text-sm text-muted">{text.totals}</p>
      {text.note && <p className="mt-1 text-sm text-muted">{text.note}</p>}

      {!odds.final && (
        <details className="group mt-3 text-sm text-muted">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 font-medium text-accent fine:min-h-8 [&::-webkit-details-marker]:hidden">
            Why?
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
          <p className="mt-1 max-w-2xl">
            Both totals are each side's best legal lineup on this week's projections, scored
            under your league's rules, with byes, injuries and locked games applied. So yours
            assumes you make the changes below. Replayed over 280 real matchups, a projected
            margin missed the real one by about 36 points either way, so a 10-point favourite
            wins about three times in five.
            {odds.underway &&
              ' Points from finished games count as scored, and the odds tighten as the week is played.'}
          </p>
        </details>
      )}
    </section>
  );
}
