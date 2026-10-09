import { fetchJson } from '../lib/http';
import { cached, TTL } from '../lib/cache';
import type { LeagueSettings, PlayerValue } from '../types';
import {
  FANTASYCALC_URL,
  responseSchema,
  toRows,
  valuesFromRows,
  variantFor,
  variantQuery,
} from './fantasycalcRows';

/**
 * Cross-platform id map, harvested from the same payload as the values.
 *
 * FantasyCalc carries sleeper/mfl/espn/fleaflicker/ffpc ids on every player,
 * which is what will let a second platform adapter resolve against the same
 * value table without us maintaining an id crosswalk by hand.
 */
export interface ValueBundle {
  /** Keyed by Sleeper player id. */
  bySleeperId: Map<string, PlayerValue>;
  /** Highest raw value in the set, before normalization. */
  rawMax: number;
  fetchedAt: number;
}

export async function fetchFantasyCalcValues(
  settings: LeagueSettings,
): Promise<ValueBundle> {
  const query = variantQuery(variantFor(settings));
  const url = `${FANTASYCALC_URL}?${query}`;
  // Bump the version whenever the cached *shape* changes. The cache stores the
  // transformed bundle, so a returning user with a warm entry would otherwise
  // deserialize objects missing fields the current code requires.
  // v2: added `position` and `marketValue`.
  // v3: added `winNowValue`.
  const key = `fantasycalc:${query}:v3`;

  return cached(key, TTL.VALUES, async () => {
    // The mapping lives in `fantasycalcRows`, shared with the snapshot (#43).
    const rows = toRows(await fetchJson(url, responseSchema));
    return { bySleeperId: valuesFromRows(rows), rawMax: rows.rawMax, fetchedAt: Date.now() };
  });
}
