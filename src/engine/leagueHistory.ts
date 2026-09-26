import type {
  BracketMatch,
  LeagueHistory,
  SeasonHistory,
  TeamResult,
} from '../platforms/types';
import { roundWeeks } from './playoffRounds';

/**
 * A league's history as a table, records and rivalries (#52).
 *
 * This is the fun surface, and it is honest about that: entertainment built
 * on real arithmetic, never fed back into valuation. A manager's 2023 record
 * says nothing about what a player is worth.
 *
 * Three rules hold it together:
 *
 * 1. **A manager is a user, not a roster.** Roster ids shuffle between seasons
 *    and user ids do not, so everything is keyed on `userId`. An orphan team —
 *    a roster with no owner — is keyed per season and roster, and is shown as a
 *    team with no manager rather than given a name.
 * 2. **Only games people were trying to win.** Records, the all-time table,
 *    streaks, all-play and head-to-head read the regular season. Placement
 *    games and the consolation bracket are played by teams already out of
 *    contention; they measure attendance, not football.
 * 3. **Final standings rank survival.** See `finalStandings`.
 */

export type StandingsMode = 'points' | 'bracket';

/** Stable across seasons for a real manager; per season and roster for an orphan. */
export type ManagerKey = string;

export interface ManagerIdentity {
  key: ManagerKey;
  /** The name he played under most recently. */
  name: string;
  /** False for an orphan team: a roster the league gave no owner. */
  owned: boolean;
}

/** One regular-season game, resolved to both sides. */
interface Game {
  season: string;
  week: number;
  a: { key: ManagerKey; points: number };
  b: { key: ManagerKey; points: number };
}

export interface SeasonStanding {
  rosterId: number;
  key: ManagerKey;
  teamName: string;
  /** 1 is the champion. */
  finish: number;
  madePlayoffs: boolean;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
}

export interface SeasonSummary {
  season: string;
  /** False while the season is being played: no standings yet, records still count. */
  complete: boolean;
  /** Final standings, or empty when the season has no finished bracket. */
  standings: SeasonStanding[];
}

export interface TableRow {
  key: ManagerKey;
  seasons: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  titles: number;
  playoffs: number;
  lastPlaces: number;
  /** Record had he played every team every week. */
  allPlayWins: number;
  allPlayLosses: number;
  longestWinStreak: number;
  longestLossStreak: number;
  /** Standard deviation of weekly points: boom-or-bust against the metronome. */
  weeklySpread: number;
}

export interface WeekRecord {
  season: string;
  week: number;
  key: ManagerKey;
  points: number;
  /** The other side, where the record is about a game. */
  opponent?: { key: ManagerKey; points: number };
}

export interface SeasonRecord {
  season: string;
  key: ManagerKey;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
}

export interface Records {
  highestWeek: WeekRecord | null;
  lowestWeek: WeekRecord | null;
  biggestBlowout: WeekRecord | null;
  narrowestWin: WeekRecord | null;
  /** You scored that much and still lost. */
  highestScoringLoss: WeekRecord | null;
  /** Got away with it. */
  lowestScoringWin: WeekRecord | null;
  bestSeason: SeasonRecord | null;
  worstSeason: SeasonRecord | null;
}

export interface HeadToHead {
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
}

