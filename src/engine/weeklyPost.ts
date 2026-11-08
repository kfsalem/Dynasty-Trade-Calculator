import type { LeagueHistory, LeagueTransaction, TeamResult } from '../platforms/types';
import type { Roster } from '../types';
import { gradeAgainst } from './grades';
import { fixtures, leagueHistoryStats, type Records, type WeekRecord } from './leagueHistory';
import type { RosterSummary } from './rosterValue';

/**
 * The week, written up for the league chat (#169).
 *
 * The League tab's register, carried out of the app: entertainment on real
 * arithmetic, and nothing in it is a prediction. Each line is something a
 * manager in the chat could check against Sleeper and find true.
 *
 * - **Power rankings** are the app's win-now grade, the same `starterValue`
 *   `contentionProfile` grades, ranked with `gradeAgainst` so ties share a rank
 *   the way they do on My team. Each carries an index against the leader,
 *   because a rank alone throws away the margin (see `Grade`). It is a
 *   statement about rosters today, not a forecast of who wins.
 * - **The biggest upset** is judged on the records going into the week, not
 *   on a model: a team that had won two or more fewer games beat one that had
 *   won more. A projection would make it a claim about what *should* have
 *   happened, and that belongs in the lineup panel, where it carries its odds.
 * - **A record broken** is one of the League tab's six, held after this week
 *   by a game played this week, and held by somebody else before it. A
 *   league's first-ever week sets every record and breaks none.
 * - **One move**: the week's trade if there was one, otherwise its biggest
 *   winning bid, otherwise whoever made the most pickups. Week 1 has none,
 *   because Sleeper files the whole offseason under it.
 */

export interface PowerRow {
  rosterId: number;
  /** 1 is the strongest lineup. Ties share the better rank. */
  rank: number;
  name: string;
  wins: number;
  losses: number;
  ties: number;
  /** Win-now lineup strength against the leader's, 0-1. The leader is 1. */
  index: number;
}

export interface PostSide {
  rosterId: number;
  name: string;
  points: number;
}

export interface Upset {
  winner: PostSide & { wins: number; losses: number; ties: number };
  loser: PostSide & { wins: number; losses: number; ties: number };
}

export type RecordKey = Exclude<keyof Records, 'bestSeason' | 'worstSeason'>;

export interface BrokenRecord {
  key: RecordKey;
  name: string;
  points: number;
  opponent?: { name: string; points: number };
  previous: {
    name: string;
    points: number;
    opponentPoints?: number;
    season: string;
    week: number;
  };
}

export type PostMove =
  | {
      kind: 'trade';
      /** What each roster received. Two sides on almost every trade. */
      sides: { name: string; gets: string[] }[];
      /** Other trades the same week, not described. */
      more: number;
    }
  | { kind: 'claim'; name: string; player: string; bid: number }
  /** Most pickups, waiver and free agent. Everyone tied at the top is named. */
  | { kind: 'busiest'; names: string[]; adds: number };

export interface WeeklyPost {
  season: string;
  week: number;
  rankings: PowerRow[];
  highScore: PostSide | null;
  upset: Upset | null;
  records: BrokenRecord[];
  move: PostMove | null;
}

export interface WeeklyPostInput {
  history: LeagueHistory;
  season: string;
  /** The last finished regular-season week. */
  week: number;
  /** This season's rosters, for names. */
  rosters: Roster[];
  summaries: Pick<RosterSummary, 'rosterId' | 'starterValue'>[];
  /** This week's transactions, or null when they were not loaded. */
  moves: LeagueTransaction[] | null;
  playerName: (id: string) => string | null;
}

/** The record keys the post can announce, in the League tab's order. */
export const RECORD_KEYS: readonly RecordKey[] = [
  'highestWeek',
  'lowestWeek',
  'biggestBlowout',
  'narrowestWin',
  'highestScoringLoss',
  'lowestScoringWin',
];

/** An upset needs the loser to have won at least this many more games going in. */
export const UPSET_WINS = 2;

/** The busiest manager on the wire is named only from this many pickups. */
export const BUSIEST_ADDS = 2;

