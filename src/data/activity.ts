import { fetchDataFile } from './load';
import {
  DATA_FILES,
  OPPORTUNITY_COLUMNS,
  SNAP_COLUMNS,
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
