import type { ReactNode } from 'react';
import type { DraftPick, Player } from '../types';
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

/**
 * A draft pick's label that opens its panel (#68, #49), where the price is
 * explained: where it lands, how sure that is, and how picks are valued.
 */
export function PickName({ pick, className = '' }: { pick: DraftPick; className?: string }) {
  const open = useOpenPlayer();
  if (!open) return <span className={className}>{pick.label}</span>;

  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={() => open(pick.id)}
      title={pick.label}
      className={`text-left decoration-line underline-offset-4 hover:underline ${className}`}
    >
      {pick.label}
    </button>
  );
}