export interface LeagueHistoryStats {
  managers: Map<ManagerKey, ManagerIdentity>;
  seasons: SeasonSummary[];
  table: TableRow[];
  records: Records;
  /** `headToHead.get(a)?.get(b)` is a's record against b. */
  headToHead: Map<ManagerKey, Map<ManagerKey, HeadToHead>>;
  /** Regular-season games read, across every season. */
  games: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function keyOf(season: SeasonHistory, rosterId: number): ManagerKey {
  const owner = season.managers.get(rosterId)?.userId;
  return owner ?? `orphan:${season.season}:${rosterId}`;
}

/**
 * Regular-season fixtures: the two teams sharing a matchup id in a week before
 * the playoffs. A team with no fixture that week, or a fixture that did not
 * pair up, is not a game.
 */
function fixtures(season: SeasonHistory): [TeamResult, TeamResult][] {
  const byFixture = new Map<string, TeamResult[]>();
  for (const result of season.results) {
    if (result.week >= season.playoffs.weekStart || result.matchupId === null) continue;
    const id = `${result.week}:${result.matchupId}`;
    byFixture.set(id, [...(byFixture.get(id) ?? []), result]);
  }
  return [...byFixture.values()].flatMap((pair) =>
    pair.length === 2 ? [[pair[0], pair[1]] as [TeamResult, TeamResult]] : [],
  );
}

/** Regular-season games, resolved to managers. */
function gamesOf(season: SeasonHistory): Game[] {
  const games: Game[] = [];
  for (const [a, b] of fixtures(season)) {
    games.push({
      season: season.season,
      week: a.week,
      a: { key: keyOf(season, a.rosterId), points: a.points },
      b: { key: keyOf(season, b.rosterId), points: b.points },
    });
  }
  return games.sort((x, y) => x.week - y.week);
}

interface Line {
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
}

const emptyLine = (): Line => ({ wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 });

function record(line: Line, mine: number, theirs: number) {
  line.pointsFor += mine;
  line.pointsAgainst += theirs;
  if (mine > theirs) line.wins++;
  else if (mine < theirs) line.losses++;
  else line.ties++;
}

const winPct = (line: Pick<Line, 'wins' | 'losses' | 'ties'>) => {
  const played = line.wins + line.losses + line.ties;
  return played === 0 ? 0 : (line.wins + line.ties / 2) / played;
};

/** Better regular season first: win percentage, then points for. */
const byRecord = <T extends Pick<Line, 'wins' | 'losses' | 'ties' | 'pointsFor'>>(a: T, b: T) =>
  winPct(b) - winPct(a) || b.pointsFor - a.pointsFor;

/** The championship path: every bracket game except placement games below the final. */
const onPath = (match: BracketMatch) => match.placement === null || match.placement === 1;

/**
 * Where every team finished, 1 through N (#52).
 *
 * **Points-based, the default.** Playoff teams rank by how long they survived:
 * a team's elimination round is the round of its first loss on the
 * championship path. Two teams out in the same round are split by what they
 * scored in that losing game. Placement games are ignored — nobody sets a
 * lineup after being knocked out of title contention, so a third-place game
 * measures attendance, not football. Teams that missed the playoffs rank below
 * every playoff team, by regular-season record with points as the tiebreak;
 * the consolation bracket is ignored for the same reason.
 *
 * **Official bracket.** Where a placement game was played, it decides the two
 * places it was for. Everything else falls back to the points rule. The bottom
 * of the table stays by regular-season record: how Sleeper's losers bracket
 * encodes last place has not been verified, and guessing would be worse than
 * saying so.
 *
 * Empty for a season with no decided final.
 */
export function finalStandings(season: SeasonHistory, mode: StandingsMode): SeasonStanding[] {
  const { winners, weekStart, roundType } = season.playoffs;
  const final = winners.find((match) => match.placement === 1);
  if (!final || final.winner === null || final.loser === null) return [];

  const rounds = Math.max(...winners.map((match) => match.round));
  const lines = new Map<number, Line>();
  for (const game of gamesByRoster(season)) {
    const line = lines.get(game.rosterId) ?? emptyLine();
    record(line, game.points, game.against);
    lines.set(game.rosterId, line);
  }

  const scoreIn = (rosterId: number, round: number) =>
    roundWeeks(weekStart, roundType, round, rounds).reduce(
      (sum, week) =>
        sum +
        (season.results.find((r) => r.week === week && r.rosterId === rosterId)?.points ?? 0),
      0,
    );

  const inPlayoffs = new Set<number>();
  for (const match of winners) {
    for (const team of match.teams) if (team !== null) inPlayoffs.add(team);
  }

  // Survival, by the championship path.
  const outIn = new Map<number, number>();
  for (const match of winners.filter(onPath).sort((a, b) => a.round - b.round)) {
    if (match.loser !== null && !outIn.has(match.loser)) outIn.set(match.loser, match.round);
  }
  const survival = (rosterId: number) =>
    rosterId === final.winner ? rounds + 1 : (outIn.get(rosterId) ?? 0);

  let playoffOrder = [...inPlayoffs].sort((a, b) => {
    const lasted = survival(b) - survival(a);
    if (lasted !== 0) return lasted;
    const round = survival(a);
    return scoreIn(b, round) - scoreIn(a, round);
  });

  if (mode === 'bracket') {
    // Each placement game puts its winner and loser in the two places it was for.
    const placed = new Map<number, number>();
    for (const match of winners) {
      if (match.placement === null || match.winner === null || match.loser === null) continue;
      placed.set(match.winner, match.placement);
      placed.set(match.loser, match.placement + 1);
    }
    const slots: (number | null)[] = playoffOrder.map(() => null);
    for (const [rosterId, place] of placed) {
      if (place - 1 < slots.length) slots[place - 1] = rosterId;
    }
    const rest = playoffOrder.filter((rosterId) => !placed.has(rosterId));
    playoffOrder = slots.map((slot) => slot ?? (rest.shift() as number));
  }

  const others = season.results
    .map((r) => r.rosterId)
    .filter((rosterId, i, all) => all.indexOf(rosterId) === i && !inPlayoffs.has(rosterId))
    .sort((a, b) => byRecord(lines.get(a) ?? emptyLine(), lines.get(b) ?? emptyLine()));

  return [...playoffOrder, ...others].map((rosterId, i) => {
    const line = lines.get(rosterId) ?? emptyLine();
    return {
      rosterId,
      key: keyOf(season, rosterId),
      teamName: season.managers.get(rosterId)?.teamName ?? `Team ${rosterId}`,
      finish: i + 1,
      madePlayoffs: inPlayoffs.has(rosterId),
      ...line,
      pointsFor: round2(line.pointsFor),
      pointsAgainst: round2(line.pointsAgainst),
    };
  });
}

/** Each roster's regular-season games, from its own side. */
function gamesByRoster(season: SeasonHistory) {
  return fixtures(season).flatMap(([a, b]) => [
    { rosterId: a.rosterId, points: a.points, against: b.points },
    { rosterId: b.rosterId, points: b.points, against: a.points },
  ]);
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length);
}

