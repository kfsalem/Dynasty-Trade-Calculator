// The window constants come from `activity`, which defines them, rather than
// re-exported through `snapShare` — snap share and target share are the same
// question asked of different columns, and both cells should point at the one
// answer rather than reaching it two ways.
import { MATERIAL_DELTA, RECENT_WEEKS } from '../engine/activity';
import type { SnapShare } from '../engine/snapShare';
import type { PlayerRole } from '../engine/role';
import { describeRole } from '../lib/roleText';

const pct = (share: number): string => `${Math.round(share * 100)}%`;

/**
 * Why the number shown is the season share rather than the recent one.
 *
 * The recent window is the more interesting figure, but it is empty for anyone
 * who has not played in a month — and a column that shows "—" for both an
 * injured starter and a player we have no data for is exactly the confusion
 * this feature is supposed to remove. So the column means one thing, always:
 * snap share across the season. The movement rides alongside it as a delta,
 * which is the part worth acting on.
 */
function describe(share: SnapShare): string {
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
  const move =
    points === 0
      ? 'unchanged'
      : `${points > 0 ? '+' : ''}${points} points against ${pct(share.prior)} over the ${
          share.priorGames
        } ${share.priorGames === 1 ? 'week' : 'weeks'} before`;

  return `${season}. ${recent} — ${move}.`;
}

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
      title={`${describe(share)}${roleText}`}
    >
      <span className="text-subtle">{pct(share.season)}</span>
      {material && (
        // Never colour alone: the arrow carries the direction for anyone who
        // cannot separate the emerald from the red.
        <span
          className={`text-[10px] font-semibold ${
            rising ? 'text-positive' : 'text-fantasy-red'
          }`}
          aria-label={`${rising ? 'up' : 'down'} ${Math.abs(points)} points over the last ${RECENT_WEEKS} weeks, against the weeks before them`}
        >
          {rising ? '▲' : '▼'}
        </span>
      )}
    </span>
  );
}
