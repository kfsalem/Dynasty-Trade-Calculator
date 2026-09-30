import type { ContestPrice } from '../engine/bids';

const CONTEST_PHRASE: Record<ContestPrice['rivals'], string> = {
  0: 'with nobody else bidding',
  1: 'against one rival',
  2: 'against two or more',
};

/**
 * What competition has cost here, as a spread rather than a prediction.
 *
 * The app cannot tell whether a claim will be contested — nothing it can see
 * beforehand predicts that (see `engine/bids`) — so it states the prices and
 * leaves that judgement to the manager, who knows his league. Shared by the
 * lineup panel's wire rows and the Free agents tab's bid guide (#152).
 */
export function contestSentence(spread: ContestPrice[]): string {
  const parts = spread.map((row) => `$${row.dollars} ${CONTEST_PHRASE[row.rivals]}`);
  const list =
    parts.length > 2 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts.join(' and ');
  return `Across all positions, a claim here has gone for about ${list}.`;
}
