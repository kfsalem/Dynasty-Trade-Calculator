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
  'carryShare',
  'receptions',
  'fantasyPointsPpr',
] as const;

/**
 * Shares are null when nflverse publishes `NA`, never 0 — a receiver who was
 * not on the field and one who ran routes and saw nothing are different
 * players, and collapsing both onto zero is how that distinction gets lost.
 *
 * `carryShare` is the one share nflverse does not publish. It is computed at
 * ingest, where every player who touched the ball is still in the denominator;
 * summing it here from the shipped file would divide by the subset that
 * resolved to a Sleeper id and overstate every back.
 */
export type OpportunityWeek = [
  week: number,
  targets: number,
  targetShare: number | null,
  airYardsShare: number | null,
  wopr: number | null,
  carries: number,
  carryShare: number | null,
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
// scoring.json — nflverse stats_player_week, every column a scoring rule reads
// ---------------------------------------------------------------------------

/**
 * The stat columns a Sleeper scoring rule can be computed from.
 *
 * Separate from `opportunity.json` on purpose. That file answers "how much of
 * his team's work does this player get", which is a *rate* question about
 * roles. This one answers "what did he actually do", which is what a league's
 * own scoring rules multiply. They also cover different players: opportunity is
 * skill positions only, and a kicker has no target share but does have a
 * scoring line.
 *
 * **The order is load-bearing.** Rows are written with trailing zeros trimmed,
 * so a column that is zero for most players costs nothing as long as it sits
 * near the end. Kicking is last because 35 players in the league have any of
 * it; receptions and yards are first because almost everyone does. Reordering
 * this list without re-measuring will quietly cost tens of kilobytes of a
 * budget every visitor pays — the same 37 columns padded rather than trimmed
 * measured 492 KB against this order's 301 KB.
 */
export const SCORING_COLUMNS = [
  'week',
  'receptions',
  'recYards',
  'recTds',
  'rushYards',
  'rushTds',
  'passYards',
  'passTds',
  'passInts',
  'rec40',
  'rush40',
  'pass40',
  'fumblesLost',
  'completions',
  'attempts',
  'carries',
  'sacked',
  'fumbles',
  'passFirstDowns',
  'rushFirstDowns',
  'recFirstDowns',
  'rec2pt',
  'rush2pt',
  'pass2pt',
  'fumbleRecTds',
  'specialTeamsTds',
  'kickReturnYards',
  'puntReturnYards',
  'fgMade',
  'fgMade0_19',
  'fgMade20_29',
  'fgMade30_39',
  'fgMade40_49',
  'fgMade50_59',
  'fgMade60',
  'fgMissed',
  'patMade',
  'patMissed',
] as const;

export type ScoringColumn = (typeof SCORING_COLUMNS)[number];

/**
 * One player-week, positional and **variable length**.
 *
 * Every column after the last non-zero one is dropped at ingest and read back
 * as zero, which is what makes the file affordable: a receiver carries about a
 * dozen numbers rather than thirty-seven. A short row is therefore normal, not
 * corrupt — see `statLine`, which is the only thing that should read one.
 */
export type ScoringWeek = number[];

export interface ScoringPlayer {
  /** Position as nflverse lists it, which is what the TE and RB bonuses key on. */
  pos: string;
  /** Team in the most recent week present. */
  team: string;
  /** Ascending by week. */
  weeks: ScoringWeek[];
}

export interface ScoringFile extends DatasetMeta {
  columns: typeof SCORING_COLUMNS;
  /** Keyed by Sleeper player id. */
  players: Record<string, ScoringPlayer>;
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
// byes.json — nflverse games, reduced to one bye week per team
// ---------------------------------------------------------------------------

/**
 * When each team is off, for the season being played.
 *
 * Keyed by **Sleeper** team code, not nflverse's, because the only thing that
 * ever reads this joins it to `Player.team`. The two vocabularies agree on 31
 * of 32 teams and disagree on the Rams — nflverse writes `LA`, Sleeper writes
 * `LAR` — so a file keyed the other way would silently never fire a bye for one
 * roster's worth of players. The translation happens once, at ingest, where it
 * can be gated; see `scripts/ingest/byeWeeks.ts`.
 *
 * A team-keyed file rather than a player-keyed one, which makes it the only
 * dataset here that needs no id crosswalk at all.
 */
export interface ByeWeeksFile extends DatasetMeta {
  /** Sleeper team code → the regular-season week that team does not play. */
  teams: Record<string, number>;
}

// ---------------------------------------------------------------------------
// index.json — what shipped, so the UI can date the data without loading it all
// ---------------------------------------------------------------------------

export interface DataIndexEntry {
  file: string;
  generatedAt: string;
  season: number;
  throughWeek: number | null;
  /**
   * Rows in the reduced file — players for the three player-keyed datasets,
   * teams for `byes.json`. Named for what it counts rather than for what it
   * counted when there was only one kind of row.
   */
  rows: number;
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
  scoring: 'scoring.json',
  depth: 'depth.json',
  byes: 'byes.json',
  index: 'index.json',
} as const;

export type DatasetName = Exclude<keyof typeof DATA_FILES, 'index'>;
