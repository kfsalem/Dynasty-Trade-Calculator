import { mkdir, readFile, writeFile } from 'node:fs/promises';

import {
  FANTASYCALC_URL,
  SNAPSHOT_DIR,
  VALUE_COLUMNS,
  allVariants,
  responseSchema,
  snapshotFile,
  toRows,
  variantQuery,
  type ValueSnapshotFile,
} from '../../src/values/fantasycalcRows';
import { IngestError } from './errors';
import { fetchText } from './sources';

/**
 * A copy of FantasyCalc's values for every league format, saved at build time
 * so the app has something to price a league with when FantasyCalc does not
 * answer (#43).
 *
 * The failure policy is the opposite of the nflverse datasets', deliberately.
 * There, a source that changed shape fails the build, because shipping the
 * result would ship silently empty data. Here the file being written *is* the
 * fallback, and the day FantasyCalc changes shape or goes away is the day the
 * last good copy is worth most. So nothing in this module fails a build: a
 * format that cannot be refreshed keeps its committed file, and says so.
 */

/**
 * Fewest rows a real response has. Dynasty formats carry about 420 and redraft
 * about 200; a response under this is an error page that happened to parse.
 */
const MIN_ROWS = 100;

/** A format's file is 7-16 KB. Three times that is a response that changed. */
const MAX_FILE_BYTES = 48_000;

/** Sixty requests to a volunteer API should not arrive as a burst. */
const PAUSE_MS = 250;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Turn one response body into the file to write, or throw saying why not. */
export function buildSnapshot(
  body: string,
  meta: { source: string; generatedAt: string },
): ValueSnapshotFile {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new IngestError('schema', 'the response was not JSON');
  }

  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new IngestError(
      'schema',
      `unexpected response shape at ${issue?.path.join('.') || '(root)'}: ${issue?.message ?? 'validation failed'}`,
    );
  }

  const { rows, rawMax } = toRows(parsed.data);
  if (rows.length < MIN_ROWS) {
    throw new IngestError(
      'schema',
      `only ${rows.length} players carry a Sleeper id, under the floor of ${MIN_ROWS}`,
    );
  }
  if (rawMax <= 1) {
    throw new IngestError('schema', 'no player has a value, so there is no scale');
  }

  return {
    generatedAt: meta.generatedAt,
    source: meta.source,
    columns: VALUE_COLUMNS,
    rawMax,
    rows,
  };
}

async function committedDate(path: string): Promise<string | null> {
  try {
    const file = JSON.parse(await readFile(path, 'utf8')) as { generatedAt?: unknown };
    return typeof file.generatedAt === 'string' ? file.generatedAt : null;
  } catch {
    return null;
  }
}

export interface SnapshotReport {
  fresh: number;
  /** Formats left on their committed copy. */
  kept: number;
  /** Formats with no file at all: the app has no fallback for these. */
  missing: number;
  bytes: number;
}

export async function ingestValueSnapshots(
  outDir: string,
  generatedAt: string,
): Promise<SnapshotReport> {
  await mkdir(`${outDir}${SNAPSHOT_DIR}`, { recursive: true });

  const report: SnapshotReport = { fresh: 0, kept: 0, missing: 0, bytes: 0 };
  const failures: string[] = [];

  for (const variant of allVariants()) {
    const name = snapshotFile(variant);
    const path = `${outDir}${name}`;
    const url = `${FANTASYCALC_URL}?${variantQuery(variant)}`;

    try {
      const file = buildSnapshot(await fetchText(url), { source: url, generatedAt });
      const text = `${JSON.stringify(file)}\n`;
      if (text.length > MAX_FILE_BYTES) {
        throw new IngestError(
          'schema',
          `the file would be ${text.length} bytes, over the ${MAX_FILE_BYTES} a format is allowed`,
        );
      }

      await writeFile(path, text);
      report.fresh++;
      report.bytes += text.length;
    } catch (err) {
      const existing = await committedDate(path);
      if (existing) report.kept++;
      else report.missing++;

      failures.push(
        `    ${name}: ${err instanceof Error ? err.message : String(err)} — ` +
          (existing ? `keeping the copy from ${existing}` : 'and there is no committed copy'),
      );
    }

    await sleep(PAUSE_MS);
  }

  const total = report.fresh + report.kept + report.missing;
  console.log(
    `  values  ${report.fresh} of ${total} FantasyCalc formats refreshed, ` +
      `${(report.bytes / 1024).toFixed(1)} KB`,
  );
  if (failures.length > 0) {
    console.warn(`    ${failures.length} formats could not be refreshed:`);
    // Sixty identical lines say nothing the first few do not.
    for (const line of failures.slice(0, 5)) console.warn(line);
    if (failures.length > 5) console.warn(`    …and ${failures.length - 5} more`);
  }

  return report;
}
