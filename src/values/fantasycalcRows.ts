import { z } from 'zod';
import { isPosition } from '../types';
import type { LeagueSettings, PlayerValue } from '../types';

/**
 * FantasyCalc's response, and the two things made from it: the app's value
 * table, and the trimmed rows the ingest saves as a snapshot (#43).
 *
 * Kept apart from `fantasycalc.ts` because both ends read it. The browser maps
 * a live response through `toRows` and `valuesFromRows`; the ingest maps the
 * same response through `toRows` and writes the rows down; and the snapshot is
 * read back through `valuesFromRows`. One mapping, so a snapshot cannot drift
 * from what the live source would have said. Nothing here touches the network
 * or IndexedDB, which is what lets a Node script import it.
 */

export const FANTASYCALC_URL = 'https://api.fantasycalc.com/values/current';

const entrySchema = z.object({
  player: z.object({
    id: z.number(),
    name: z.string(),
    position: z.string().nullish(),
    sleeperId: z.string().nullish(),
    mflId: z.string().nullish(),
    espnId: z.string().nullish(),
    fleaflickerId: z.string().nullish(),
    ffpcId: z.string().nullish(),
    maybeAge: z.number().nullish(),
  }),
  value: z.number(),
  redraftValue: z.number().nullish(),
  overallRank: z.number(),
  positionRank: z.number().nullish(),
  trend30Day: z.number().nullish(),
  maybeTier: z.number().nullish(),
});

export const responseSchema = z.array(entrySchema);
export type FantasyCalcResponse = z.infer<typeof responseSchema>;

/** FantasyCalc only publishes values for these league sizes. */
export const SUPPORTED_TEAM_COUNTS = [8, 10, 12, 14, 16];
/** …and these reception-point settings. */
export const SUPPORTED_PPR = [0, 0.5, 1];
/** One quarterback or two. Sleeper's mapper only ever produces these. */
export const SUPPORTED_QBS = [1, 2];

const nearest = (target: number, options: number[]): number =>
  options.reduce((best, o) => (Math.abs(o - target) < Math.abs(best - target) ? o : best));

/** The league format as FantasyCalc is asked for it. */
export interface ValueVariant {
  isDynasty: boolean;
  numQbs: number;
  numTeams: number;
  ppr: number;
}

export function variantFor(settings: LeagueSettings): ValueVariant {
  return {
    isDynasty: settings.isDynasty,
    numQbs: settings.numQbs,
    numTeams: nearest(settings.teamCount, SUPPORTED_TEAM_COUNTS),
    ppr: nearest(settings.ppr, SUPPORTED_PPR),
  };
}

export function variantQuery(variant: ValueVariant): string {
  return new URLSearchParams({
    isDynasty: String(variant.isDynasty),
    numQbs: String(variant.numQbs),
    numTeams: String(variant.numTeams),
    ppr: String(variant.ppr),
  }).toString();
}