const ordinal = (n: number) =>
  n % 100 >= 11 && n % 100 <= 13 ? `${n}th` : `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

interface Line {
  wins: number;
  losses: number;
  ties: number;
}

function linesThrough(games: [TeamResult, TeamResult][], lastWeek: number): Map<number, Line> {
  const lines = new Map<number, Line>();
  const line = (id: number) => {
    let l = lines.get(id);
    if (!l) lines.set(id, (l = { wins: 0, losses: 0, ties: 0 }));
    return l;
  };
  for (const [a, b] of games) {
    if (a.week > lastWeek) continue;
    for (const [mine, theirs] of [
      [a, b],
      [b, a],
    ]) {
      const l = line(mine.rosterId);
      if (mine.points > theirs.points) l.wins++;
      else if (mine.points < theirs.points) l.losses++;
      else l.ties++;
    }
  }
  return lines;
}

/** Null when the week has no finished regular-season game to write about. */
export function weeklyPost(input: WeeklyPostInput): WeeklyPost | null {
  const { history, season, week, rosters, summaries, moves, playerName } = input;
  const current = history.seasons.find((s) => s.season === season);
  if (!current || week < 1 || week >= current.playoffs.weekStart) return null;

  const games = fixtures(current);
  const thisWeek = games.filter(([a]) => a.week === week);
  if (thisWeek.length === 0) return null;

  const rosterName = (rosterId: number) => {
    const roster = rosters.find((r) => r.rosterId === rosterId);
    if (!roster) return `Team ${rosterId}`;
    return roster.ownerId ? roster.ownerName : roster.teamName;
  };
  const empty: Line = { wins: 0, losses: 0, ties: 0 };

  // Power rankings.
  const after = linesThrough(games, week);
  const scores = summaries.map((s) => s.starterValue);
  const leader = Math.max(...scores, 0);
  const rankings: PowerRow[] = summaries
    .map((s) => ({
      rosterId: s.rosterId,
      rank: gradeAgainst(s.starterValue, scores).rank,
      name: rosterName(s.rosterId),
      ...(after.get(s.rosterId) ?? empty),
      index: leader > 0 ? s.starterValue / leader : 0,
    }))
    .sort((a, b) => a.rank - b.rank || b.index - a.index || a.name.localeCompare(b.name));

  // High score.
  const sides = thisWeek.flat();
  const top = sides.reduce((best, side) => (side.points > best.points ? side : best));
  const highScore: PostSide = { rosterId: top.rosterId, name: rosterName(top.rosterId), points: top.points };

  // Biggest upset, on the records going in.
  const before = linesThrough(games, week - 1);
  let upset: Upset | null = null;
  let upsetGap = 0;
  for (const [a, b] of thisWeek) {
    if (a.points === b.points) continue;
    const [win, lose] = a.points > b.points ? [a, b] : [b, a];
    const w = before.get(win.rosterId) ?? empty;
    const l = before.get(lose.rosterId) ?? empty;
    const gap = l.wins - w.wins;
    if (gap < UPSET_WINS) continue;
    const margin = win.points - lose.points;
    const bestMargin = upset ? upset.winner.points - upset.loser.points : 0;
    if (gap > upsetGap || (gap === upsetGap && margin > bestMargin)) {
      upsetGap = gap;
      upset = {
        winner: { rosterId: win.rosterId, name: rosterName(win.rosterId), points: win.points, ...w },
        loser: { rosterId: lose.rosterId, name: rosterName(lose.rosterId), points: lose.points, ...l },
      };
    }
  }

  // Records broken this week.
  const records: BrokenRecord[] = [];
  const now = leagueHistoryStats(history, 'points', { season, lastCompleteWeek: week });
  const then = leagueHistoryStats(history, 'points', { season, lastCompleteWeek: week - 1 });
  const managerName = (key: string, stats = now) => stats.managers.get(key)?.name ?? 'Unknown';
  for (const key of RECORD_KEYS) {
    const held: WeekRecord | null = now.records[key];
    const was: WeekRecord | null = then.records[key];
    if (!held || !was || held.season !== season || held.week !== week) continue;
    records.push({
      key,
      name: managerName(held.key),
      points: held.points,
      opponent: held.opponent
        ? { name: managerName(held.opponent.key), points: held.opponent.points }
        : undefined,
      previous: {
        name: managerName(was.key, then),
        points: was.points,
        opponentPoints: was.opponent?.points,
        season: was.season,
        week: was.week,
      },
    });
  }

  return { season, week, rankings, highScore, upset, records, move: weekMove(week, moves, rosterName, playerName) };
}

function weekMove(
  week: number,
  moves: LeagueTransaction[] | null,
  rosterName: (rosterId: number) => string,
  playerName: (id: string) => string | null,
): PostMove | null {
  if (!moves || week === 1) return null;
  const done = moves.filter((m) => m.succeeded);

  const trades = done.filter((m) => m.type === 'trade').sort((a, b) => b.created - a.created);
  if (trades.length > 0) {
    const trade = trades[0];
    const sides = trade.rosterIds.map((rosterId) => {
      const gets: string[] = [];
      for (const [id, to] of trade.adds) if (to === rosterId) gets.push(playerName(id) ?? 'a player');
      for (const pick of trade.picks) {
        if (pick.toRosterId === rosterId) gets.push(`a ${pick.season} ${ordinal(pick.round)}`);
      }
      for (const move of trade.budget) {
        if (move.toRosterId === rosterId) gets.push(`$${move.amount} of FAAB`);
      }
      return { name: rosterName(rosterId), gets };
    });
    return { kind: 'trade', sides: sides.filter((s) => s.gets.length > 0), more: trades.length - 1 };
  }

  let claim: PostMove | null = null;
  for (const move of done) {
    if (move.type !== 'waiver' || move.bid === null || move.adds.size === 0) continue;
    const [[id, rosterId]] = [...move.adds];
    const player = playerName(id);
    if (!player) continue;
    if (!claim || (claim.kind === 'claim' && move.bid > claim.bid)) {
      claim = { kind: 'claim', name: rosterName(rosterId), player, bid: move.bid };
    }
  }
  // A $0 claim is a real bid, but "the biggest bid was $0" is not news.
  if (claim && claim.kind === 'claim' && claim.bid > 0) return claim;

  const pickups = new Map<number, number>();
  for (const move of done) {
    if (move.type !== 'waiver' && move.type !== 'free_agent') continue;
    for (const rosterId of move.adds.values()) pickups.set(rosterId, (pickups.get(rosterId) ?? 0) + 1);
  }
  const most = Math.max(0, ...pickups.values());
  // One pickup is a roster spot filled, not a busy week.
  if (most < BUSIEST_ADDS) return null;
  const names = [...pickups]
    .filter(([, n]) => n === most)
    .map(([rosterId]) => rosterName(rosterId))
    .sort((a, b) => a.localeCompare(b));
  return { kind: 'busiest', names, adds: most };
}
