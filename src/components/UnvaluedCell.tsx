import type { Position } from '../types';

/**
 * What to show where a value would go, when there isn't one.
 *
 * Two different facts arrive here as the same missing map entry, and collapsing
 * them is what made the roster list look broken:
 *
 * - **The source ranks nobody at this position.** Kickers and defences, which
 *   FantasyCalc does not publish and dynasty does not trade. A starting kicker
 *   is genuinely useful every Sunday and genuinely worth nothing in a trade,
 *   and those are not the same sentence. `~0` says the first thing is false.
 * - **The source ranks this position but not this player.** A fringe receiver
 *   past the end of a 475-player universe. Here `~0` is exactly right — he is
 *   worth about nothing, and `docs/DESIGN.md` records the measurement behind
 *   that: the players DynastyProcess recovers that FantasyCalc misses are worth
 *   4-9 out of 10,000.
 *
 * So the first reads "no market" and the second keeps `~0`. Both are muted, and
 * both carry the full explanation in a title rather than in the column, which
 * has room for neither.
 */
export function UnvaluedCell({
  position,
  priced,
  className = 'w-24 shrink-0 text-right tabular-nums text-subtle',
}: {
  position: Position;
  /** Positions the value source prices at all — see `replacement.pricedPositions`. */
  priced: Set<Position> | undefined;
  className?: string;
}) {
  // Undefined means the pool has not loaded, not that nothing is priced. Falling
  // back to `~0` keeps the pre-load state identical to what it was before.
  const noMarket = priced !== undefined && !priced.has(position);

  return (
    <span
      className={className}
      title={
        noMarket
          ? `No dynasty market for ${position}. Values come from FantasyCalc, which prices the positions dynasty leagues actually trade — kickers and defences are streamed off waivers rather than held, so nobody publishes a price for them. He still fills your ${position} slot.`
          : 'No published value — outside the top ~475 players. Worth close to nothing in a trade, but not exactly nothing.'
      }
    >
      {noMarket ? 'no market' : '~0'}
    </span>
  );
}