/** Every format a snapshot is kept for: 2 × 2 × 5 × 3 = 60. */
export function allVariants(): ValueVariant[] {
  const variants: ValueVariant[] = [];
  for (const isDynasty of [true, false]) {
    for (const numQbs of SUPPORTED_QBS) {
      for (const numTeams of SUPPORTED_TEAM_COUNTS) {
        for (const ppr of SUPPORTED_PPR) variants.push({ isDynasty, numQbs, numTeams, ppr });
      }
    }
  }
  return variants;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export const VALUE_COLUMNS = [
  'sleeperId',
  'position',
  'value',
  'redraftValue',
  'overallRank',
  'positionRank',
  'trend30Day',
  'tier',
] as const;

/**
 * One priced player, in FantasyCalc's raw units.
 *
 * A tuple for the reason the nflverse files use them: sixty snapshots of four
 * hundred rows each repeat eight keys 24,000 times otherwise.
 */
export type ValueRow = [
  sleeperId: string,
  position: string | null,
  value: number,
  redraftValue: number,
  overallRank: number,
  positionRank: number,
  trend30Day: number,
  tier: number | null,
];

export interface ValueRows {
  rows: ValueRow[];
  /**
   * Highest raw dynasty value in the response, over *every* entry.
   *
   * Carried rather than recomputed from `rows`, because rows without a Sleeper
   * id are dropped and the scale must not move when one of them was the top.
   */
  rawMax: number;
}

export function toRows(response: FantasyCalcResponse): ValueRows {
  const rawMax = response.reduce((max, r) => Math.max(max, r.value), 0) || 1;
  const rows: ValueRow[] = [];

  for (const entry of response) {
    const sleeperId = entry.player.sleeperId;
    if (!sleeperId) continue;
    rows.push([
      sleeperId,
      entry.player.position ?? null,
      entry.value,
      entry.redraftValue ?? 0,
      entry.overallRank,
      entry.positionRank ?? 0,
      entry.trend30Day ?? 0,
      entry.maybeTier ?? null,
    ]);
  }

  return { rows, rawMax };
}

export function valuesFromRows({ rows, rawMax }: ValueRows): Map<string, PlayerValue> {
  const bySleeperId = new Map<string, PlayerValue>();

  for (const row of rows) {
    const [sleeperId, rawPosition, value, redraftValue, overallRank, positionRank, trend30Day, tier] =
      row;
    // Normalized to a source-independent 0-10000 scale so a second value
    // source can be blended in later without mixing incompatible units.
    const normalized = Math.round((value / rawMax) * 10000);
    // Divided by the *dynasty* maximum on purpose, not by a redraft one of
    // its own. FantasyCalc quotes both columns in the same raw units, and a
    // second divisor would throw that away — the two would each run 0-10000
    // and a player's dynasty and redraft figures would no longer be
    // comparable, which is the one property R8 needs from them.
    const redraft = Math.round((redraftValue / rawMax) * 10000);
    const position = rawPosition?.toUpperCase();

    bySleeperId.set(sleeperId, {
      playerId: sleeperId,
      position: isPosition(position) ? position : null,
      value: normalized,
      marketValue: normalized,
      redraftValue: redraft,
      // A market map holds the raw figure on both scales; `applyReplacement`
      // is what turns each into its league-adjusted counterpart.
      winNowValue: redraft,
      overallRank,
      positionRank,
      trend30Day,
      tier,
      source: 'fantasycalc',
    });
  }

  return bySleeperId;
}

// ---------------------------------------------------------------------------
// The snapshot file
// ---------------------------------------------------------------------------

/** Where the snapshots live, under `public/data/`. */
export const SNAPSHOT_DIR = 'values';

/** `values/dynasty-1qb-10t-ppr1.json`, relative to `public/data/`. */
export function snapshotFile(variant: ValueVariant): string {
  const format = variant.isDynasty ? 'dynasty' : 'redraft';
  return `${SNAPSHOT_DIR}/${format}-${variant.numQbs}qb-${variant.numTeams}t-ppr${variant.ppr}.json`;
}

const rowSchema = z.tuple([
  z.string(),
  z.string().nullable(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number().nullable(),
]);

/**
 * `columns` is checked as a literal for the reason `data/load.ts` checks the
 * nflverse files: rows are positional, so a file left over from a build with a
 * different column order would parse cleanly and be read wrong.
 */
export const snapshotSchema = z.object({
  /** ISO timestamp of the ingest run that fetched these values. */
  generatedAt: z.string(),
  source: z.string(),
  columns: z.tuple(
    VALUE_COLUMNS.map((c) => z.literal(c)) as [z.ZodLiteral<string>, ...z.ZodLiteral<string>[]],
  ),
  rawMax: z.number().positive(),
  rows: z.array(rowSchema),
});

export interface ValueSnapshotFile extends ValueRows {
  generatedAt: string;
  source: string;
  columns: typeof VALUE_COLUMNS;
}
