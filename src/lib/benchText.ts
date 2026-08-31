import type { BenchFidelity, BenchManager, BenchWeek } from '../engine/benchPoints';

/**
 * The bench figures, in words a manager would use about his own team.
 *
 * Separated from the engine for the reason the rest of this folder is:
 * `benchPoints` decides what is true and this decides how to say it. The
 * decision that matters here is tone. "You leave 24 points a week on your
 * bench" is an accusation if it is said alone and a fact if it is said next to
 * what everybody else leaves — and the second is the true version, because
 * every manager in every league leaves points on the bench and the only
 * interesting question is whether he leaves more than his league does.
 */

/** One decimal. These are points, and the second one is noise. */
const points = (n: number): string => n.toFixed(1);

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'];

/** Small counts as words, larger ones as figures. */
const count = (n: number): string => NUMBER_WORDS[n] ?? String(n);

/** 1st, 2nd, 3rd — the ordinal a league table would use. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** "42 weeks across three seasons" — the evidence, never left off a figure. */
export function describeSpan(weeks: number, seasons: number): string {
  const weekPart = `${weeks} ${weeks === 1 ? 'week' : 'weeks'}`;
  if (seasons <= 1) return weekPart;
  return `${weekPart} across ${count(seasons)} seasons`;
}

/**
 * How a manager compares to his league, with the number that makes it fair.
 *
 * The comparison is always to the league's own average rather than to a
 * fantasy-wide one, because lineup mistakes scale with how much a league
 * scores: 20 points a week is careless in a league averaging 90 and ordinary in
 * one averaging 140. The league is the only honest yardstick, and it is the one
 * the app already has.
 */
export function compareToLeague(perWeek: number, leaguePerWeek: number): string {
  const difference = perWeek - leaguePerWeek;
  const league = `The league average is ${points(leaguePerWeek)}`;

  // Under a point apart is not a difference anybody could act on, and dressing
  // it as one would be the same overclaim the quadrant's median split was.
  if (Math.abs(difference) < 1) return `${league}, so you are level with your league.`;

  return difference > 0
    ? `${league}, so you leave ${points(difference)} more than most of your league.`
    : `${league}, so you leave ${points(-difference)} less than most of your league.`;
}

/**
 * Where he sits, counted rather than ranked.
 *
 * "7th of 11" was the first draft and it is ambiguous in the direction that
 * matters: seventh-fewest or seventh-most? The list is sorted fewest-first,
 * which the reader has no way to know, and a manager reading his own record
 * should not have to work out which way the number points. Counting the
 * managers who do better says it once and cannot be read backwards.
 */
export function describeRank(rank: number, total: number): string {
  if (total <= 1) return '';
  if (rank === 1) return 'Nobody in your league leaves less.';
  if (rank === total) return 'Every other manager leaves less.';

  const better = rank - 1;
  return `${better} of the other ${total - 1} managers leave less.`;
}

/**
 * The worst single week, named — including the man who sat through it.
 *
 * The number on its own is an assertion; the name is what makes it checkable
 * against a manager's own memory of the season, which is the difference
 * between a statistic and a story about his team.
 */
export function describeWorstWeek(worst: BenchWeek): string {
  const where = `Week ${worst.week} of ${worst.season}: ${points(worst.gap)} points left behind`;
  if (!worst.costliest) return `${where}.`;
  return `${where}, with ${worst.costliest.name} scoring ${points(
    worst.costliest.points,
  )} on your bench.`;
}

/**
 * What the platform's own figures say about this arithmetic.
 *
 * Shown because it can be. Sleeper computes the same quantity for its own site
 * and publishes the season total, so this panel is one of two places in the app
 * that can point at an outside answer instead of asking to be trusted — see
 * `ScoringNote` for the other.
 *
 * Silent when there is nothing to report: a platform that publishes no total of
 * its own leaves nothing to agree or disagree with, and "checked 0 of 0" is
 * worse than not raising the subject.
 */
export function fidelitySentence(fidelity: BenchFidelity): string | null {
  if (fidelity.verdict === 'unchecked' || fidelity.compared === 0) return null;

  const scope = `${fidelity.compared} team ${
    fidelity.compared === 1 ? 'season' : 'seasons'
  }`;

  if (fidelity.verdict === 'exact') {
    return `Checked against Sleeper's own potential-points totals for ${scope}, and they agree exactly.`;
  }

  const off = Math.abs(fidelity.error * 100);
  const size = off < 0.05 ? 'under 0.1%' : `${off.toFixed(1)}%`;
  return `Checked against Sleeper's own potential-points totals for ${scope}: ${size} apart.`;
}

/**
 * The headline, which is a sentence rather than a number with a caption.
 *
 * A manager with a single week behind him gets the week, not an average of one
 * — "you leave 31.2 points a week" from one Sunday is a figure with no meaning,
 * and stating it as a rate is the overclaim.
 */
export function headline(manager: BenchManager): string {
  if (manager.weeks <= 1) {
    return `You left ${points(manager.perWeek)} points on your bench`;
  }
  return `You leave ${points(manager.perWeek)} points a week on your bench`;
}
