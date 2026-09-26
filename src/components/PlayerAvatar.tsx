import { useState } from 'react';
import type { Player } from '../types';
import { POSITION_STYLES } from '../lib/format';

/**
 * Whether to load player headshots at all (#120).
 *
 * The photos come from Sleeper's CDN, which serves them but does not document
 * them: its API docs cover only league and user avatars. Loading them was the
 * owner's decision on 2026-09-26. If Sleeper ever blocks other sites or asks
 * for them to stop, this is the one switch — every avatar falls back to
 * initials and nothing else changes.
 */
const SHOW_HEADSHOTS = true;

const SIZE = {
  sm: 'h-8 w-8 text-[11px]',
  md: 'h-10 w-10 text-xs',
  lg: 'h-14 w-14 text-base',
} as const;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

/**
 * A player's face, ringed in his position colour, or his initials when there
 * is no face to show.
 *
 * Decorative: his name always sits beside it, so the image carries `alt=""`
 * and the ring is never the only thing saying his position — the row keeps
 * its lettered position chip, as the design system requires of every coloured
 * mark.
 *
 * Falls back to initials for anyone without a numeric Sleeper id (a team
 * defence is keyed by its abbreviation), and for any image that fails to load,
 * so a blocked CDN costs photos, never layout.
 */
export function PlayerAvatar({
  player,
  size = 'md',
}: {
  player: Player;
  size?: keyof typeof SIZE;
}) {
  const [failed, setFailed] = useState(false);
  const id = player.platformIds.sleeper ?? player.id;
  const style = POSITION_STYLES[player.position];
  const photo = SHOW_HEADSHOTS && !failed && /^\d+$/.test(id);

  return (
    <span
      aria-hidden="true"
      className={`relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full border-2 bg-raised font-semibold ${SIZE[size]} ${style.border} ${photo ? '' : style.chip}`}
    >
      {photo ? (
        <img
          src={`https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg`}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        initials(player.name)
      )}
    </span>
  );
}
