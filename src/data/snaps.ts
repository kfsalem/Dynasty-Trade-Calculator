import { DATA_FILES, SNAP_COLUMNS, type SnapCountsFile } from './types';

/**
 * Load the snap counts shipped by `npm run ingest`.
 *
 * A static asset under the app's own base path, not a third-party API — see
 * `docs/DATA.md` for why nflverse cannot be fetched from the browser at all.
 *
 * Nothing here throws. Activity data enriches the roster rows; it is not what
 * the app is for, and a stale or missing file should cost the user a column of
 * dashes rather than the page. Every failure returns null and says why in the
 * console.
 */
export async function fetchSnapCounts(): Promise<SnapCountsFile | null> {
  const url = `${import.meta.env.BASE_URL}data/${DATA_FILES.snaps}`;

  let body: unknown;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`Snap counts unavailable: ${url} returned ${res.status}.`);
      return null;
    }
    body = await res.json();
  } catch (err) {
    console.warn(`Snap counts unavailable: ${err instanceof Error ? err.message : err}`);
    return null;
  }

  return validate(body, url);
}

/**
 * Check the file says what this build expects it to say.
 *
 * The column check is the one that earns its keep. Weekly rows are positional
 * number tuples, so a file left over from a deploy with a different column
 * order would parse cleanly and be read wrong — every snap share silently
 * pulled from the snap *count* column. That is far worse than no data, and it
 * is invisible without this.
 */
function validate(body: unknown, url: string): SnapCountsFile | null {
  const file = body as Partial<SnapCountsFile> | null;

  if (!file || typeof file !== 'object' || typeof file.players !== 'object') {
    console.warn(`Snap counts at ${url} are not in the expected shape; ignoring them.`);
    return null;
  }

  const columns = file.columns;
  if (
    !Array.isArray(columns) ||
    columns.length !== SNAP_COLUMNS.length ||
    columns.some((column, i) => column !== SNAP_COLUMNS[i])
  ) {
    console.warn(
      `Snap counts at ${url} declare columns [${String(columns)}], but this build reads ` +
        `[${SNAP_COLUMNS.join(', ')}]. Ignoring them rather than reading the wrong number.`,
    );
    return null;
  }

  return file as SnapCountsFile;
}
