/**
 * Build-time ingest of nflverse weekly activity data.
 *
 * Run by CI before `npm run build`, and by hand with `npm run ingest`. It
 * exists because the app cannot fetch this data itself, for two independent
 * reasons: nflverse publishes as GitHub release assets, which send no CORS
 * header, and the depth chart file alone is 53 MB. Reducing here keeps the app
 * a zero-backend static site and turns 53 MB into kilobytes.
 *
 * Failure policy is the interesting part. A network failure must never break a
 * deploy — the committed copy of `public/data` is still correct, just older, so
 * the run warns and keeps it. Schema drift is the opposite: it fails the build,
 * because a source that parsed into nothing looks exactly like an offseason and
 * would ship silently empty.
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  DATA_FILES,
  type DataIndex,
  type DatasetMeta,
  type DatasetName,
} from '../src/data/types';
import { requireRows } from './ingest/columns';
import { IngestError } from './ingest/errors';
import { loadCrosswalk, matchRate, type Crosswalk, type MatchStats } from './ingest/crosswalk';
import { fetchText, resolveLatestSeason } from './ingest/sources';
import { reduceDepthCharts } from './ingest/depthCharts';
import { reduceSnapCounts } from './ingest/snapCounts';
import { reduceWeeklyStats } from './ingest/weeklyStats';

const OUT_DIR = fileURLToPath(new URL('../public/data/', import.meta.url));

/** Everything in public/data ships to every visitor. Keep it honest. */
const BUDGET_BYTES = 1_000_000;

/** How many unmatched names to print before truncating. */
const UNMATCHED_SHOWN = 15;

interface Reduced {
  file: DatasetMeta & { players: Record<string, unknown> };
  stats: MatchStats;
}

interface Dataset {
  name: DatasetName;
  release: string;
  fileFor: (season: number) => string;
  reduce: (
    csv: string,
    crosswalk: Crosswalk,
    meta: { season: number; source: string; generatedAt: string },
  ) => Reduced;
  /**
   * Floor for a plausible reduction. Set well under the real figure — this is
   * catching "the position codes changed and we kept nothing", not policing
   * week-to-week movement. Reductions when this was written: 622 / 603 / 764.
   */
  minPlayers: number;
}

const DATASETS: Dataset[] = [
  {
    name: 'snaps',
    release: 'snap_counts',
    fileFor: (season) => `snap_counts_${season}.csv`,
    reduce: reduceSnapCounts,
    minPlayers: 300,
  },
  {
    name: 'opportunity',
    release: 'stats_player',
    fileFor: (season) => `stats_player_week_${season}.csv`,
    reduce: reduceWeeklyStats,
    minPlayers: 300,
  },
  {
    name: 'depth',
    release: 'depth_charts',
    fileFor: (season) => `depth_charts_${season}.csv`,
    reduce: reduceDepthCharts,
    minPlayers: 400,
  },
];

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
const pct = (fraction: number) => `${(fraction * 100).toFixed(1)}%`;

async function fileSize(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

/** Meta of a dataset we could not refresh, so the index still dates it correctly. */
async function readExistingMeta(path: string): Promise<DatasetMeta & { players: number }> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  const file = parsed as DatasetMeta & { players: Record<string, unknown> };
  return {
    generatedAt: file.generatedAt,
    season: file.season,
    throughWeek: file.throughWeek,
    source: file.source,
    players: Object.keys(file.players ?? {}).length,
  };
}

function reportMatches(stats: MatchStats): void {
  const total = stats.matched + stats.unmatched;
  console.log(
    `    ${total} players -> ${stats.matched} matched to Sleeper (${pct(matchRate(stats))})`,
  );

  const byPosition = Object.entries(stats.byPosition)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([position, counts]) => `${position} ${pct(matchRate(counts))}`)
    .join('  ');
  if (byPosition) console.log(`    ${byPosition}`);

  if (stats.unmatchedNames.length > 0) {
    const shown = stats.unmatchedNames.slice(0, UNMATCHED_SHOWN);
    const rest = stats.unmatchedNames.length - shown.length;
    console.log(
      `    unmatched: ${shown.join(', ')}${rest > 0 ? `, and ${rest} more` : ''}`,
    );
  }
}

