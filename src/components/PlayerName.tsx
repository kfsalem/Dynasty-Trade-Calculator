import type { ReactNode } from 'react';
import type { Player } from '../types';
import { useOpenPlayer } from '../hooks/useOpenPlayer';

/**
 * A player's name that opens his panel (#68).
 *
 * A real button, so it is reachable by Tab and announced as something that
 * opens a dialog. It keeps the row's own truncation classes, and the full name
 * stays in `title` for a pointer — but the panel is now where a truncated name
 * is read in full, rather than a hover.
 */
export function PlayerName({
  player,
  className = '',
  children,
}: {
  player: Player;
  className?: string;
  children?: ReactNode;
}) {
  const open = useOpenPlayer();
  if (!open) {
    return (
      <span className={className} title={player.name}>
        {children ?? player.name}
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={() => open(player.id)}
      title={player.name}
      className={`text-left decoration-line underline-offset-4 hover:underline ${className}`}
    >
      {children ?? player.name}
    </button>
  );
}
