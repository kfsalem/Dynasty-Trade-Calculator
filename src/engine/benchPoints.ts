import type {
  HistoryPlayer,
  LeagueHistory,
  SeasonHistory,
  WeekLineup,
} from '../platforms/types';
import type { LineupSlot, Position } from '../types';
import { byRestrictiveness, slotEligibility } from './rosterValue';

/**
 * Points left on the bench: the lineup a manager set, against the one he could
 * have set, scored on what actually happened.
 *
 * The most personal number in fantasy football, and — unusually for this app —
 * one with no model in it anywhere. Every input is published: the lineup, the
 * roster, and what the league itself paid each player that week. There is no
 * projection, no fitting and no threshold; the arithmetic is a comparison
 * between two lineups over the same completed week.
 *
 * It also has an oracle. Sleeper computes the same quantity for its own site
 * and publishes the season total as `ppts`, so this engine can be checked
 * against the league it is running in rather than argued for — the second time
 * that has been possible here, after `engine/scoringCheck`. Measured over 60
 * roster-seasons of two real leagues: 77% reproduce Sleeper's own figure to
 * within half a point, and the aggregate error is 0.12%. See `docs/ROADMAP.md`.
 */

/** Within half a point of the platform's own season total. */
const EXACT = 0.5;

/** Beyond this the app is not describing the same season the platform is. */
const MAX_ERROR = 0.02;

export interface BenchWeek {
  season: string;
  week: number;
  /** What the lineup he set was paid. */
  scored: number;
  /** What the best legal lineup from the same roster would have been paid. */
  potential: number;
  /** `potential` less `scored`, never negative. */
  gap: number;
  /**
   * The highest-scoring man who sat, among those who would have played.
   *
   * The evidence for the week, and the reason to name him rather than only
   * quote a total: a manager can check this against his own memory in a way he
   * cannot check a number. Null when nothing on the bench would have changed
   * the lineup.
   */
  costliest: { playerId: string; name: string; points: number } | null;
}

export interface BenchSeason {
  season: string;
  weeks: number;
  scored: number;
  potential: number;
  /** Total points left on the bench across the season. */
  gap: number;
  /** That total per week played, which is the figure to compare between seasons. */
  perWeek: number;
}

export interface BenchManager {
  /**
   * The identity that survives across seasons. Null for an orphan team, whose
   * seasons are therefore never joined to anybody's.
   */
  userId: string | null;
  name: string;
  /** Roster-weeks behind the figure. The evidence, and it is always shown. */
  weeks: number;
  /** Mean points left on the bench per week played. */
  perWeek: number;
  /** Newest season first. */
  seasons: BenchSeason[];
  /** His worst single week, which is usually the one he remembers. */
  worst: BenchWeek | null;
}

export type BenchVerdict = 'exact' | 'close' | 'unreliable' | 'unchecked';

/**
 * How closely this engine reproduces the platform's own potential points.
 *
 * Same shape and same purpose as `ScoringFidelity`, one layer up: that one
 * checks the arithmetic that scores a player, this one checks the arithmetic
 * that builds a lineup out of the scores.
 */
export interface BenchFidelity {
  /** Roster-seasons compared against the platform's own total. */
  compared: number;
  exact: number;
  /**
   * Signed share of potential points this engine is off by.
   *
   * Positive is over, and over is the expected direction: the platform knows
   * which players were on injured reserve in a given week and does not publish
   * it, so a man parked in week 9 is in this engine's pool and not in
   * Sleeper's. Negative means something is missing from this side — a week that
   * failed to load is the likely cause — which is why the sign is kept rather
   * than an absolute value reported.
   */
  error: number;
  verdict: BenchVerdict;
}

export interface BenchReport {
  /** Every manager the history covers, fewest points left on the bench first. */
  managers: BenchManager[];
  /**
   * The league's own average, pooled over roster-weeks rather than averaged
   * over managers.
   *
   * Pooled for the reason `scoringPremium` is: a manager with one season and
   * one with four are different amounts of evidence, and a mean of means gives
   * them the same vote.
   */
  leaguePerWeek: number;
  /** Roster-weeks in the whole report. */
  weeks: number;
  /** Seasons that contributed at least one played week, newest first. */
  seasons: string[];
  fidelity: BenchFidelity;
}

const UNCHECKED: BenchFidelity = { compared: 0, exact: 0, error: 0, verdict: 'unchecked' };

const EMPTY: BenchReport = {
  managers: [],
  leaguePerWeek: 0,
  weeks: 0,
  seasons: [],
  fidelity: UNCHECKED,
};

interface Candidate {
  id: string;
  position: Position;
  points: number;
}

