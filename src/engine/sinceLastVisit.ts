import type { Role } from './role';

/**
 * What changed on your team since this browser last opened this league (#167).
 *
 * The app has no backend, so "since last visit" is a small snapshot kept on
 * the device: each rostered player's market value and role, and the team's two
 * ranks. On the next visit the two snapshots are compared and at most three
 * changes are reported — and only ones that cross a threshold, because a "what
 * changed" panel that lists noise every week teaches people to skip it.
 *
 * **The value threshold is measured, not chosen.** Over the weekly spans of
 * the value history (#158, 2026-09-29 to 10-27), a move of at least 15% *and*
 * at least 400 market points reaches about one player per 25-man roster per
 * week (1.0–1.2 across four spans). A share alone fires on noise among cheap
 * players — a 500-point player moves 30% on nothing — and a looser rule
 * reaches two or three a week, which crowds out everything else.
 *
 * **Roles count when they cross the line that matters**: into or out of the
 * starting role. Snap shares wobble around every other boundary week to week.
 *
 * **Ranks count when they move two places or more.** One place is often a
 * photo finish changing hands, which `Grade.behind` and `ahead` exist to say.
 */

export const VALUE_MOVE_SHARE = 0.15;
export const VALUE_MOVE_POINTS = 400;
export const RANK_MOVE = 2;
export const MAX_CHANGES = 3;

export interface VisitSnapshot {
  /** Bumped if the shape changes, so an old snapshot is ignored, not misread. */
  version: 1;
  /** ISO time of the visit. */
  at: string;
  rosterId: number;
  /** Each rostered player: his market value, and his role when known. */
  players: Record<string, { market: number | null; role: Role | null }>;
  nowRank: number;
  laterRank: number;
  teamCount: number;
}

export type ChangeKind = 'role' | 'grade' | 'value';

export interface VisitChange {
  kind: ChangeKind;
  /** Stable, for React and for tests. */
  key: string;
  /** The player it is about, when it is about one. */
  playerId: string | null;
  text: string;
  /** Good news or bad, for the sign the line carries. */
  direction: 'up' | 'down';
}

const ordinal = (n: number): string => {
  const tail = n % 100;
  if (tail >= 11 && tail <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
};

const round = (n: number) => Math.round(n).toLocaleString('en-US');

/**
 * The changes worth leading with, at most `MAX_CHANGES`, or none.
 *
 * Empty for a first visit (no previous snapshot), for a different team than
 * last time (a claim changed, so nothing compares), and when nothing crossed a
 * threshold. Players who joined or left the roster are not changes: the
 * manager made those himself.
 *
 * Order: role changes, then rank moves, then value moves largest first. A role
 * change is the rarest and most actionable; value moves are the most common.
 */
export function changesSince(
  previous: VisitSnapshot | null,
  current: VisitSnapshot,
  nameOf: (playerId: string) => string,
): VisitChange[] {
  if (!previous || previous.version !== 1 || previous.rosterId !== current.rosterId) return [];

  const roles: VisitChange[] = [];
  const values: (VisitChange & { size: number })[] = [];

  for (const [id, now] of Object.entries(current.players)) {
    const before = previous.players[id];
    if (!before) continue;
    const name = nameOf(id);

    if (before.role && now.role && before.role !== now.role) {
      if (now.role === 'starter') {
        roles.push({
          kind: 'role',
          key: `role:${id}`,
          playerId: id,
          text: `${name} is playing a starter's snaps now, up from ${before.role}.`,
          direction: 'up',
        });
      } else if (before.role === 'starter') {
        roles.push({
          kind: 'role',
          key: `role:${id}`,
          playerId: id,
          text: `${name} has lost his starting role: ${now.role} by snaps now.`,
          direction: 'down',
        });
      }
    }

    if (before.market && now.market !== null) {
      const delta = now.market - before.market;
      const share = Math.abs(delta) / before.market;
      if (share >= VALUE_MOVE_SHARE && Math.abs(delta) >= VALUE_MOVE_POINTS) {
        values.push({
          kind: 'value',
          key: `value:${id}`,
          playerId: id,
          text: `${name}'s value ${delta > 0 ? 'rose' : 'fell'} ${Math.round(share * 100)}%, ${round(before.market)} to ${round(now.market)}.`,
          direction: delta > 0 ? 'up' : 'down',
          size: share,
        });
      }
    }
  }

  const grades: VisitChange[] = [];
  const rank = (label: string, key: string, was: number, is: number) => {
    if (Math.abs(was - is) < RANK_MOVE) return;
    grades.push({
      kind: 'grade',
      key,
      playerId: null,
      text: `Your ${label} rank went from ${ordinal(was)} to ${ordinal(is)} of ${current.teamCount}.`,
      direction: is < was ? 'up' : 'down',
    });
  };
  // Ranks compare only within the same league size; a team joining or leaving
  // moves every rank without anything having happened to yours.
  if (previous.teamCount === current.teamCount) {
    rank('win-now', 'grade:now', previous.nowRank, current.nowRank);
    rank('dynasty', 'grade:later', previous.laterRank, current.laterRank);
  }

  // Largest first, by the share that crossed the line; the size itself is not
  // part of what is reported.
  const bySize = values
    .sort((a, b) => b.size - a.size)
    .map((v): VisitChange => ({
      kind: v.kind,
      key: v.key,
      playerId: v.playerId,
      text: v.text,
      direction: v.direction,
    }));
  return [...roles, ...grades, ...bySize].slice(0, MAX_CHANGES);
}

/** Where the snapshot lives: one per league, on this device. */
export const visitKey = (leagueId: string) => `dynasty:lastVisit:${leagueId}`;

export function readVisit(leagueId: string): VisitSnapshot | null {
  try {
    const raw = localStorage.getItem(visitKey(leagueId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VisitSnapshot;
    return parsed?.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

export function writeVisit(leagueId: string, snapshot: VisitSnapshot): void {
  try {
    localStorage.setItem(visitKey(leagueId), JSON.stringify(snapshot));
  } catch {
    // Storage disabled or full: the next visit simply has nothing to compare.
  }
}
