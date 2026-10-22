import { readFile, writeFile } from 'node:fs/promises';

import type { ValueSnapshotFile } from '../../src/values/fantasycalcRows';
import {
  appendPoint,
  emptyHistory,
  historyFile,
  historySourceFile,
  type HistoryQbs,
  type ValueHistoryFile,
} from '../../src/values/valueHistory';

/**
 * Append today's values to each history (#158). See `values/valueHistory`.
 *
 * **Only when asked.** Every deploy runs the ingest, and a point added there
 * would ship once and vanish at the next deploy, because only the weekly
 * refresh commits what it writes. So the refresh workflow sets
 * `VALUE_HISTORY=append` and nothing else does; without it this leaves the
 * committed histories exactly as they are. The history is then one point per
 * refresh, which is the cadence the issue asked for.
 *
 * **Only from a fresh snapshot.** If FantasyCalc did not answer, the snapshot
 * is last week's copy, and appending it under today's date would invent a
 * point. Never fails a build, as the snapshots never do.
 */

const SOURCE =
  'FantasyCalc values/current, dynasty, 10 teams, PPR, appended by the weekly refresh. ' +
  'Points before 2026-10-27 were seeded from saved responses: 2026-09-29, 10-16 and 10-22 ' +
  'from the forward-test snapshots (#157), 10-09, 10-13 and 10-20 from the committed ' +
  'value snapshots.';

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

export async function appendValueHistory(outDir: string, generatedAt: string): Promise<void> {
  if (process.env.VALUE_HISTORY !== 'append') {
    console.log('  history  left as committed (VALUE_HISTORY is not "append")');
    return;
  }
  const date = generatedAt.slice(0, 10);

  for (const numQbs of [1, 2] as HistoryQbs[]) {
    const path = `${outDir}${historyFile(numQbs)}`;
    try {
      const snapshot = await readJson<ValueSnapshotFile>(`${outDir}${historySourceFile(numQbs)}`);
      if (!snapshot || snapshot.generatedAt !== generatedAt) {
        console.warn(`  history  ${numQbs}QB: today's snapshot was not refreshed, so no point is added`);
        continue;
      }
      const history =
        (await readJson<ValueHistoryFile>(path)) ?? emptyHistory(numQbs, SOURCE);
      const next = appendPoint(history, date, snapshot, generatedAt);
      const text = `${JSON.stringify(next)}\n`;
      await writeFile(path, text);
      console.log(
        `  history  ${numQbs}QB: ${next.dates.length} points through ${date}, ` +
          `${Object.keys(next.players).length} players, ${(text.length / 1024).toFixed(1)} KB`,
      );
    } catch (err) {
      console.warn(
        `  history  ${numQbs}QB: ${err instanceof Error ? err.message : String(err)} — keeping the committed file`,
      );
    }
  }
}
