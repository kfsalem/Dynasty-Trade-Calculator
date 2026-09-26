import { MATERIAL_DELTA, RECENT_WEEKS } from '../engine/activity';
import type { Metric, Opportunity } from '../engine/opportunity';
import { describeMetric } from '../lib/activityText';

const format = (value: number, kind: Metric['kind']): string =>
  kind === 'share' ? `${Math.round(value * 100)}%` : value.toFixed(2);


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
      title={usage.metrics.map(describeMetric).join('. ') + '.'}
    >
      <span className="text-subtle">{format(headline.window.season, headline.kind)}</span>
      {material && (
        // Never colour alone: the arrow carries the direction for anyone who
        // cannot separate the emerald from the red.
        <span
          className={`text-[10px] font-semibold ${
            rising ? 'text-positive' : 'text-negative'
          }`}
          aria-label={`${headline.label} ${rising ? 'up' : 'down'} in the last ${RECENT_WEEKS} weeks`}
        >
          {rising ? '▲' : '▼'}
        </span>
      )}
    </span>
  );
}
