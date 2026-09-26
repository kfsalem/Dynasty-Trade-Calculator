import type { ActivityAdjustment } from '../engine/activityFactor';
import type { SnapShare } from '../engine/snapShare';
import type { Metric } from '../engine/opportunity';
import { RECENT_WEEKS } from '../engine/activity';

const pct = (share: number): string => `${Math.round(share * 100)}%`;

/**
 * One metric's move, in the order a person would say it.
 *
 * Where it is now first, because that is the fact being asserted; where it came
 * from second, because that is what makes the first number mean something. A
 * bare "70% snaps" is a number, and "70% snaps, up from 35%" is a reason.
 */
function move({ label, from, to }: ActivityAdjustment['reasons'][number]): string {
  if (Math.round(from * 100) === Math.round(to * 100)) return `${pct(to)} ${label}, flat`;
  return `${pct(to)} ${label}, ${to > from ? 'up' : 'down'} from ${pct(from)}`;
}

/**
 * Why a value is not simply its market price times replacement.
 *
 * The multiplier is the one part of the model a manager cannot reconstruct from
 * the columns already on screen — snap share is shown in share points and this
 * is a percentage of value, so the two never match and one cannot be read off
 * the other. Stating the size of the adjustment and the evidence behind it in
 * the same breath is the difference between a model and a black box.
 */
export function describeAdjustment(adjustment: ActivityAdjustment): string {
  const percent = Math.round(Math.abs(adjustment.factor - 1) * 100);
  const direction = adjustment.factor > 1 ? 'lifts' : 'cuts';
  const evidence = adjustment.reasons.map(move).join('; ');

  return `Current role ${direction} this value ${percent}%: ${evidence}. Dynasty value already prices his expected role, so only the change in it counts here — and it counts for more the older he is.`;
}

/**
 * Snap share, spelled out: the season figure, the recent window, and the move
 * between the window and the weeks before it.
 *
 * Why the season share leads rather than the recent one: the recent window is
 * the more interesting figure, but it is empty for anyone who has not played in
 * a month — and a column that shows "—" for both an injured starter and a
 * player we have no data for is exactly the confusion this is meant to remove.
 * Shared by the snap column's tooltip and the player panel (#68), so the two
 * never describe one player differently.
 */
export function describeSnaps(share: SnapShare): string {
  const season = `Season ${pct(share.season)} over ${share.games} ${
    share.games === 1 ? 'game' : 'games'
  }`;

  if (share.recent === null) {
    return `${season}. No offensive snaps in the last ${RECENT_WEEKS} weeks.`;
  }

  const recent = `Last ${RECENT_WEEKS} weeks ${pct(share.recent)} over ${share.recentGames} ${
    share.recentGames === 1 ? 'game' : 'games'
  }`;

  // The move is against the weeks *before* the window, not against the season —
  // a season mean contains the window, so comparing to it understates every
  // move and names a baseline the player never had. Saying which number it is
  // measured from matters here, because the two differ and both are on screen.
  if (share.prior === null || share.delta === null) {
    return `${season}. ${recent}. No earlier weeks to compare against.`;
  }

  const points = Math.round(share.delta * 100);
  const change =
    points === 0
      ? 'unchanged'
      : `${points > 0 ? '+' : ''}${points} points against ${pct(share.prior)} over the ${
          share.priorGames
        } ${share.priorGames === 1 ? 'week' : 'weeks'} before`;

  return `${season}. ${recent} — ${change}.`;
}

const formatMetric = (value: number, kind: Metric['kind']): string =>
  kind === 'share' ? `${Math.round(value * 100)}%` : value.toFixed(2);

function metricMove(delta: number, kind: Metric['kind']): string {
  if (kind === 'index') return delta === 0 ? 'unchanged' : `${delta > 0 ? '+' : ''}${delta.toFixed(2)}`;

  const points = Math.round(delta * 100);
  if (points === 0) return 'unchanged';

  return `${points > 0 ? '+' : ''}${points} ${Math.abs(points) === 1 ? 'pt' : 'pts'}`;
}

/**
 * One opportunity metric, spelled out: what it has been, what it has been
 * lately, and how many games sit behind each. The season figure leads for the
 * same reason it does for snaps. Shared by the usage column and the panel.
 */
export function describeMetric(metric: Metric): string {
  const { window: w, label, kind } = metric;
  const season = `${label} ${formatMetric(w.season, kind)} over ${w.games} ${
    w.games === 1 ? 'game' : 'games'
  }`;

  if (w.recent === null) return `${season}; none in the last ${RECENT_WEEKS} weeks`;
  // No earlier weeks means no move to report — the recent figure is still worth
  // showing, but there is nothing to have moved *from*.
  if (w.delta === null || w.prior === null) {
    return `${season}; last ${RECENT_WEEKS} ${formatMetric(w.recent, kind)}`;
  }

  // The move is against `prior`, the weeks before the window, and the string
  // says so. `season` spans both windows, so quoting it as the baseline would
  // both understate the move and name a period the player never had.
  return `${season}; last ${RECENT_WEEKS} ${formatMetric(w.recent, kind)} (${metricMove(
    w.delta,
    kind,
  )} against ${formatMetric(w.prior, kind)} before)`;
}
