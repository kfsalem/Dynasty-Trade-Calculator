import { emptyDataset } from './columns';

/** One published season file, as `publishedSeasons` reports it. */
export interface SeasonCandidate {
  season: number;
  url: string;
}

/** A season that is published but has barely been played. */
export interface ThinSeason {
  season: number;
  rows: number;
}

/**
 * Anything a dataset reduction produces. Only the player count is read here.
 */
export interface Reduction {
  file: { players: object };
}

/**
 * Take the newest published season that actually holds a season's worth of data.
 *
 * **A published season is not a season with data in it.** nflverse writes a
 * season's file the moment its first game kicks off, so for the fortnight after
 * an opener the newest file is a real 200 holding almost nothing: on
 * 2026-09-11, `snap_counts_2026.csv` was one game old — 94 rows, 27 skill
 * players against a floor of 300. The build failed, and the failure it reported
 * was schema drift, which is the one thing it was not.
 *
 * Falling back to the season before it is the right answer rather than a
 * mitigation. The app is built for exactly this state: `useLeagueData` shows
 * whatever the ingest last produced, because a snap share from last November is
 * still worth reading, and passes it to valuation as empty once its season is
 * not the one being played. Every factor comes out at 1 and the model is what it
 * was before activity existed.
 *
 * The floor is kept, and it is what tells the two cases apart. **One thin
 * season is a calendar; two is a source that changed under us.** If nothing the
 * caller offers clears the floor, that is drift and the build stops.
 */
export async function reduceStartedSeason<R extends Reduction>(
  dataset: string,
  minPlayers: number,
  candidates: SeasonCandidate[],
  read: (candidate: SeasonCandidate) => Promise<R>,
): Promise<{ chosen: R; rows: number; notStarted: ThinSeason[] }> {
  const notStarted: ThinSeason[] = [];

  for (const candidate of candidates) {
    const attempt = await read(candidate);
    const rows = Object.keys(attempt.file.players).length;

    if (rows >= minPlayers) return { chosen: attempt, rows, notStarted };

    notStarted.push({ season: candidate.season, rows });
  }

  /*
    Reported against the newest, which is the file whoever reads the failed
    build will go and open. `candidates` is never empty — `publishedSeasons`
    throws rather than return nothing — but a caller that passed an empty list
    would otherwise get an undefined here instead of a stated failure.
  */
  throw emptyDataset(dataset, notStarted[0]?.rows ?? 0, minPlayers);
}
