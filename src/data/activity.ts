import { fetchDataFile } from './load';
import {
  DATA_FILES,
  OPPORTUNITY_COLUMNS,
  SNAP_COLUMNS,
  type ByeWeeksFile,
  type DepthChartsFile,
  type OpportunityFile,
  type SnapCountsFile,
} from './types';

export const fetchSnapCounts = (): Promise<SnapCountsFile | null> =>
  fetchDataFile<SnapCountsFile>(DATA_FILES.snaps, SNAP_COLUMNS);

export const fetchOpportunity = (): Promise<OpportunityFile | null> =>
  fetchDataFile<OpportunityFile>(DATA_FILES.opportunity, OPPORTUNITY_COLUMNS);

export const fetchDepthCharts = (): Promise<DepthChartsFile | null> =>
  fetchDataFile<DepthChartsFile>(DATA_FILES.depth);

/**
 * Keyed by team rather than by player, hence the third argument — the shared
 * validator otherwise rejects the file for having no `players`.
 */
export const fetchByeWeeks = (): Promise<ByeWeeksFile | null> =>
  fetchDataFile<ByeWeeksFile>(DATA_FILES.byes, undefined, 'teams');
