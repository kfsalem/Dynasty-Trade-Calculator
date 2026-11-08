import type { BrokenRecord, PostMove, WeeklyPost } from '../engine/weeklyPost';

/**
 * The weekly post (#169) as words: one set of lines read by the copied text,
 * the image and the preview, so the three cannot say different things.
 */

export interface PostRankingLine {
  rank: number;
  name: string;
  record: string;
  /** Win-now lineup strength against the leader, who is 100. */
  index: number;
}

export interface PostItem {
  label: string;
  text: string;
}

export interface PostLines {
  title: string;
  subtitle: string;
  rankingsNote: string;
  rankings: PostRankingLine[];
  items: PostItem[];
}

const points = (n: number) => n.toFixed(2);

const recordOf = (line: { wins: number; losses: number; ties: number }) =>
  `${line.wins}–${line.losses}${line.ties > 0 ? `–${line.ties}` : ''}`;

/** What a record is measured in: the winning margin for the two that are about one. */
function recordValue(record: Pick<BrokenRecord, 'key' | 'points'> & { opponentPoints?: number }) {
  if (record.key === 'biggestBlowout' || record.key === 'narrowestWin') {
    return record.points - (record.opponentPoints ?? 0);
  }
  return record.points;
}

export function recordText(record: BrokenRecord): string {
  const value = points(recordValue({ ...record, opponentPoints: record.opponent?.points }));
  const opponent = record.opponent?.name ?? 'their opponent';
  const what = {
    highestWeek: `Highest score ever: ${record.name}, ${value}`,
    lowestWeek: `Lowest score ever: ${record.name}, ${value}`,
    biggestBlowout: `Biggest win ever: ${record.name} beat ${opponent} by ${value}`,
    narrowestWin: `Narrowest win ever: ${record.name} beat ${opponent} by ${value}`,
    highestScoringLoss: `Highest score in a loss: ${record.name}, ${value}, beaten by ${opponent}`,
    lowestScoringWin: `Lowest score in a win: ${record.name}, ${value}, against ${opponent}`,
  }[record.key];
  const was = record.previous;
  const old = points(recordValue({ key: record.key, points: was.points, opponentPoints: was.opponentPoints }));
  return `${what}. The old record was ${old}, ${was.name} in ${was.season} week ${was.week}.`;
}

const list = (items: string[]) =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

export function moveText(move: PostMove): PostItem {
  if (move.kind === 'claim') {
    return { label: 'Biggest claim', text: `${move.name} paid $${move.bid} for ${move.player}.` };
  }
  if (move.kind === 'busiest') {
    const each = move.names.length > 1 ? ' each' : '';
    return { label: 'Busiest on the wire', text: `${list(move.names)}, ${move.adds} pickups${each}.` };
  }
  const sides = move.sides.map((side) => `${side.name} gets ${list(side.gets)}`).join('; ');
  const more =
    move.more === 0 ? '' : move.more === 1 ? ' One more trade this week.' : ` ${move.more} more trades this week.`;
  return { label: 'Trade', text: `${sides}.${more}` };
}

export function postLines(post: WeeklyPost, leagueName: string): PostLines {
  const items: PostItem[] = [];
  if (post.highScore) {
    items.push({ label: 'High score', text: `${post.highScore.name}, ${points(post.highScore.points)}.` });
  }
  if (post.upset) {
    const { winner, loser } = post.upset;
    items.push({
      label: 'Upset',
      text: `${winner.name} (${recordOf(winner)} going in) beat ${loser.name} (${recordOf(loser)}), ${points(winner.points)}–${points(loser.points)}.`,
    });
  }
  for (const record of post.records) items.push({ label: 'League record', text: recordText(record) });
  if (post.move) items.push(moveText(post.move));

  return {
    title: leagueName,
    subtitle: `Week ${post.week} · ${post.season}`,
    rankingsNote: 'Power rankings: starting lineups as valued today, leader = 100',
    rankings: post.rankings.map((row) => ({
      rank: row.rank,
      name: row.name,
      record: recordOf(row),
      index: Math.round(row.index * 100),
    })),
    items,
  };
}

/** Plain text for a group chat: no markdown, which half the chat apps would show as symbols. */
export function postText(lines: PostLines, url: string): string {
  return [
    `${lines.title} · ${lines.subtitle}`,
    '',
    lines.rankingsNote,
    ...lines.rankings.map((row) => `${row.rank}. ${row.name} ${row.record} · ${row.index}`),
    '',
    ...lines.items.map((item) => `${item.label}: ${item.text}`),
    '',
    `Equalace: ${url}`,
  ].join('\n');
}