/**
 * The best legal lineup from a pool, scored on points already awarded.
 *
 * The same greedy fill `bestLineup` runs — most restrictive slot first, best
 * available man into it — with points where that one has value. Kept separate
 * rather than folded into it behind an option, because the two answer different
 * questions in different currencies: `bestLineup` picks who *should* start from
 * what a player is worth, this picks who *would* have started from what he
 * actually scored. The slot rules are the part worth sharing, and
 * `slotEligibility` and `byRestrictiveness` are exported for exactly this.
 *
 * Greedy is optimal here because the slots nest: QB inside SUPER_FLEX, REC_FLEX
 * inside FLEX inside SUPER_FLEX. Filling the narrowest first can never strand a
 * man a wider slot needed.
 */
export function bestByPoints(
  pool: Candidate[],
  startingSlots: LineupSlot[],
): { total: number; chosen: Set<string> } {
  const ranked = [...pool].sort(
    (a, b) => b.points - a.points || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  const chosen = new Set<string>();
  let total = 0;

  for (const { slot } of byRestrictiveness(startingSlots)) {
    const eligible = slotEligibility(slot);
    const pick = ranked.find(
      (entry) => !chosen.has(entry.id) && eligible.includes(entry.position),
    );
    if (!pick) continue;
    chosen.add(pick.id);
    total += pick.points;
  }

  return { total, chosen };
}

/**
 * One roster's week, compared against itself.
 *
 * Returns null for a week there is no honest comparison to make: a lineup that
 * could not be aligned to the season's slots is one this app cannot read, and
 * reporting it as "nothing left on the bench" would credit a manager for a week
 * nobody can see.
 */
function compareWeek(
  entry: WeekLineup,
  season: SeasonHistory,
  players: Map<string, HistoryPlayer>,
): BenchWeek | null {
  if (entry.starterIds.length === 0) return null;

  const started = new Set(entry.starterIds.filter((id): id is string => id !== null));
  const scored = [...started].reduce((sum, id) => sum + (entry.points.get(id) ?? 0), 0);

  const pool: Candidate[] = [];
  for (const id of entry.playerIds) {
    const player = players.get(id);
    // A player the index cannot place cannot fill a slot. He is left out, which
    // can only make the gap smaller than the truth — see `historyPlayers`.
    if (!player) continue;
    pool.push({ id, position: player.position, points: entry.points.get(id) ?? 0 });
  }

  const best = bestByPoints(pool, season.startingSlots);

  let costliest: BenchWeek['costliest'] = null;
  for (const id of best.chosen) {
    if (started.has(id)) continue;
    const points = entry.points.get(id) ?? 0;
    if (points <= 0) continue;
    if (costliest && points <= costliest.points) continue;
    costliest = { playerId: id, name: players.get(id)?.name ?? 'A benched player', points };
  }

  return {
    season: season.season,
    week: entry.week,
    scored,
    // Clamped, and it can bind: a starter whose position the index does not
    // know is counted in `scored` and absent from the pool, which is the one
    // way a best lineup can come out below the lineup actually set.
    potential: Math.max(best.total, scored),
    gap: Math.max(best.total - scored, 0),
    costliest,
  };
}

interface Accumulator {
  userId: string | null;
  name: string;
  seasons: Map<string, BenchSeason>;
  worst: BenchWeek | null;
  weeks: number;
  gap: number;
}

/**
 * A key that joins a manager's seasons together, and never joins two managers.
 *
 * `user_id` where there is one. An orphan team has none, and its seasons are
 * deliberately kept apart: two unowned teams in different years are not the
 * same manager, and the roster id they share means only that they sat in the
 * same row of the table.
 */
const managerKey = (userId: string | null, season: string, rosterId: number): string =>
  userId ?? `orphan:${season}:${rosterId}`;

/**
 * Points left on the bench, per manager, across every season in the history.
 *
 * Weeks are the unit throughout. A manager who has played one season and one
 * who has played four are compared per week rather than per season, and the
 * week count travels with every figure so the comparison can be read with its
 * own evidence in view.
 */
export function benchPoints(history: LeagueHistory | undefined): BenchReport {
  if (!history || history.seasons.length === 0) return EMPTY;

  const accumulators = new Map<string, Accumulator>();
  const seasons: string[] = [];
  let totalGap = 0;
  let totalWeeks = 0;

  for (const season of history.seasons) {
    let played = false;

    for (const entry of season.weeks) {
      const manager = season.managers.get(entry.rosterId);
      const week = compareWeek(entry, season, history.players);
      if (!week) continue;

      played = true;
      const key = managerKey(manager?.userId ?? null, season.season, entry.rosterId);
      const acc = accumulators.get(key) ?? {
        userId: manager?.userId ?? null,
        // The name from the newest season he appears in, since the history is
        // walked newest first and display names change.
        name: manager?.name ?? 'Orphan team',
        seasons: new Map<string, BenchSeason>(),
        worst: null,
        weeks: 0,
        gap: 0,
      };

      const current = acc.seasons.get(season.season) ?? {
        season: season.season,
        weeks: 0,
        scored: 0,
        potential: 0,
        gap: 0,
        perWeek: 0,
      };

      current.weeks += 1;
      current.scored += week.scored;
      current.potential += week.potential;
      current.gap += week.gap;
      current.perWeek = current.gap / current.weeks;
      acc.seasons.set(season.season, current);

      acc.weeks += 1;
      acc.gap += week.gap;
      if (!acc.worst || week.gap > acc.worst.gap) acc.worst = week;

      accumulators.set(key, acc);
      totalGap += week.gap;
      totalWeeks += 1;
    }

    if (played) seasons.push(season.season);
  }

  const managers: BenchManager[] = [...accumulators.values()]
    .map((acc) => ({
      userId: acc.userId,
      name: acc.name,
      weeks: acc.weeks,
      perWeek: acc.weeks > 0 ? acc.gap / acc.weeks : 0,
      seasons: [...acc.seasons.values()].sort(
        (a, b) => Number(b.season) - Number(a.season),
      ),
      worst: acc.worst,
    }))
    // Fewest points left on the bench first, so a rank reads the way a league
    // table does. Ties broken by weeks played, then by name, so the order is a
    // function of the history and never of iteration order.
    .sort(
      (a, b) =>
        a.perWeek - b.perWeek ||
        b.weeks - a.weeks ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    );

  return {
    managers,
    leaguePerWeek: totalWeeks > 0 ? totalGap / totalWeeks : 0,
    weeks: totalWeeks,
    seasons,
    fidelity: checkBench(history),
  };
}

/**
 * Ask the platform whether this engine builds the same lineups it does.
 *
 * Sleeper publishes `ppts` — its own season total for the best lineup each
 * roster could have fielded — so the whole of this engine can be checked
 * against the league it is running in, per roster, per season. Nothing else in
 * the app gets to do that except `engine/scoringCheck`, and for the same
 * reason: the platform published its own answer.
 *
 * The expected residual is small and positive. Sleeper knows which players were
 * on injured reserve in a given week and no endpoint publishes it — verified,
 * including against the transaction feed, which carries no status changes at
 * all — so this engine's pool is the roster as the platform reported it that
 * week, IR and taxi included. That is the same pool Sleeper prices, minus its
 * knowledge of who was parked, and over two real leagues the difference is
 * 0.12% of potential points and never negative.
 */
export function checkBench(history: LeagueHistory): BenchFidelity {
  let compared = 0;
  let exact = 0;
  let mine = 0;
  let theirs = 0;

  for (const season of history.seasons) {
    const computed = new Map<number, number>();
    for (const entry of season.weeks) {
      const week = compareWeek(entry, season, history.players);
      if (!week) continue;
      computed.set(entry.rosterId, (computed.get(entry.rosterId) ?? 0) + week.potential);
    }

    for (const [rosterId, total] of computed) {
      const claimed = season.claimed.get(rosterId);
      // No claim is not a claim of zero: a season the platform has not totalled
      // is one there is nothing to check against.
      if (!claimed || claimed.potential <= 0) continue;

      compared += 1;
      if (Math.abs(total - claimed.potential) < EXACT) exact += 1;
      mine += total;
      theirs += claimed.potential;
    }
  }

  if (compared === 0) return UNCHECKED;

  const error = theirs === 0 ? 0 : (mine - theirs) / theirs;

  return {
    compared,
    exact,
    error,
    verdict:
      exact === compared ? 'exact' : Math.abs(error) <= MAX_ERROR ? 'close' : 'unreliable',
  };
}

/**
 * Whether the figures are worth showing at all.
 *
 * The degrade path `scoringIsUsable` established: a league whose own published
 * totals this engine cannot come near is one where the honest answer is
 * silence, not a number with a caveat under it. `unchecked` stays usable — a
 * platform that publishes no total of its own is not evidence of a problem.
 */
export const benchIsUsable = (fidelity: BenchFidelity): boolean =>
  fidelity.verdict !== 'unreliable';

/** One manager's figures, by the id the app knows him as. Null when he has none. */
export const benchFor = (report: BenchReport, userId: string | null): BenchManager | null =>
  userId === null ? null : (report.managers.find((m) => m.userId === userId) ?? null);

/** Where a manager sits in the league, 1-based. Null when he is not in it. */
export function benchRank(report: BenchReport, userId: string | null): number | null {
  if (userId === null) return null;
  const index = report.managers.findIndex((m) => m.userId === userId);
  return index < 0 ? null : index + 1;
}
