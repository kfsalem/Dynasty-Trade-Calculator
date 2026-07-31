import { parseCsv } from '../lib/csv';
import { cached, TTL } from '../lib/cache';
import { ApiError } from '../lib/http';
import type { LeagueSettings } from '../types';

const VALUES_CSV =
  'https://raw.githubusercontent.com/dynastyprocess/data/master/files/values.csv';

const ROUND_SUFFIX: Record<string, number> = {
  '1st': 1,
  '2nd': 2,
  '3rd': 3,
  '4th': 4,
  '5th': 5,
};

export type PickTier = 'early' | 'mid' | 'late' | null;

export interface PickValueRow {
  season: string;
  round: number;
  /** 1-based draft slot, when the source knows it (imminent draft only). */
  slot: number | null;
  tier: PickTier;
  /** Normalized to the same 0-10000 scale as player values. */
  value: number;
}

export interface PickValueTable {
  rows: PickValueRow[];
  /** Seasons present in the source, ascending. */
  seasons: string[];
  fetchedAt: number;
}

/**
 * DynastyProcess names picks three different ways depending on how far out the
 * draft is, because that is how much the market actually knows:
 *   "2026 Pick 1.01"  - imminent draft, exact slot
 *   "2027 Early 1st"  - next draft, tiered (also a generic "2027 1st")
 *   "2028 1st"        - generic only
 */
export function parsePickName(name: string): Omit<PickValueRow, 'value'> | null {
  const exact = name.match(/^(\d{4})\s+Pick\s+(\d+)\.(\d+)$/i);
  if (exact) {
    return {
      season: exact[1],
      round: Number(exact[2]),
      slot: Number(exact[3]),
      tier: null,
    };
  }

  const tiered = name.match(/^(\d{4})\s+(Early|Mid|Late)?\s*(1st|2nd|3rd|4th|5th)$/i);
  if (tiered) {
    return {
      season: tiered[1],
      round: ROUND_SUFFIX[tiered[3].toLowerCase()],
      slot: null,
      tier: tiered[2] ? (tiered[2].toLowerCase() as PickTier) : null,
    };
  }

  return null;
}

/**
 * Draft pick values, normalized onto the same scale as player values.
 *
 * The normalization anchor is DynastyProcess's own top *player*, not its top
 * pick. Both sources scale so that the best player in the format sits near the
 * top of the range, so dividing each source by its own max player value puts
 * picks and players in genuinely comparable units. Normalizing picks against
 * the best pick instead would silently inflate every pick in the app.
 */
export async function fetchPickValues(settings: LeagueSettings): Promise<PickValueTable> {
  const column = settings.numQbs >= 2 ? 'value_2qb' : 'value_1qb';

  return cached(`dynastyprocess:picks:${column}:v1`, TTL.VALUES, async () => {
    let text: string;
    try {
      const res = await fetch(VALUES_CSV);
      if (!res.ok) throw new ApiError(`DynastyProcess returned ${res.status}.`);
      text = await res.text();
    } catch (err) {
      throw err instanceof ApiError
        ? err
        : new ApiError('Could not reach DynastyProcess for pick values.');
    }

    const records = parseCsv(text);

    const num = (v: string | undefined): number | null => {
      if (!v || v === 'NA') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const playerMax = records.reduce((max, r) => {
      if (r.pos === 'PICK') return max;
      return Math.max(max, num(r[column]) ?? 0);
    }, 0);

    if (playerMax <= 0) {
      throw new ApiError('DynastyProcess values look empty; cannot normalize picks.');
    }

    const rows: PickValueRow[] = [];
    for (const record of records) {
      if (record.pos !== 'PICK') continue;
      const parsed = parsePickName(record.player);
      const raw = num(record[column]);
      if (!parsed || raw === null) continue;
      rows.push({ ...parsed, value: Math.round((raw / playerMax) * 10000) });
    }

    if (rows.length === 0) {
      throw new ApiError('DynastyProcess returned no parseable draft picks.');
    }

    const seasons = [...new Set(rows.map((r) => r.season))].sort();
    return { rows, seasons, fetchedAt: Date.now() };
  });
}

/**
 * The board DynastyProcess names its picks on.
 *
 * Every pick row is "1.01" through "1.12", and the tiered rows for future
 * seasons split those twelve slots into early/mid/late. The source has no
 * notion of your league's size, so "2.09" means the 21st player off the board
 * and nothing else.
 *
 * Which is exactly why a lookup must go through the **overall pick number**
 * rather than your own slot label. A 10-team league's 2.09 is the 19th pick,
 * and asking DynastyProcess for its "2.09" prices it as the 21st — two picks
 * deeper into a talent pool that does not care how many teams you have. Round 1
 * happens to be immune, since slot and overall coincide there, which is what
 * kept the mismatch invisible.
 *
 * It also fixes larger leagues outright. A 14-team league has slots 13 and 14
 * that no DynastyProcess row names, and those fell through the whole chain onto
 * the round's median — its 1.13 and 1.14 were priced identically, and as
 * mid-firsts. Through overall pick number they are the 13th and 14th picks, so
 * they read off the front of the second round where they belong.
 */
export const BOARD_SIZE = 12;

/** Where a slot sits within the board, for seasons named only by tier. */
const tierOf = (slot: number): PickTier =>
  slot <= BOARD_SIZE / 3 ? 'early' : slot <= (BOARD_SIZE * 2) / 3 ? 'mid' : 'late';

/**
 * Value a pick from its overall position in the draft.
 *
 * Degrades gracefully as the source's precision drops: exact slot for the
 * imminent draft, tier for the next one, generic round after that. A season past
 * what the source publishes falls back to the furthest available, which
 * understates nothing meaningfully — pick values flatten hard that far out — and
 * a round past the deepest published one clamps to it rather than pricing at
 * zero.
 */
export function lookupPickValue(
  table: PickValueTable,
  season: string,
  overallPick: number,
): number {
  const effectiveSeason = table.seasons.includes(season)
    ? season
    : season > (table.seasons.at(-1) ?? '')
      ? (table.seasons.at(-1) as string)
      : (table.seasons[0] as string);

  const pick = Math.max(1, Math.round(overallPick));
  const wanted = Math.ceil(pick / BOARD_SIZE);
  const slot = ((pick - 1) % BOARD_SIZE) + 1;

  const seasonRows = table.rows.filter((r) => r.season === effectiveSeason);
  if (seasonRows.length === 0) return 0;

  // A draft deeper than the source covers clamps to its last round instead of
  // falling to zero. Priced at zero, a 6th-rounder in a six-round rookie draft
  // is an asset the engine will hand over for free.
  const deepest = Math.max(...seasonRows.map((r) => r.round));
  const round = Math.min(wanted, deepest);
  const inRound = seasonRows.filter((r) => r.round === round);
  if (inRound.length === 0) return 0;

  const exact = inRound.find((r) => r.slot === slot);
  if (exact) return exact.value;

  const tiered = inRound.find((r) => r.tier === tierOf(slot));
  if (tiered) return tiered.value;

  const generic = inRound.find((r) => r.slot === null && r.tier === null);
  if (generic) return generic.value;

  // Seasons with exact slots have no generic row; the round's median slot is
  // the honest neutral estimate when we don't know where a team will pick.
  const sorted = [...inRound].sort((a, b) => a.value - b.value);
  return sorted[Math.floor(sorted.length / 2)]?.value ?? 0;
}
