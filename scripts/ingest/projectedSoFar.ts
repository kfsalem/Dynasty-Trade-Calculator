import { readFile, writeFile } from 'node:fs/promises';

import {
  DATA_FILES,
  PROJECTED_COLUMNS,
  type DataIndexEntry,
  type ProjectedFile,
  type ScoringFile,
} from '../../src/data/types';
import { IngestError } from './errors';
import { fetchText } from './sources';

/**
 * What each player was projected to score in the games he has played (#181).
 *
 * The lineup panel already shows what a player has scored a game. This is the
 * other half — what Sleeper projected for him in those same games — so a
 * manager can see whether the projection has been right about him. It is
 * evidence, never an input to the ranking: over 2024–26 a player's season-to-
 * date miss did not predict his next one (correlation 0.045, 0.004, −0.069 by
 * season).
 *
 * Built from `scoring.json` rather than beside it. A player's weeks there are
 * the games he played, and only those are summed, so the two sides of the line
 * cover the same games. A week he played without a projection is left out of
 * both, which is what the bitmask records.
 *
 * Failure policy is the value snapshot's: the projections endpoint is
 * Sleeper's undocumented one, and one line of evidence is not worth a failed
 * deploy. A fetch that fails or a response that changed shape keeps the
 * committed file and says so.
 */

const POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const;

/** Fewest players a real season-to-date file holds once a week has been played. */
const MIN_PLAYERS = 200;

export const projectionsUrl = (season: number, week: number) =>
  `https://api.sleeper.app/projections/nfl/${season}/${week}?season_type=regular&` +
  POSITIONS.map((p) => `position[]=${p}`).join('&');

type WeekProjections = Map<string, Record<string, number | null>>;

/** One week's response, as stat lines keyed by Sleeper id, or a schema error. */
export function parseWeek(body: string): WeekProjections {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new IngestError('schema', 'the projections response was not JSON');
  }
  if (!Array.isArray(json)) throw new IngestError('schema', 'the projections response was not a list');
  const out: WeekProjections = new Map();
  for (const row of json as { player_id?: unknown; stats?: unknown }[]) {
    if (typeof row?.player_id !== 'string' || typeof row.stats !== 'object' || !row.stats) continue;
    out.set(row.player_id, row.stats as Record<string, number | null>);
  }
  return out;
}

/** Sum each player's projections over the weeks `scoring` says he played. */
export function reduceProjected(
  scoring: ScoringFile,
  weeks: ReadonlyMap<number, WeekProjections>,
  meta: { generatedAt: string; source: string },
): ProjectedFile {
  const keys = PROJECTED_COLUMNS.slice(1);
  const players: ProjectedFile['players'] = {};

  for (const [id, player] of Object.entries(scoring.players)) {
    if (!(POSITIONS as readonly string[]).includes(player.pos)) continue;
    let mask = 0;
    const sums = keys.map(() => 0);
    for (const [week] of player.weeks) {
      const stats = weeks.get(week)?.get(id);
      if (!stats) continue;
      mask |= 1 << week;
      keys.forEach((key, i) => {
        sums[i] += stats[key] ?? 0;
      });
    }
    if (mask === 0) continue;

    const row = [mask, ...sums.map((sum) => Math.round(sum * 10) / 10)];
    while (row.length > 1 && row[row.length - 1] === 0) row.pop();
    players[id] = row;
  }

  return {
    generatedAt: meta.generatedAt,
    season: scoring.season,
    throughWeek: scoring.throughWeek,
    source: meta.source,
    columns: PROJECTED_COLUMNS,
    players,
  };
}

async function committed(path: string): Promise<ProjectedFile | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as ProjectedFile;
  } catch {
    return null;
  }
}

/**
 * Write `projected.json` for the season `scoring.json` describes, or keep the
 * committed copy. Returns the index entry, or null when there is no file at all.
 */
export async function ingestProjected(
  outDir: string,
  generatedAt: string,
  scoring: ScoringFile | null,
): Promise<DataIndexEntry | null> {
  const path = `${outDir}${DATA_FILES.projected}`;
  const entry = (file: ProjectedFile, fresh: boolean): DataIndexEntry => ({
    file: DATA_FILES.projected,
    generatedAt: file.generatedAt,
    season: file.season,
    throughWeek: file.throughWeek,
    rows: Object.keys(file.players).length,
    fresh,
  });

  try {
    if (!scoring) throw new IngestError('fetch', 'Skipped: there is no scoring file to match against.');

    const through = scoring.throughWeek ?? 0;
    const weeks = new Map<number, WeekProjections>();
    for (let week = 1; week <= through; week++) {
      weeks.set(week, parseWeek(await fetchText(projectionsUrl(scoring.season, week))));
    }

    const file = reduceProjected(scoring, weeks, {
      generatedAt,
      source: projectionsUrl(scoring.season, 1).replace('/1?', '/{week}?'),
    });
    const rows = Object.keys(file.players).length;
    if (through > 0 && rows < MIN_PLAYERS) {
      throw new IngestError('schema', `only ${rows} players matched, under the floor of ${MIN_PLAYERS}`);
    }

    const text = `${JSON.stringify(file)}\n`;
    await writeFile(path, text);
    console.log(
      `  projected  ${file.season} season, through week ${through}, ${rows} players, ` +
        `${(text.length / 1024).toFixed(1)} KB`,
    );
    return entry(file, true);
  } catch (err) {
    const existing = await committed(path);
    console.warn(
      `  projected  ${err instanceof Error ? err.message : String(err)} — ` +
        (existing ? `keeping the copy from ${existing.generatedAt}` : 'and there is no committed copy'),
    );
    return existing ? entry(existing, false) : null;
  }
}
