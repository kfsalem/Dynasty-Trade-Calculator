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
import {
  describeUnmatched,
  loadCrosswalk,
  matchRate,
  sampleSize,
  type Crosswalk,
  type MatchStats,
} from './ingest/crosswalk';
import { requireMatchRates, type MatchGate } from './ingest/matchGate';
import { fetchText, resolveLatestSeason } from './ingest/sources';
import { reduceDepthCharts } from './ingest/depthCharts';
import { reduceSnapCounts } from './ingest/snapCounts';
import { reduceWeeklyStats } from './ingest/weeklyStats';

const OUT_DIR = fileURLToPath(new URL('../public/data/', import.meta.url));

/** Everything in public/data ships to every visitor. Keep it honest. */
const BUDGET_BYTES = 1_000_000;

/**
 * Every player with a real role who did not resolve is named in full. Below the
 * relevance line the list is a sample, because an offseason chart carries 150
 * camp bodies and printing all of them buries the eight that matter.
 */
const IRRELEVANT_UNMATCHED_SHOWN = 10;

/**
 * The build gate. Measured against players with a role, never the raw rate.
 *
 * 90% sits well under the ~98% these datasets actually run at, which is
 * deliberate: the gate is here to catch an id format changing upstream, not to
 * police the handful of practice-squad call-ups DynastyProcess has not indexed
 * yet. QB/RB/WR/TE only — see MatchGate.positions for why FB is excluded.
 */
const GATE: MatchGate = {
  positions: ['QB', 'RB', 'WR', 'TE'],
  minRate: 0.9,
  minSample: 20,
  // These datasets clear the bar with 400-500 players each; 200 is a collapse,
  // not a quiet week.
  minRelevantTotal: 200,
};

interface Reduced {
  file: DatasetMeta & { players: Record<string, unknown> };
  stats: MatchStats;
  /** Anything the reduction wants said in the build log. */
  notes?: string[];
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

function reportMatches(stats: MatchStats, gate: MatchGate): void {
  console.log(
    `    all players    ${stats.all.total.matched}/${sampleSize(stats.all.total)} ` +
      `matched to Sleeper (${pct(matchRate(stats.all.total))})`,
  );

  const relevantSample = sampleSize(stats.relevant.total);
  if (relevantSample === 0) {
    // Distinguished from a 0% match rate on purpose: nothing was measured, and
    // printing "0/0 (0.0%)" reads as a total collapse instead.
    console.log('    with a role    no players cleared the relevance bar');
  } else {
    // Every gated position, so one that vanished shows as "absent" rather than
    // simply not appearing in the line.
    const positions = [...new Set([...gate.positions, ...Object.keys(stats.relevant.byPosition)])]
      .sort()
      .map((position) => {
        const counts = stats.relevant.byPosition[position];
        return counts ? `${position} ${pct(matchRate(counts))}` : `${position} absent`;
      })
      .join('  ');

    console.log(
      `    with a role    ${stats.relevant.total.matched}/${relevantSample} ` +
        `(${pct(matchRate(stats.relevant.total))})   ${positions}`,
    );
  }

  // The gate reads the line above; this is the evidence behind it.
  const relevant = stats.unmatched.filter((player) => player.relevant);
  if (relevant.length > 0) {
    console.log(`    ${relevant.length} unmatched despite having a role:`);
    for (const player of relevant) {
      console.log(`      ${describeUnmatched(player)}`);
    }
  }

  const rest = stats.unmatched.filter((player) => !player.relevant);
  if (rest.length > 0) {
    const shown = rest.slice(0, IRRELEVANT_UNMATCHED_SHOWN);
    const hidden = rest.length - shown.length;
    console.log(
      `    ${rest.length} unmatched below the relevance line: ` +
        `${shown.map(describeUnmatched).join(', ')}` +
        `${hidden > 0 ? `, and ${hidden} more` : ''}`,
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
      const { file, stats, notes } = dataset.reduce(csv, crosswalk, {
        season,
        source: url,
        generatedAt,
      });

      const players = Object.keys(file.players).length;
      requireRows(dataset.name, players, dataset.minPlayers);

      const through = file.throughWeek === null ? 'snapshot' : `through week ${file.throughWeek}`;
      console.log(`  ${dataset.name}  ${file.season} season, ${through}`);
      for (const note of notes ?? []) console.warn(`    ${note}`);
      reportMatches(stats, GATE);

      // After the report, so a failing build still shows the evidence.
      requireMatchRates(dataset.name, stats, GATE);

      await writeFile(path, `${JSON.stringify(file)}\n`);

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
