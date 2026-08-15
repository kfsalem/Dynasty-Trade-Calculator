/**
 * The league view, drawn before it exists.
 *
 * This replaced a centred spinner, and the reason is not polish. The load is
 * three requests deep — the league, then a 5 MB player blob, then the value
 * table keyed on settings that only arrive with the league — so it holds the
 * screen for seconds on a normal connection. A spinner spends those seconds
 * saying "something is happening" over an otherwise empty page; the same
 * seconds spent drawing the shape of what is coming tell the user the page has
 * a header, four tabs and a stack of cards, and that none of it has failed.
 *
 * It mirrors the real layout closely enough that nothing jumps when the data
 * lands. Where it is deliberately vague is row *counts*: the skeleton cannot
 * know how many teams a league has, and guessing twelve and rendering ten is a
 * worse lie than not implying a number at all.
 */

/** One block. Radius and size come from the caller; the sweep is in `.skeleton`. */
function Block({ className }: { className: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function LeagueSkeleton() {
  return (
    /*
     * One live region for the whole view, not one per block — a screen reader
     * should hear "loading league" once, not eleven times as each placeholder
     * mounts. `aria-label` carries it because everything inside is decorative
     * and has no text of its own to read.
     */
    <div role="status" aria-label="Loading league" className="rise-in">
      {/* Header: league name, format badges, the change-league button. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Block className="h-8 w-64 max-w-full sm:h-9" />
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Block className="h-6 w-20 rounded-full" />
            <Block className="h-6 w-16 rounded-full" />
            <Block className="h-6 w-20 rounded-full" />
            <Block className="h-6 w-14 rounded-full" />
            <Block className="h-6 w-14 rounded-full" />
          </div>
        </div>
        <Block className="h-10 w-32 shrink-0 rounded-lg" />
      </div>

      {/* Tablist. */}
      <div className="mt-6 flex gap-1 border-b border-line pb-2">
        <Block className="h-6 w-20" />
        <Block className="h-6 w-24" />
        <Block className="h-6 w-20" />
        <Block className="h-6 w-28" />
      </div>

      {/* The contention panel, which is the tallest thing on the default tab. */}
      <div className="mt-6 rounded-xl border border-line p-5">
        <Block className="h-3 w-32" />
        <Block className="mt-2 h-7 w-48" />
        <Block className="mt-3 h-4 w-full max-w-lg" />
        <div className="mt-4 flex gap-6 border-t border-line pt-3">
          <Block className="h-4 w-24" />
          <Block className="h-4 w-28" />
        </div>
      </div>

      {/* Two cards below it. */}
      {[0, 1].map((i) => (
        <div key={i} className="card mt-4">
          <Block className="h-5 w-40" />
          <Block className="mt-3 h-3 w-full max-w-md" />
          <div className="mt-4 space-y-2">
            <Block className="h-4 w-full" />
            <Block className="h-4 w-11/12" />
            <Block className="h-4 w-4/5" />
          </div>
        </div>
      ))}

      {/*
       * Say what is actually slow. The wait used to be unexplained, which is
       * how a slow load turns into a suspected broken one — and the second
       * sentence is the honest reason the wait is worth it, since pricing
       * against this league's own lineup settings is the whole point of the app.
       */}
      <p className="mt-6 text-center text-sm text-subtle">
        Reading rosters from Sleeper, then pricing every player against this league's
        lineup settings.
      </p>
    </div>
  );
}
