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
 * Value a pick, degrading gracefully as precision drops.
 *
 * Order of preference: exact slot -> tier -> generic round -> round average.
 * A pick in a season past what the source publishes falls back to the furthest
 * season available, which understates nothing meaningfully — pick values flatten
 * hard that far out.
 */
export function lookupPickValue(
  table: PickValueTable,
  season: string,
  round: number,
  slot: number | null = null,
  tier: PickTier = null,
): number {
  const effectiveSeason = table.seasons.includes(season)
    ? season
    : season > (table.seasons.at(-1) ?? '')
      ? (table.seasons.at(-1) as string)
      : (table.seasons[0] as string);

  const inSeason = table.rows.filter(
    (r) => r.season === effectiveSeason && r.round === round,
  );
  if (inSeason.length === 0) return 0;

  if (slot !== null) {
    const exact = inSeason.find((r) => r.slot === slot);
    if (exact) return exact.value;
  }

  if (tier) {
    const tiered = inSeason.find((r) => r.tier === tier);
    if (tiered) return tiered.value;
  }

  const generic = inSeason.find((r) => r.slot === null && r.tier === null);
  if (generic) return generic.value;

  // Seasons with exact slots have no generic row; the round's median slot is
  // the honest neutral estimate when we don't know where a team will pick.
  const sorted = [...inSeason].sort((a, b) => a.value - b.value);
  return sorted[Math.floor(sorted.length / 2)]?.value ?? 0;
}
