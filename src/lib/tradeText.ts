import type { SuggestedTrade } from '../engine/suggest';
import { FAIRNESS_LABEL } from '../engine/trade';
import { joinWords } from './scoringText';

/**
 * A suggested trade as one sentence: both sides, the partner and the verdict.
 *
 * This is the card's screen-reader summary, the one line on it that only
 * assistive technology reads. It used to count one side's assets without
 * plurals ("1 players and 1 picks sent"), which told a listener nothing about
 * what arrives or who from (#100). A summary is the version someone can act on.
 */
export function describeTrade(
  trade: Pick<SuggestedTrade, 'give' | 'get' | 'partnerName' | 'analysis'> &
    Partial<Pick<SuggestedTrade, 'drops' | 'partnerRosterId'>>,
): string {
  const labels = (side: SuggestedTrade['give']) => joinWords(side.map((a) => a.label));
  const apart = Math.round(trade.analysis.valueDifferencePct * 100);
  // A release a full roster makes to take the trade is part of it (#138).
  const drops = (trade.drops ?? []).map((drop) =>
    drop.rosterId === trade.partnerRosterId
      ? ` ${trade.partnerName} releases ${drop.player.name} to make room.`
      : ` You release ${drop.player.name} to make room.`,
  );
  return `Send ${labels(trade.give)} to ${trade.partnerName} for ${labels(trade.get)}.${drops.join('')} ${
    FAIRNESS_LABEL[trade.analysis.fairnessRating]
  }, ${apart}% apart.`;
}
