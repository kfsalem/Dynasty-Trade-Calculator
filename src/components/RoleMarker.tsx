import type { PlayerRole } from '../engine/role';
import { describeRole } from '../lib/roleText';

/**
 * A published chart and the field disagreeing about a player.
 *
 * Deliberately visible rather than buried in a tooltip: the gap is the whole
 * point. A team listing someone third while he takes most of the snaps is the
 * market being slow, and that is a buy-low window rather than a data error to
 * reconcile away.
 *
 * Nothing renders when the two agree, or when they cannot be compared because
 * the chart has already advanced to next season and the snaps are last
 * season's — which is true right through the offseason.
 */
export function RoleMarker({
  role,
  chartSeason,
}: {
  role: PlayerRole | undefined;
  chartSeason: number | null;
}) {
  if (!role?.disagreement) return null;

  const up = role.disagreement === 'plays-more';

  return (
    <span
      className={`ml-1.5 shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold ${
        up ? 'bg-positive-soft text-positive' : 'bg-caution-soft text-caution'
      }`}
      title={describeRole(role, chartSeason)}
    >
      {up ? 'PLAYS UP' : 'PLAYS DOWN'}
    </span>
  );
}
