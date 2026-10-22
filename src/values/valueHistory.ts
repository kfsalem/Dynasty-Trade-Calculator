import { SNAPSHOT_DIR, type ValueSnapshotFile, VALUE_COLUMNS } from './fantasycalcRows';

/**
 * FantasyCalc's values over time (#158).
 *
 * FantasyCalc publishes today's values and nothing earlier, which blocked #76
 * from scoring a trade against the values of its day and made #157 freeze a
 * snapshot by hand every week. Since #43 every refresh saves today's values,
 * so this keeps them: one point per weekly refresh in season and one a month
 * out of it.
 *
 * **Two histories, not sixty.** Within a QB setting the formats are the same
 * market: on 2026-10-13 to 10-20, every 1QB format's week-over-week change
 * correlated 0.992–1.000 with the 10-team PPR one's, and superflex the same.
 * So each QB setting keeps one, at 10 teams and PPR.
 *
 * **The market's figure, not the league's.** These are FantasyCalc's raw
 * values. A league-adjusted value depends on that league's rosters at the
 * time, which no history kept here could reproduce, and the chart says whose
 * number it is.
 *
 * Outside the 1 MB budget, as the snapshots are: about 5 KB a point, so a
 * season of points is around 110 KB per QB setting, and it is fetched only
 * when a player panel opens.
 */

export type HistoryQbs = 1 | 2;

/** `values/history-1qb.json`, relative to `public/data/`. */
export const historyFile = (numQbs: HistoryQbs): string => `${SNAPSHOT_DIR}/history-${numQbs}qb.json`;

/** The format each history is kept in: the snapshot it is appended from. */
export const historySourceFile = (numQbs: HistoryQbs): string =>
  `${SNAPSHOT_DIR}/dynasty-${numQbs}qb-10t-ppr1.json`;

/**
 * One player: his position, then dynasty value and win-now value at each of
 * the file's `dates`. Null where FantasyCalc did not list him that day.
 */
export type HistoryRow = [position: string, value: (number | null)[], redraft: (number | null)[]];

export interface ValueHistoryFile {
  generatedAt: string;
  numQbs: HistoryQbs;
  /** Where the points came from, including the ones seeded by hand. */
  source: string;
  /** ISO dates, oldest first. One point per date. */
  dates: string[];
  /** Keyed by Sleeper player id. */
  players: Record<string, HistoryRow>;
}

export const emptyHistory = (numQbs: HistoryQbs, source: string): ValueHistoryFile => ({
  generatedAt: '',
  numQbs,
  source,
  dates: [],
  players: {},
});

/**
 * Add one day's snapshot to a history, or replace that day's point if it is
 * already there. Returns a new file; the one passed in is not changed.
 *
 * A date already present is replaced rather than duplicated, so a refresh run
 * twice in a day leaves one point. A date earlier than the newest is refused:
 * the history only moves forward, and slotting a point into the middle would
 * mean every player's arrays had to be rebuilt to the same length.
 */
export function appendPoint(
  history: ValueHistoryFile,
  date: string,
  snapshot: Pick<ValueSnapshotFile, 'rows'>,
  generatedAt: string,
): ValueHistoryFile {
  const last = history.dates.at(-1);
  if (last !== undefined && date < last) {
    throw new Error(`${date} is earlier than the newest point, ${last}`);
  }
  const replacing = last === date;
  const dates = replacing ? history.dates : [...history.dates, date];
  const at = dates.length - 1;

  const id = VALUE_COLUMNS.indexOf('sleeperId');
  const pos = VALUE_COLUMNS.indexOf('position');
  const value = VALUE_COLUMNS.indexOf('value');
  const redraft = VALUE_COLUMNS.indexOf('redraftValue');

  const players: Record<string, HistoryRow> = {};
  // Everyone already kept, padded to the new length; a man missing today gets null.
  for (const [playerId, [position, values, redrafts]] of Object.entries(history.players)) {
    const v = values.slice(0, at);
    const r = redrafts.slice(0, at);
    while (v.length < at) v.push(null);
    while (r.length < at) r.push(null);
    players[playerId] = [position, [...v, null], [...r, null]];
  }
  for (const row of snapshot.rows) {
    const playerId = String(row[id]);
    const existing = players[playerId] ?? [String(row[pos] ?? ''), Array(at + 1).fill(null), Array(at + 1).fill(null)];
    existing[1][at] = Math.round(Number(row[value]));
    existing[2][at] = Math.round(Number(row[redraft]));
    if (row[pos]) existing[0] = String(row[pos]);
    players[playerId] = existing;
  }

  return { ...history, generatedAt, dates, players };
}

export interface HistoryPoint {
  date: string;
  value: number;
  redraft: number;
}

/** One player's points, oldest first, skipping days FantasyCalc did not list him. */
export function playerSeries(history: ValueHistoryFile, playerId: string): HistoryPoint[] {
  const row = history.players[playerId];
  if (!row) return [];
  const [, values, redrafts] = row;
  return history.dates.flatMap((date, i) => {
    const value = values[i];
    const redraft = redrafts[i];
    return value == null || redraft == null ? [] : [{ date, value, redraft }];
  });
}

