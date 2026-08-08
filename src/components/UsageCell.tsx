import { MATERIAL_DELTA, RECENT_WEEKS } from '../engine/activity';
import type { Metric, Opportunity } from '../engine/opportunity';

const format = (value: number, kind: Metric['kind']): string =>
  kind === 'share' ? `${Math.round(value * 100)}%` : value.toFixed(2);

/**
 * One metric, spelled out: what it has been, what it has been lately, and how
 * many games sit behind each. The number in the column is the season figure,
 * for the same reason the snap column shows the season figure — a recent window
 * empties when a player stops playing, and a column that then reads the same as
 * "no data" is the confusion this is meant to remove.
 */
function line(metric: Metric): string {
  const { window: w, label, kind } = metric;
  const season = `${label} ${format(w.season, kind)} over ${w.games} ${
    w.games === 1 ? 'game' : 'games'
  }`;

  if (w.recent === null) return `${season}; none in the last ${RECENT_WEEKS} weeks`;
  // No earlier weeks means no move to report — the recent figure is still worth
  // showing, but there is nothing to have moved *from*.
  if (w.delta === null || w.prior === null) {
    return `${season}; last ${RECENT_WEEKS} ${format(w.recent, kind)}`;
  }

  // The move is against `prior`, the weeks before the window, and the string
  // says so. `season` spans both windows, so quoting it as the baseline would
  // both understate the move and name a period the player never had.
  return `${season}; last ${RECENT_WEEKS} ${format(w.recent, kind)} (${move(
    w.delta,
    kind,
  )} against ${format(w.prior, kind)} before)`;
}

function move(delta: number, kind: Metric['kind']): string {
  if (kind === 'index') return delta === 0 ? 'unchanged' : `${delta > 0 ? '+' : ''}${delta.toFixed(2)}`;

  const points = Math.round(delta * 100);
  if (points === 0) return 'unchanged';

  return `${points > 0 ? '+' : ''}${points} ${Math.abs(points) === 1 ? 'pt' : 'pts'}`;
}

export function UsageCell({ usage }: { usage: Opportunity | undefined }) {
  if (!usage) {
    return (
      <span
        className="hidden w-14 shrink-0 text-right tabular-nums text-subtle sm:inline-block"
        title="No usage data for this player"
      >
        —
      </span>
    );
  }

  const { headline } = usage;
  const delta = headline.window.delta;
  const material = delta !== null && Math.abs(delta) >= MATERIAL_DELTA;
  const rising = (delta ?? 0) > 0;

  return (
    <span
      className="hidden w-14 shrink-0 items-baseline justify-end gap-0.5 tabular-nums sm:flex"
      // Every metric that applies at this position, so a receiving back's
      // target share is one hover away from his carry share.
      title={usage.metrics.map(line).join('. ') + '.'}
    >
      <span className="text-subtle">{format(headline.window.season, headline.kind)}</span>
      {material && (
        // Never colour alone: the arrow carries the direction for anyone who
        // cannot separate the emerald from the red.
        <span
          className={`text-[10px] font-semibold ${
            rising ? 'text-positive' : 'text-fantasy-red'
          }`}
          aria-label={`${headline.label} ${rising ? 'up' : 'down'} in the last ${RECENT_WEEKS} weeks`}
        >
          {rising ? '▲' : '▼'}
        </span>
      )}
    </span>
  );
}
