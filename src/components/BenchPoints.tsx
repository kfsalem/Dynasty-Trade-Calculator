import { benchFor, benchRank, type BenchReport } from '../engine/benchPoints';
import {
  compareToLeague,
  describeRank,
  describeSpan,
  describeWorstWeek,
  fidelitySentence,
  headline,
} from '../lib/benchText';

interface Props {
  /** Undefined until the history loads, or when the check ruled it unusable. */
  report: BenchReport | undefined;
  loading: boolean;
  failed: boolean;
  /** True when the walk could not reach the whole of the league's history. */
  truncated: boolean;
  /** The manager these figures are about — the claimed team's owner. */
  userId: string | null;
  /** Best ball leagues have no lineup to set and nothing to leave behind. */
  bestBall: boolean;
}

const points = (n: number): string => n.toFixed(1);

/**
 * Every week of this league, and what each manager left on his bench.
 *
 * The counterpart to the lineup panel above it, and its opposite in every
 * respect that matters. That one is about the lineup in front of you and can
 * only ever be a projection; this one is about lineups already played and
 * contains no projection at all — the league itself published what every player
 * scored, so the comparison between the lineup a manager set and the best one
 * he could have set is arithmetic over facts.
 *
 * Below the contention window rather than above it, unlike the lineup panel.
 * Nothing here has a deadline: it is the season already behind you, and a
 * manager should meet it after the things he can still act on.
 */
export function BenchPoints({
  report,
  loading,
  failed,
  truncated,
  userId,
  bestBall,
}: Props) {
  /*
    Nothing to say, and the lineup panel has already said it. Best ball scores
    each roster's optimal lineup after the games, so "points left on the bench"
    is not merely zero here — it is a quantity the format does not have. Two
    panels explaining the same absence would be one too many.
  */
  if (bestBall) return null;

  if (loading) {
    return (
      <section className="card mt-4" aria-busy="true">
        <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
          Points left on the bench
        </p>
        {/*
          The shape of what is coming, not a spinner: a headline, a sentence,
          and a row per season. The walk is a request per week per season, so
          this is on screen for a moment even on a warm cache.
        */}
        <div className="skeleton mt-2 h-6 w-3/4" />
        <div className="skeleton mt-2 h-4 w-1/2" />
        <div className="skeleton mt-4 h-24 w-full" />
      </section>
    );
  }

  /*
    A failure here costs this panel and nothing else, so it says so quietly and
    in one line. The history is seventy-odd requests against a third-party API;
    somebody, sometimes, will lose one.
  */
  if (failed) {
    return (
      <section className="card mt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
          Points left on the bench
        </p>
        <p className="mt-2 text-sm text-muted">
          This league's past seasons didn't load. Everything else on this page is
          unaffected — the history is only read for this panel.
        </p>
      </section>
    );
  }

  if (!report) return null;

  /*
    A league in its first week. Not an error and not an empty state to apologise
    for: there is genuinely nothing behind it yet, and the sentence says when
    there will be.
  */
  if (report.weeks === 0) {
    return (
      <section className="card mt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
          Points left on the bench
        </p>
        <p className="mt-2 text-sm text-muted">
          Nothing to read yet — this league hasn't finished a week. From the first
          Sunday on, this compares the lineup you set against the best one your roster
          could have fielded, every week, scored on what actually happened.
        </p>
      </section>
    );
  }

  const me = benchFor(report, userId);

  /*
    The league has a history and this manager is not in it: a team claimed in
    its first season, or one with no owner at all. Naming which is worth the
    extra sentence, because "no history" and "history this app cannot attach to
    you" are different facts and only one of them will ever change.
  */
  if (!me) {
    return (
      <section className="card mt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
          Points left on the bench
        </p>
        <p className="mt-2 text-sm text-muted">
          {userId === null
            ? 'This team has no manager on Sleeper, so its seasons cannot be followed from one year to the next.'
            : `Your first week in this league hasn't been played yet. The rest of the league leaves ${points(
                report.leaguePerWeek,
              )} points a week on the bench.`}
        </p>
      </section>
    );
  }

  const rank = benchRank(report, userId);
  const evidence = fidelitySentence(report.fidelity);

  return (
    <section className="card mt-4" aria-labelledby="bench-points-heading">
      <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
        Points left on the bench
      </p>
      <h3 id="bench-points-heading" className="mt-1 text-lg font-bold tracking-tight">
        {headline(me)}
      </h3>
      <p className="mt-2 text-sm text-muted">
        {compareToLeague(me.perWeek, report.leaguePerWeek)}
        {rank !== null && report.managers.length > 1
          ? ` ${describeRank(rank, report.managers.length)}`
          : ''}
      </p>

      {/*
        A row per season, because the whole point of a multi-season figure is
        whether it is moving. Type and scale carry it rather than a chart: three
        or four rows of tabular figures are the comparison, and a bar chart of
        four numbers would add an axis to a list.
      */}
      <dl className="mt-4 divide-y divide-line border-y border-line">
        {me.seasons.map((season) => (
          <div
            key={season.season}
            className="flex items-baseline justify-between gap-4 py-3 fine:py-1.5"
          >
            <dt className="min-w-0 text-sm">
              <span className="font-semibold">{season.season}</span>{' '}
              <span className="text-subtle">
                {season.weeks} {season.weeks === 1 ? 'week' : 'weeks'}
              </span>
            </dt>
            <dd className="tabular shrink-0 text-sm">
              <span className="font-semibold">{points(season.perWeek)}</span>
              <span className="text-subtle"> / wk</span>
            </dd>
          </div>
        ))}
      </dl>

      {me.worst && (
        <p className="mt-4 rounded-lg border border-line bg-raised p-3 text-sm text-muted">
          <span className="font-semibold text-ink">Your worst week.</span>{' '}
          {describeWorstWeek(me.worst)}
        </p>
      )}

      {/*
        The evidence, always. A figure this personal has to show how much of a
        season it rests on, and — uniquely in this app, alongside the scoring
        note — what an outside answer says about it.
      */}
      <p className="mt-3 text-xs text-subtle">
        From {describeSpan(me.weeks, me.seasons.length)}
        {truncated ? ', as far back as Sleeper still publishes' : ''}.{' '}
        {evidence ?? ''}
      </p>
    </section>
  );
}
