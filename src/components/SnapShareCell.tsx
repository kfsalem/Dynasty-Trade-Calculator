// The window constants come from `activity`, which defines them, rather than
// re-exported through `snapShare` — snap share and target share are the same
// question asked of different columns, and both cells should point at the one
// answer rather than reaching it two ways.
import { MATERIAL_DELTA, RECENT_WEEKS } from '../engine/activity';
import type { SnapShare } from '../engine/snapShare';
import type { PlayerRole } from '../engine/role';
import { describeRole } from '../lib/roleText';
import { describeSnaps } from '../lib/activityText';

const pct = (share: number): string => `${Math.round(share * 100)}%`;


/**
 * Hidden below the `sm` breakpoint. Activity columns are the first thing to
 * give up on a phone: they sit next to two value columns and a name that is
 * already truncating, and a name squeezed to forty pixels helps nobody. The
 * numbers are context for a decision the value columns drive.
 */
export function SnapShareCell({
  share,
  role,
  chartSeason,
}: {
  share: SnapShare | undefined;
  role?: PlayerRole;
  chartSeason?: number | null;
}) {
  const roleText = role ? ` ${describeRole(role, chartSeason ?? null)}` : '';

  if (!share) {
    return (
      <span
        className="hidden w-14 shrink-0 text-right tabular-nums text-subtle sm:inline-block"
        title={`No snap data for this player.${roleText}`}
      >
        —
      </span>
    );
  }

  const points = share.delta === null ? 0 : Math.round(share.delta * 100);
  const material = share.delta !== null && Math.abs(share.delta) >= MATERIAL_DELTA;
  const rising = points > 0;

  return (
    <span
      className="hidden w-14 shrink-0 items-baseline justify-end gap-0.5 tabular-nums sm:flex"
      title={`${describeSnaps(share)}${roleText}`}
    >
      <span className="text-subtle">{pct(share.season)}</span>
      {material && (
        // Never colour alone: the arrow carries the direction for anyone who
        // cannot separate the emerald from the red.
        <span
          className={`text-[10px] font-semibold ${
            rising ? 'text-positive' : 'text-negative'
          }`}
          aria-label={`${rising ? 'up' : 'down'} ${Math.abs(points)} points over the last ${RECENT_WEEKS} weeks, against the weeks before them`}
        >
          {rising ? '▲' : '▼'}
        </span>
      )}
    </span>
  );
}
