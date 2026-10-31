/**
 * The sample league's two surfaces (#159): the way in, on the import screen,
 * and the way out, on every tab while the sample is open.
 */

export function TrySample({ onTry, busy }: { onTry: () => void; busy?: boolean }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      <span className="text-muted">No Sleeper league to hand?</span>
      <button
        type="button"
        onClick={onTry}
        disabled={busy}
        className="btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
      >
        Try it with a sample league
      </button>
    </div>
  );
}

export function SampleBanner({ onLeave }: { onLeave: () => void }) {
  return (
    <section
      aria-label="Sample league"
      className="mb-6 flex flex-col gap-3 rounded-card border border-line bg-raised px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="min-w-0 text-sm text-muted">
        <span className="font-semibold text-ink">You're looking at a sample league.</span>{' '}
        The players, rosters, scores and trades are a real Sleeper league's; the managers'
        names are made up.
      </p>
      <button type="button" onClick={onLeave} className="btn-primary shrink-0 text-sm">
        Import your league
      </button>
    </section>
  );
}
