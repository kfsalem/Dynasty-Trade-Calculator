/**
 * Shapes of the static JSON that `npm run ingest` writes into `public/data/`.
 *
 * These live in `src/` rather than `scripts/` because both ends need them: the
 * ingest produces these files and the app consumes them, and this file is the
 * only thing keeping the two in step.
 *
 * Weekly rows are number tuples rather than objects, with the column order
 * published alongside them. The app has a hard 1 MB budget for everything in
 * `public/data/` and repeating eight keys on every player-week costs roughly
 * half of it for nothing.
 */

/** Positions worth ingesting. Everything downstream values offensive skill players. */
export const SKILL_POSITIONS = ['QB', 'RB', 'FB', 'WR', 'TE'] as const;

export interface DatasetMeta {
  /** ISO timestamp of the ingest run that wrote this file. */
  generatedAt: string;
  /** nflverse season the rows cover. */
  season: number;
  /**
   * Highest regular-season week present, so the UI can say "data through
   * Week N". Null for datasets that are a point-in-time snapshot rather than a
   * weekly series.
   */
  throughWeek: number | null;
  /** URL the rows came from, so a number that looks wrong is traceable. */
  source: string;
}

// ---------------------------------------------------------------------------
// snaps.json — nflverse snap_counts, one row per player-week
// ---------------------------------------------------------------------------

export const SNAP_COLUMNS = ['week', 'offenseSnaps', 'offensePct'] as const;

/** `offensePct` is a 0-1 fraction, as nflverse publishes it. */
export type SnapWeek = [week: number, offenseSnaps: number, offensePct: number];

export interface SnapPlayer {
  /** Position as the snap report lists it, which is roster position, not fantasy. */
  pos: string;
  /** Team in the most recent week present. */
  team: string;
  /** Ascending by week. A week absent means no snap report, not zero snaps. */
  weeks: SnapWeek[];
}

export interface SnapCountsFile extends DatasetMeta {
  columns: typeof SNAP_COLUMNS;
  /** Keyed by Sleeper player id. */
  players: Record<string, SnapPlayer>;
}

// ---------------------------------------------------------------------------
// opportunity.json — nflverse stats_player_week, one row per player-week
// ---------------------------------------------------------------------------

export const OPPORTUNITY_COLUMNS = [
  'week',
  'targets',
  'targetShare',
  'airYardsShare',
  'wopr',
  'carries',
  'receptions',
  'fantasyPointsPpr',
] as const;

/**
 * Shares are null when nflverse publishes `NA`, never 0 — a receiver who was
 * not on the field and one who ran routes and saw nothing are different
 * players, and collapsing both onto zero is how that distinction gets lost.
 */
export type OpportunityWeek = [
  week: number,
  targets: number,
  targetShare: number | null,
  airYardsShare: number | null,
  wopr: number | null,
  carries: number,
  receptions: number,
  fantasyPointsPpr: number,
];

export interface OpportunityPlayer {
  pos: string;
  team: string;
  weeks: OpportunityWeek[];
}

export interface OpportunityFile extends DatasetMeta {
  columns: typeof OPPORTUNITY_COLUMNS;
  /** Keyed by Sleeper player id. */
  players: Record<string, OpportunityPlayer>;
}

// ---------------------------------------------------------------------------
// depth.json — nflverse depth_charts, newest snapshot only
// ---------------------------------------------------------------------------

export interface DepthPlayer {
  team: string;
  /** QB / RB / FB / WR / TE, as the chart abbreviates it. */
  pos: string;
  /** Depth rank within team and position. 1 is first on the chart. */
  rank: number;
}

export interface DepthChartsFile extends DatasetMeta {
  /** Timestamp of the chart snapshot itself — nflverse republishes constantly. */
  asOf: string;
  /** Keyed by Sleeper player id. */
  players: Record<string, DepthPlayer>;
}

// ---------------------------------------------------------------------------
// index.json — what shipped, so the UI can date the data without loading it all
// ---------------------------------------------------------------------------

export interface DataIndexEntry {
  file: string;
  generatedAt: string;
  season: number;
  throughWeek: number | null;
  players: number;
  /** False when this dataset fell back to the committed copy on the last run. */
  fresh: boolean;
}

export interface DataIndex {
  generatedAt: string;
  datasets: Record<string, DataIndexEntry>;
}

export const DATA_FILES = {
  snaps: 'snaps.json',
  opportunity: 'opportunity.json',
  depth: 'depth.json',
  index: 'index.json',
} as const;

export type DatasetName = Exclude<keyof typeof DATA_FILES, 'index'>;