async function main(): Promise<void> {
  const generatedAt = new Date().toISOString();
  await mkdir(OUT_DIR, { recursive: true });

  console.log('nflverse ingest');

  let crosswalk: Crosswalk | null = null;
  try {
    crosswalk = await loadCrosswalk();
    console.log(`  crosswalk  ${crosswalk.rows} players carry a Sleeper id`);
  } catch (err) {
    if (!(err instanceof IngestError) || err.kind !== 'fetch') throw err;
    // Without the crosswalk nothing can be Sleeper-keyed, so every dataset
    // falls back together.
    console.warn(`  crosswalk  ${err.message}`);
  }

  const datasets: DataIndex['datasets'] = {};
  let stale = 0;

  for (const dataset of DATASETS) {
    const path = `${OUT_DIR}${DATA_FILES[dataset.name]}`;

    try {
      if (!crosswalk) {
        throw new IngestError('fetch', 'Skipped: the id crosswalk was unavailable.');
      }

      const { season, url } = await resolveLatestSeason(
        dataset.name,
        dataset.release,
        dataset.fileFor,
      );
      const csv = await fetchText(url);
      const { file, stats } = dataset.reduce(csv, crosswalk, {
        season,
        source: url,
        generatedAt,
      });

      const players = Object.keys(file.players).length;
      requireRows(dataset.name, players, dataset.minPlayers);

      await writeFile(path, `${JSON.stringify(file)}\n`);

      const through = file.throughWeek === null ? 'snapshot' : `through week ${file.throughWeek}`;
      console.log(`  ${dataset.name}  ${file.season} season, ${through}`);
      reportMatches(stats);
      console.log(`    ${DATA_FILES[dataset.name]}  ${kb((await fileSize(path)) ?? 0)}`);

      datasets[dataset.name] = {
        file: DATA_FILES[dataset.name],
        generatedAt: file.generatedAt,
        season: file.season,
        throughWeek: file.throughWeek,
        players,
        fresh: true,
      };
    } catch (err) {
      // Schema drift is a real failure and must stop the build.
      if (!(err instanceof IngestError) || err.kind !== 'fetch') throw err;

      const existing = (await fileSize(path)) !== null ? await readExistingMeta(path) : null;
      if (!existing) {
        throw new IngestError(
          'fetch',
          `${dataset.name}: ${err.message} No committed copy at ${DATA_FILES[dataset.name]} ` +
            `to fall back to, so there is nothing to ship.`,
        );
      }

      stale++;
      console.warn(`  ${dataset.name}  ${err.message}`);
      console.warn(
        `    falling back to the committed copy from ${existing.generatedAt} ` +
          `(${existing.season} season, ${existing.players} players)`,
      );

      datasets[dataset.name] = {
        file: DATA_FILES[dataset.name],
        generatedAt: existing.generatedAt,
        season: existing.season,
        throughWeek: existing.throughWeek,
        players: existing.players,
        fresh: false,
      };
    }
  }

  const index: DataIndex = { generatedAt, datasets };
  await writeFile(`${OUT_DIR}${DATA_FILES.index}`, `${JSON.stringify(index, null, 2)}\n`);

  let total = 0;
  for (const name of Object.values(DATA_FILES)) {
    total += (await fileSize(`${OUT_DIR}${name}`)) ?? 0;
  }

  console.log(`  total  ${kb(total)} of a ${kb(BUDGET_BYTES)} budget`);
  if (stale > 0) {
    console.warn(`  ${stale} of ${DATASETS.length} datasets are the committed fallback, not fresh.`);
  }

  if (total > BUDGET_BYTES) {
    throw new IngestError(
      'schema',
      `public/data is ${kb(total)}, over the ${kb(BUDGET_BYTES)} budget. Every visitor ` +
        `downloads this — drop a column or a window before raising the budget.`,
    );
  }
}

main().catch((err: unknown) => {
  console.error(`\nIngest failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
