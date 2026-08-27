import { IngestError } from './errors';

/**
 * nflverse ships each dataset as a GitHub *release asset*, which is why this
 * runs at build time instead of in the browser. Release assets redirect to
 * release-assets.githubusercontent.com, which sends no Access-Control-Allow-Origin
 * header, so a fetch from kfsalem.github.io is blocked outright. Node does not
 * enforce CORS, so the same request is fine here.
 */
const NFLVERSE_RELEASE = 'https://github.com/nflverse/nflverse-data/releases/download';

/**
 * DynastyProcess's id crosswalk, on raw.githubusercontent.com — which *does*
 * send `Access-Control-Allow-Origin: *`. It is fetchable from the browser, but
 * resolving ids here means the client never downloads 2.6 MB to look up numbers
 * we already knew at build time.
 */
export const CROSSWALK_URL =
  'https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv';

/**
 * The NFL schedule, every season since 1999 in one file.
 *
 * Also on raw.githubusercontent.com, and so the one nflverse dataset the app
 * could legally fetch for itself. It is ingested anyway: 2.18 MB of history to
 * answer "who is off this week" is a poor trade against a `public/data` budget
 * of 1 MB total, and reduced to a bye per team it is under a kilobyte.
 *
 * Unlike the release assets there is no per-season file to resolve — one URL
 * carries every year, and `reduceByeWeeks` picks the newest season out of the
 * rows.
 */
export const BYES_URL = 'https://github.com/nflverse/nfldata/raw/master/data/games.csv';

export function nflverseUrl(release: string, file: string): string {
  return `${NFLVERSE_RELEASE}/${release}/${file}`;
}

const RETRIES = 3;
const RETRY_DELAY_MS = 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch a CSV, retrying transient failures.
 *
 * Everything that gets here is a large file over a redirect, and a deploy that
 * fails because one request was reset — when the fallback path exists precisely
 * for real outages — is just noise.
 */
export async function fetchText(url: string): Promise<string> {
  let lastError = '';

  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url);

      if (res.ok) return await res.text();

      lastError = `HTTP ${res.status}`;
      // 4xx other than rate limiting will not fix itself.
      if (res.status < 500 && res.status !== 429) break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    if (attempt < RETRIES) await sleep(RETRY_DELAY_MS * attempt);
  }

  throw new IngestError('fetch', `Could not fetch ${url}: ${lastError}.`);
}

async function exists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

/** How far back to look before giving up on finding any published season. */
const SEASON_LOOKBACK = 3;

/**
 * Find the newest season nflverse has actually published for a dataset.
 *
 * This is per-dataset on purpose. The datasets do not advance together: on
 * 2026-07-30, `depth_charts_2026.csv` was live and being rewritten hourly while
 * `snap_counts_2026.csv` and `stats_player_week_2026.csv` were still 404 —
 * offseason depth charts exist, offseason snaps do not. Assuming one season for
 * everything either 404s the whole build in July or pins depth charts a year
 * stale come September.
 */
export async function resolveLatestSeason(
  dataset: string,
  release: string,
  fileFor: (season: number) => string,
): Promise<{ season: number; url: string }> {
  const newest = new Date().getUTCFullYear();

  for (let season = newest; season > newest - SEASON_LOOKBACK; season--) {
    const url = nflverseUrl(release, fileFor(season));
    if (await exists(url)) return { season, url };
  }

  throw new IngestError(
    'fetch',
    `${dataset}: no published season found in ${newest - SEASON_LOOKBACK + 1}-${newest}. ` +
      `Checked ${nflverseUrl(release, fileFor(newest))} and ${SEASON_LOOKBACK - 1} earlier seasons.`,
  );
}
