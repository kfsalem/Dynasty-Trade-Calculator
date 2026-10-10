import { ApiError, fetchJson } from '../lib/http';
import { TTL } from '../lib/cache';
import type { LeagueSettings } from '../types';
import { fetchFantasyCalcValues, type ValueBundle } from './fantasycalc';
import { snapshotFile, snapshotSchema, valuesFromRows, variantFor } from './fantasycalcRows';

/**
 * Where player values come from, as a seam (#43).
 *
 * The app used to call FantasyCalc by name, and player values gate the league
 * render, so an outage on a first visit was the whole app down. Everything
 * downstream now depends on this shape instead, and `loadPlayerValues` walks a
 * list of them.
 */
export interface ValueSource {
  id: string;
  /** How the source is named to a reader. */
  label: string;
  fetchPlayerValues(settings: LeagueSettings): Promise<ValueBundle>;
}

export const fantasyCalcLive: ValueSource = {
  id: 'fantasycalc',
  label: 'FantasyCalc',
  fetchPlayerValues: fetchFantasyCalcValues,
};

/**
 * FantasyCalc's own values, as the ingest last saved them.
 *
 * The same market on the same scale, only older: the file holds the rows the
 * live response would have produced and is read through the same mapping, so
 * the win-now split and every league adjustment mean what they meant. That is
 * the property a different market could not offer without a normalisation step
 * of its own, and why this stands ahead of one.
 *
 * Served from the app's own origin, so it is there whenever the app is.
 */
export const fantasyCalcSnapshot: ValueSource = {
  id: 'fantasycalc-snapshot',
  label: 'FantasyCalc',
  async fetchPlayerValues(settings) {
    const url = `${import.meta.env.BASE_URL}data/${snapshotFile(variantFor(settings))}`;
    const file = await fetchJson(url, snapshotSchema);

    const fetchedAt = Date.parse(file.generatedAt);
    if (!Number.isFinite(fetchedAt)) {
      throw new ApiError(`Snapshot at ${url} carries no readable date.`, undefined, url);
    }

    return { bySleeperId: valuesFromRows(file), rawMax: file.rawMax, fetchedAt };
  },
};

/**
 * How the values on screen were come by.
 *
 * - `live`: fetched from the source within its freshness window.
 * - `cached`: the source could not be reached and the browser's last copy was
 *   served past its expiry (`lib/cache`).
 * - `snapshot`: the source could not be reached and the saved copy was used.
 */
export type ValueOriginKind = 'live' | 'cached' | 'snapshot';

export interface ValueOrigin {
  kind: ValueOriginKind;
  /** The `ValueSource.id` that produced the numbers. */
  sourceId: string;
  label: string;
  /** When the numbers were fetched from the market, epoch ms. */
  asOf: number;
}

export interface SourcedValues extends ValueBundle {
  origin: ValueOrigin;
}

/** A fetch a few minutes past the TTL is a slow tab, not an outage. */
const FRESH_MS = TTL.VALUES + 5 * 60 * 1000;

/**
 * Values from the primary source, or the newest copy anyone still has.
 *
 * Falls back on *error*, not merely on absence: a source that throws for any
 * reason, a changed response shape included, hands over to the next.
 *
 * `cached()` already serves an expired copy when a refresh fails, and says so
 * only in the console. That copy can be older than the snapshot — a visitor who
 * was last here in August holds August's values — so an expired copy is treated
 * as a failure too, and the newer of the two wins.
 *
 * Throws the primary's error when nothing at all can be served, so a reader is
 * told about the source that matters and not about a missing file.
 */
export async function loadPlayerValues(
  settings: LeagueSettings,
  primary: ValueSource = fantasyCalcLive,
  fallbacks: ValueSource[] = [fantasyCalcSnapshot],
  now: number = Date.now(),
): Promise<SourcedValues> {
  const origin = (
    source: ValueSource,
    kind: ValueOriginKind,
    bundle: ValueBundle,
  ): SourcedValues => ({
    ...bundle,
    origin: { kind, sourceId: source.id, label: source.label, asOf: bundle.fetchedAt },
  });

  let best: SourcedValues | undefined;
  let primaryError: unknown;

  try {
    const bundle = await primary.fetchPlayerValues(settings);
    if (now - bundle.fetchedAt <= FRESH_MS) return origin(primary, 'live', bundle);
    best = origin(primary, 'cached', bundle);
  } catch (err) {
    primaryError = err;
  }

  for (const source of fallbacks) {
    try {
      const candidate = origin(source, 'snapshot', await source.fetchPlayerValues(settings));
      if (!best || candidate.origin.asOf > best.origin.asOf) best = candidate;
    } catch (err) {
      console.warn(
        `${source.id}: unavailable as a fallback (${err instanceof Error ? err.message : String(err)}).`,
      );
    }
  }

  if (best) {
    console.warn(
      `Player values: ${primary.id} could not be refreshed; using the ${best.origin.kind} copy ` +
        `from ${new Date(best.origin.asOf).toISOString()}.`,
    );
    return best;
  }

  throw primaryError;
}
