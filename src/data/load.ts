import type { DatasetMeta } from './types';

/**
 * Load one of the static files `npm run ingest` writes into `public/data/`.
 *
 * These are assets under the app's own base path, not third-party APIs — see
 * `docs/DATA.md` for why nflverse cannot be fetched from the browser at all.
 *
 * Nothing here throws. Activity data enriches the roster rows; it is not what
 * the app is for, and a stale or missing file should cost the user a column of
 * dashes rather than the page. Every failure returns null and says why in the
 * console.
 */
export async function fetchDataFile<T extends DatasetMeta>(
  file: string,
  /** Column order to verify, for files whose rows are positional tuples. */
  expected?: readonly string[],
  /**
   * The key the file's rows live under. `byes.json` is keyed by team rather
   * than by player, and a validator that insists on `players` would reject it
   * as malformed — which is worse than it sounds, because the rejection is a
   * console warning and a silent absence of byes.
   */
  collection: 'players' | 'teams' = 'players',
): Promise<T | null> {
  const url = `${import.meta.env.BASE_URL}data/${file}`;

  let body: unknown;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`${file} unavailable: ${url} returned ${res.status}.`);
      return null;
    }
    body = await res.json();
  } catch (err) {
    console.warn(`${file} unavailable: ${err instanceof Error ? err.message : err}`);
    return null;
  }

  return validate<T>(body, file, url, expected, collection);
}

/**
 * Check the file says what this build expects it to say.
 *
 * The column check is the one that earns its keep. Weekly rows are positional
 * number tuples, so a file left over from a deploy with a different column
 * order would parse cleanly and be read wrong — every share silently pulled
 * from a neighbouring column. That is far worse than no data, and it is
 * invisible without this.
 */
function validate<T extends DatasetMeta>(
  body: unknown,
  file: string,
  url: string,
  expected?: readonly string[],
  collection: 'players' | 'teams' = 'players',
): T | null {
  const parsed = body as Partial<T> & Record<string, unknown>;

  // `typeof null === 'object'`, so the collection needs a truthiness check of
  // its own: a file with `"players": null` would otherwise pass validation here
  // and throw on the first iteration downstream.
  const rows = parsed ? parsed[collection] : undefined;
  if (!parsed || typeof parsed !== 'object' || !rows || typeof rows !== 'object') {
    console.warn(
      `${file} at ${url} has no ${collection}; ignoring it rather than reading an empty file.`,
    );
    return null;
  }

  // Depth chart rows are objects with named fields, so there is no column
  // order to check and nothing positional to get wrong.
  if (!expected) return parsed as T;

  const columns = parsed.columns;
  if (
    !Array.isArray(columns) ||
    columns.length !== expected.length ||
    columns.some((column, i) => column !== expected[i])
  ) {
    console.warn(
      `${file} declares columns [${String(columns)}], but this build reads ` +
        `[${expected.join(', ')}]. Ignoring it rather than reading the wrong number.`,
    );
    return null;
  }

  return parsed as T;
}
