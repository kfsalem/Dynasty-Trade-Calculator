import type { ActivityAdjustment } from '../engine/activityFactor';
import { describeAdjustment } from '../lib/activityText';

/**
 * What the activity multiplier did to one player's value.
 *
 * Deliberately a percentage of value rather than another arrow: the snap column
 * next door already carries direction, and a second arrow beside it would look
 * like the same fact twice. The share-point move and the value move are
 * genuinely different numbers — fifteen points of snap share is not fifteen
 * percent of a dynasty price, and it is worth less on a 22-year-old than on a
 * 29-year-old — so the one the market cannot see is the one worth the space.
 *
 * Hidden below `sm` with the rest of the activity columns. It is context for a
 * decision the value column drives, and on a phone the name is already
 * truncating.
 */
export function ActivityMarker({ adjustment }: { adjustment?: ActivityAdjustment }) {
  if (!adjustment) return null;

  // Rounded first, then tested: a factor that lands under half a percent has
  // nothing to say, and a badge reading "+0%" is worse than no badge at all.
  const percent = Math.round((adjustment.factor - 1) * 100);
  if (percent === 0) return null;

  const rising = percent > 0;

  return (
    <span
      className={`hidden w-10 shrink-0 text-right text-[10px] font-semibold tabular-nums sm:inline-block ${
        rising ? 'text-positive' : 'text-fantasy-red'
      }`}
      title={describeAdjustment(adjustment)}
      aria-label={`Current role ${rising ? 'lifts' : 'cuts'} this value ${Math.abs(percent)} percent`}
    >
      {/* A true minus sign, not a hyphen: it sits on the digit baseline and
          lines up under the plus in the column above. */}
      {rising ? '+' : '−'}
      {Math.abs(percent)}%
    </span>
  );
}