/**
 * Everything the League tab shows, from the walked history (#52).
 *
 * Seasons oldest first. A season still being played counts towards records,
 * the table and rivalries for the weeks it has, and has no standings.
 */
export function leagueHistoryStats(
  history: LeagueHistory,
  mode: StandingsMode = 'points',
  /**
   * The season being played and its last finished week. A week in progress
   * has partial scores — a team on -2 because its kicker has played and nobody
   * else has — and those must not become records. Absent when no season is
   * being played.
   */
  current?: { season: string; lastCompleteWeek: number },
): LeagueHistoryStats {
  const seasons = [...history.seasons]
    .sort((a, b) => Number(a.season) - Number(b.season))
    .map((season) =>
      season.season === current?.season
        ? { ...season, results: season.results.filter((r) => r.week <= current.lastCompleteWeek) }
        : season,
    );

  // Identity: the most recent name each manager played under.
  const managers = new Map<ManagerKey, ManagerIdentity>();
  for (const season of seasons) {
    for (const [rosterId, manager] of season.managers) {
      const key = keyOf(season, rosterId);
      managers.set(key, {
        key,
        name: manager.userId ? manager.name : manager.teamName,
        owned: manager.userId !== null,
      });
    }
  }

  const summaries: SeasonSummary[] = seasons.map((season) => {
    const standings = finalStandings(season, mode);
    return { season: season.season, complete: standings.length > 0, standings };
  });

  const games = seasons.flatMap(gamesOf);

  // The table.
  const rows = new Map<ManagerKey, TableRow & { weekly: number[] }>();
  // Current run per manager: positive for wins, negative for losses.
  const runs = new Map<ManagerKey, number>();
  const row = (key: ManagerKey) => {
    let r = rows.get(key);
    if (!r) {
      r = {
        key,
        seasons: 0,
        ...emptyLine(),
        titles: 0,
        playoffs: 0,
        lastPlaces: 0,
        allPlayWins: 0,
        allPlayLosses: 0,
        longestWinStreak: 0,
        longestLossStreak: 0,
        weeklySpread: 0,
        weekly: [],
      };
      rows.set(key, r);
    }
    return r;
  };

  for (const season of seasons) {
    const keys = new Set([...season.managers.keys()].map((id) => keyOf(season, id)));
    for (const key of keys) row(key).seasons++;
  }

  for (const game of games) {
    for (const [mine, theirs] of [
      [game.a, game.b],
      [game.b, game.a],
    ] as const) {
      const r = row(mine.key);
      record(r, mine.points, theirs.points);
      r.weekly.push(mine.points);
      // Streaks run across seasons: a manager who ends one year on four wins
      // and opens the next on two has won six in a row.
      const run = runs.get(mine.key) ?? 0;
      const next =
        mine.points > theirs.points
          ? Math.max(run, 0) + 1
          : mine.points < theirs.points
            ? Math.min(run, 0) - 1
            : 0;
      runs.set(mine.key, next);
      r.longestWinStreak = Math.max(r.longestWinStreak, next);
      r.longestLossStreak = Math.max(r.longestLossStreak, -next);
    }
  }

  // All-play: every team against every other team, every regular-season week.
  for (const season of seasons) {
    const weeks = new Map<number, TeamResult[]>();
    for (const result of season.results) {
      if (result.week >= season.playoffs.weekStart) continue;
      weeks.set(result.week, [...(weeks.get(result.week) ?? []), result]);
    }
    for (const week of weeks.values()) {
      for (const mine of week) {
        const r = row(keyOf(season, mine.rosterId));
        for (const other of week) {
          if (other === mine) continue;
          if (mine.points > other.points) r.allPlayWins++;
          else if (mine.points < other.points) r.allPlayLosses++;
        }
      }
    }
  }

  for (const summary of summaries) {
    const last = summary.standings[summary.standings.length - 1];
    for (const standing of summary.standings) {
      const r = row(standing.key);
      if (standing.finish === 1) r.titles++;
      if (standing.madePlayoffs) r.playoffs++;
      if (standing === last) r.lastPlaces++;
    }
  }

  const table: TableRow[] = [...rows.values()]
    .map(({ weekly, ...r }) => ({
      ...r,
      pointsFor: round2(r.pointsFor),
      pointsAgainst: round2(r.pointsAgainst),
      weeklySpread: round2(stdev(weekly)),
    }))
    .sort((a, b) => b.titles - a.titles || winPct(b) - winPct(a) || b.pointsFor - a.pointsFor);

  // Records.
  const sides = games.flatMap((game) => [
    { season: game.season, week: game.week, key: game.a.key, points: game.a.points, opponent: game.b },
    { season: game.season, week: game.week, key: game.b.key, points: game.b.points, opponent: game.a },
  ]);
  const best = <T>(items: T[], score: (item: T) => number): T | null =>
    items.reduce<T | null>((top, item) => (top === null || score(item) > score(top) ? item : top), null);
  const wins = sides.filter((s) => s.points > s.opponent.points);
  const losses = sides.filter((s) => s.points < s.opponent.points);

  // Best and worst season compare finished seasons only: a season two games
  // old at 2-0 is not the best season in league history.
  const finished = new Set(summaries.filter((summary) => summary.complete).map((summary) => summary.season));
  const seasonLines: SeasonRecord[] = [];
  for (const season of seasons.filter((s) => finished.has(s.season))) {
    const lines = new Map<ManagerKey, Line>();
    for (const game of gamesOf(season)) {
      for (const [mine, theirs] of [
        [game.a, game.b],
        [game.b, game.a],
      ] as const) {
        const line = lines.get(mine.key) ?? emptyLine();
        record(line, mine.points, theirs.points);
        lines.set(mine.key, line);
      }
    }
    for (const [key, line] of lines) {
      seasonLines.push({ season: season.season, key, ...line, pointsFor: round2(line.pointsFor) });
    }
  }

  const records: Records = {
    highestWeek: best(sides, (s) => s.points),
    lowestWeek: best(sides, (s) => -s.points),
    biggestBlowout: best(wins, (s) => s.points - s.opponent.points),
    narrowestWin: best(wins, (s) => -(s.points - s.opponent.points)),
    highestScoringLoss: best(losses, (s) => s.points),
    lowestScoringWin: best(wins, (s) => -s.points),
    bestSeason: [...seasonLines].sort(byRecord)[0] ?? null,
    worstSeason: [...seasonLines].sort(byRecord).at(-1) ?? null,
  };

  // Head to head.
  const headToHead = new Map<ManagerKey, Map<ManagerKey, HeadToHead>>();
  for (const game of games) {
    for (const [mine, theirs] of [
      [game.a, game.b],
      [game.b, game.a],
    ] as const) {
      const against = headToHead.get(mine.key) ?? new Map<ManagerKey, HeadToHead>();
      const line = against.get(theirs.key) ?? emptyLine();
      record(line, mine.points, theirs.points);
      against.set(theirs.key, line);
      headToHead.set(mine.key, against);
    }
  }

  return { managers, seasons: summaries, table, records, headToHead, games: games.length };
}
