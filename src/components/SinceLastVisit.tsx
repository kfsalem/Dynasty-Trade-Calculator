import type { VisitChange } from '../engine/sinceLastVisit';

const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

/**
 * What moved on your team since you last opened this league (#167), leading My
 * team. Rendered only when something crossed a threshold: an empty "what
 * changed" is a box people learn to skip, so there is never one.
 *
 * Gains and losses carry an arrow as well as a colour, as every signed figure
 * in the app does, so the line reads the same without the colour.
 */
export function SinceLastVisit({
  changes,
  since,
  onDismiss,
}: {
  changes: VisitChange[];
  since: string | null;
  onDismiss: () => void;
}) {
  if (changes.length === 0) return null;
  const when = since ? DATE.format(new Date(since)) : null;

  return (
    <section aria-label="Since your last visit" className="card rise-in mb-6">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-display text-lg font-bold tracking-tight">
          Since your last visit{when ? `, ${when}` : ''}
        </h2>
        <button
          type="button"
          onClick={onDismiss}
          className="-my-1 inline-flex min-h-11 shrink-0 items-center rounded-lg px-2 text-sm font-medium text-accent hover:bg-raised fine:min-h-8"
        >
          Dismiss
        </button>
      </div>
      <ul className="mt-2 space-y-1.5">
        {changes.map((change) => (
          <li key={change.key} className="flex gap-2 text-sm text-muted">
            <span
              aria-hidden="true"
              className={change.direction === 'up' ? 'text-positive' : 'text-negative'}
            >
              {change.direction === 'up' ? '▲' : '▼'}
            </span>
            <span>{change.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
