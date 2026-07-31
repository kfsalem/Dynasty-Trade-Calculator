import type { ActivityAdjustment } from '../engine/activityFactor';

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
