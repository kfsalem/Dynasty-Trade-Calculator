import { relativeMargin } from './startSit';

/**
 * Where a team stands on one axis, with the distance the rank throws away.
 *
 * **Percentile plus margin, and the margin is not optional.** "1st of 10" reads
 * identically whether the lead is 2% or 30%, and so does "6th of 10" whether
 * the team above is a point clear or a third better. `contentionProfile`
 * learned this once already when `nowShare` and `youthShare` were added to
 * carry what the quadrant label discards; this is the same lesson applied to
 * the ranks themselves.
 *
 * **No absolute scale, deliberately.** There is no cross-league anchor that
 * survives format differences, and inventing one would contradict the
 * replacement-level thesis this whole app rests on — a value only means
 * something against the league it is in. Percentile within the league, with the
 * spread shown, is the honest version of a grade.
 */
export interface Grade {
  /** The score being graded, in whatever units the axis uses. */
  score: number;
  /** 1 is the best in the league. Ties share the better rank. */
  rank: number;
  teamCount: number;
  /**
   * Fraction of the league strictly below this team, 0-1.
   *
   * The same convention as `contentionProfile`'s shares, including that a
   * single team is its own whole league and sits in the middle of it rather
   * than at an extreme.
   */
  percentile: number;
  /**
   * How far below the team directly above, as a share of that team's score.
   * Zero for the league leader, who has nobody above him.
   */
  behind: number;
  /**
   * How far clear of the team directly below. Zero for last place.
   *
   * With `behind`, this is what separates a runaway leader from a photo finish:
   * both are "1st of 12", and only one of them is safe.
   */
  ahead: number;
}

/**
 * Grade one score against the league's, on `relativeMargin`.
 *
 * The neighbours rather than the median, because the question a rank raises is
 * "how real is this position" and that is answered by whoever is actually next
 * to you. A team 1st by a hair and a team 1st by a third are the same rank and
 * different situations, and the median cannot tell them apart.
 *
 * `population` is expected to contain this team's own score. It is not required
 * to — nothing here depends on it — but every caller passes the whole league,
 * and a rank computed against a population that excluded you would be off by
 * one in a way no type would catch.
 */
export function gradeAgainst(score: number, population: number[]): Grade {
  const teamCount = population.length;

  const above = population.filter((v) => v > score);
  const below = population.filter((v) => v < score);

  // The nearest neighbour on each side, which is the whole point of the pair.
  const nearestAbove = above.length > 0 ? Math.min(...above) : null;
  const nearestBelow = below.length > 0 ? Math.max(...below) : null;

  return {
    score,
    rank: above.length + 1,
    teamCount,
    // A single team is its own whole league and sits in the middle of it,
    // matching `contentionProfile`'s share rather than claiming an extreme.
    percentile: teamCount <= 1 ? 0.5 : below.length / (teamCount - 1),
    behind: nearestAbove === null ? 0 : relativeMargin(nearestAbove, score),
    ahead: nearestBelow === null ? 0 : relativeMargin(score, nearestBelow),
  };
}
