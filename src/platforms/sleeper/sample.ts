import { ApiError } from '../../lib/http';

/**
 * The sample league (#159): a real Sleeper league, recorded by the ingest with
 * every manager's name taken out, and replayed in place of the league
 * endpoints when a visitor asks to try the app without a league of their own.
 *
 * Only the responses that belong to the league are frozen — the league, its
 * rosters, users, picks, drafts, matchups, brackets and transactions, for every
 * season the history walk reaches. Everything that belongs to the NFL is still
 * fetched live: the player index, this week's projections, the schedule and
 * the current week. So injuries and projections in the sample are today's,
 * and the rosters are as of the last refresh, at most a week old in season.
 *
 * Why replay at the endpoint rather than ship a `LeagueBundle`: the mapper,
 * the season walk and the history readers then run on the sample exactly as
 * they run on a real league, and there is no second shape to keep in step.
 */

/** The sample's current season. Earlier seasons are `sample-1`, `sample-2`, … */
export const SAMPLE_LEAGUE_ID = 'sample';

/**
 * The manager whose team a visitor is given in the sample: roster 1's, since
 * the recording numbers managers by their current roster.
 */
export const SAMPLE_CLAIM_USER = `${SAMPLE_LEAGUE_ID}-user-1`;

export const SAMPLE_FILE = 'sample/league.json';

export function isSampleId(id: string): boolean {
  return id === SAMPLE_LEAGUE_ID || id.startsWith(`${SAMPLE_LEAGUE_ID}-`);
}

/**
 * The recorded responses, keyed by path under Sleeper's `/v1`, such as
 * `/league/sample/rosters` or `/draft/sample-draft-1`.
 */
export interface SampleFile {
  generatedAt: string;
  season: string;
  responses: Record<string, unknown>;
}

let loading: Promise<SampleFile> | null = null;

function load(): Promise<SampleFile> {
  loading ??= (async () => {
    // Vite's base in the app; absent when the ingest imports this under Node.
    const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
    let res: Response;
    try {
      res = await fetch(`${base}data/${SAMPLE_FILE}`);
    } catch {
      throw new ApiError('The sample league could not be loaded. Check your connection.');
    }
    if (!res.ok) throw new ApiError('The sample league is not available right now.', res.status);
    return (await res.json()) as SampleFile;
  })().catch((err: unknown) => {
    // A failed load must not stick: the next attempt asks again.
    loading = null;
    throw err;
  });
  return loading;
}

/**
 * One recorded response, unvalidated: the caller parses it with the same
 * schema a live response goes through.
 *
 * A path that was never recorded answers the way Sleeper answers an unknown
 * league, so every caller's existing handling of a missing week or a missing
 * season applies unchanged.
 */
export async function sampleResponse(path: string): Promise<unknown> {
  const file = await load();
  if (!(path in file.responses)) {
    throw new ApiError('Not found. Double-check the ID.', 404, path);
  }
  return file.responses[path];
}

/** For tests: forget the loaded file. */
export function resetSample() {
  loading = null;
}
