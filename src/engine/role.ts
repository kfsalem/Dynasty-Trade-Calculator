import type { DepthPlayer } from '../data/types';
import type { SnapShare } from './snapShare';

/**
 * What a player actually is right now, derived from how much he plays.
 *
 * Deliberately from snap share rather than from the published depth chart.
 * Charts are written by media relations departments and lag reality by weeks;
 * a "backup" taking 70% of the snaps is the more interesting player, and the
 * gap between the two is a buy-low signal rather than an error to reconcile.
 */
export type Role = 'starter' | 'rotational' | 'backup' | 'inactive';

/**
 * Boundaries measured against the 2025 season rather than chosen.
 *
 * Published rank 1 ran a median 77% snap share and rank 2 a median 50%, so 65%
 * separates a man who plays most downs from one who rotates. Rank 3 sat at a
 * median 30% and rank 5 at 12%, which puts the rotational floor near a quarter
 * of the snaps.
 */
export const STARTER_SHARE = 0.65;
export const ROTATIONAL_SHARE = 0.25;

/** Snap share below which a published starter is not really starting. */
export const BENCHED_SHARE = 0.35;

/**
 * How many at each position are on the field in a base offence.
 *
 * Comparing against rank 1 alone reads every WR2 as a backup, and in a league
 * whose base personnel nflverse itself labels "3WR 1TE" that is simply wrong —
 * it produced 41 false disagreements against 2025, most of them receivers
 * playing 71-85% of snaps exactly as their team intended.
 *
 * Fullbacks are zero rather than one. A team that lists an FB1 still puts him
 * on the field for about a fifth of its snaps, so counting him as a published
 * starter flagged half the league's fullbacks as underperforming every week.
 */
const STARTERS_ON_FIELD: Record<string, number> = { QB: 1, RB: 1, WR: 3, TE: 1, FB: 0 };

export type Disagreement =
  /** Plays like a starter; the chart does not list him as one. */
  | 'plays-more'
  /** Listed as a starter; barely on the field. */
  | 'plays-less';

export interface PlayerRole {
  role: Role;
  /** Season snap share the role came from, or null when he has no snaps. */
  share: number | null;
  /** Where the published chart puts him, when he appears on one. */
  chart: { pos: string; rank: number; team: string; starter: boolean } | null;
  /**
   * Only set when the chart and the snaps describe the same season. Across
   * seasons the two answer different questions and every offseason move would
   * read as a lie.
   */
  disagreement: Disagreement | null;
}

export function classify(share: number | null): Role {
  if (share === null || share === 0) return 'inactive';
  if (share >= STARTER_SHARE) return 'starter';
  if (share >= ROTATIONAL_SHARE) return 'rotational';
  return 'backup';
}

export const isChartStarter = (listing: DepthPlayer): boolean =>
  listing.rank <= (STARTERS_ON_FIELD[listing.pos] ?? 1);

/**
 * Combine what a player does with what his team says about him.
 *
 * `comparable` is the caller's statement that both sides describe the same
 * season. It is false through the whole offseason — the depth chart advances
 * to the new season months before a single snap is played — and forcing a
 * comparison then would flag every free agent and every rookie as a
 * disagreement, which is noise dressed as signal.
 */
export function playerRole(
  share: SnapShare | undefined,
  listing: DepthPlayer | undefined,
  comparable: boolean,
): PlayerRole | null {
  if (!share && !listing) return null;

  const value = share ? share.season : null;
  const role = classify(value);
  const chart = listing
    ? { pos: listing.pos, rank: listing.rank, team: listing.team, starter: isChartStarter(listing) }
    : null;

  return { role, share: value, chart, disagreement: disagree(role, value, chart, comparable) };
}

function disagree(
  role: Role,
  share: number | null,
  chart: PlayerRole['chart'],
  comparable: boolean,
): Disagreement | null {
  if (!comparable || !chart || share === null) return null;

  if (!chart.starter && role === 'starter') return 'plays-more';
  if (chart.starter && share < BENCHED_SHARE) return 'plays-less';

  return null;
}

export interface RoleInputs {
  shares: Map<string, SnapShare>;
  depth: Map<string, DepthPlayer>;
  /** True only when the snap file and the chart cover the same season. */
  comparable: boolean;
}

export function playerRoles({ shares, depth, comparable }: RoleInputs): Map<string, PlayerRole> {
  const roles = new Map<string, PlayerRole>();

  for (const id of new Set([...shares.keys(), ...depth.keys()])) {
    const role = playerRole(shares.get(id), depth.get(id), comparable);
    if (role) roles.set(id, role);
  }

  return roles;
}
