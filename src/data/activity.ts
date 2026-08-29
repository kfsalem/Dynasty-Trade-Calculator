import { fetchDataFile } from './load';
import {
  DATA_FILES,
  OPPORTUNITY_COLUMNS,
  SCORING_COLUMNS,
  SNAP_COLUMNS,
  type ByeWeeksFile,
  type DepthChartsFile,
  type OpportunityFile,
  type ScoringFile,
  type SnapCountsFile,
} from './types';

export const fetchSnapCounts = (): Promise<SnapCountsFile | null> =>
  fetchDataFile<SnapCountsFile>(DATA_FILES.snaps, SNAP_COLUMNS);

export const fetchOpportunity = (): Promise<OpportunityFile | null> =>
  fetchDataFile<OpportunityFile>(DATA_FILES.opportunity, OPPORTUNITY_COLUMNS);

/**
 * The stat columns a league's own scoring rules are computed from.
 *
 * Rows here are variable length — trailing zeros are trimmed at ingest — but
 * the declared `columns` array is not, so the shared column check still holds
 * the file to this build's reading of it.
 */
export const fetchScoring = (): Promise<ScoringFile | null> =>
  fetchDataFile<ScoringFile>(DATA_FILES.scoring, SCORING_COLUMNS);

export const fetchDepthCharts = (): Promise<DepthChartsFile | null> =>
  fetchDataFile<DepthChartsFile>(DATA_FILES.depth);

/**
 * Keyed by team rather than by player, hence the third argument — the shared
 * validator otherwise rejects the file for having no `players`.
 */
export const fetchByeWeeks = (): Promise<ByeWeeksFile | null> =>
  fetchDataFile<ByeWeeksFile>(DATA_FILES.byes, undefined, 'teams');
