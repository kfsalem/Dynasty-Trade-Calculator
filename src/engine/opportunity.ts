import {
  OPPORTUNITY_COLUMNS,
  type OpportunityFile,
  type OpportunityPlayer,
} from '../data/types';
import { summarize, type MetricWindow, type Sample } from './activity';

export type MetricKey = 'targetShare' | 'airYardsShare' | 'wopr' | 'carryShare';

export interface Metric {
  key: MetricKey;
  label: string;
  window: MetricWindow;
  /**
   * How to read the number. WOPR is not a share and runs past 1 — it is
   * `1.5 × target share + 0.7 × air yards share` — so rendering it as a
   * percentage would invent receivers with 120% of their team's work.
   */
  kind: 'share' | 'index';
}

export interface Opportunity {
  pos: string;
  /** Position-appropriate metrics, most telling first. Never empty. */
  metrics: Metric[];
  /** The one to show when there is room for a single number. */
  headline: Metric;
}

const LABELS: Record<MetricKey, string> = {
  targetShare: 'Target share',
  airYardsShare: 'Air yards share',
  wopr: 'WOPR',
  carryShare: 'Carry share',
};

const KINDS: Record<MetricKey, Metric['kind']> = {
  targetShare: 'share',
  airYardsShare: 'share',
  wopr: 'index',
  carryShare: 'share',
};

/**
 * Which signals mean anything at which position, most telling first.
 *
 * Air yards share is a receiving concept and says nothing about a running
 * back — a back with two downfield targets a year would read as a nonentity on
 * a metric that was never about him. So backs get carry share, and target share
 * alongside it: receiving backs hold value in PPR that carry share alone
 * misses, which is exactly the kind of player this feature exists to find.
 *
 * Quarterbacks get nothing here. A quarterback's opportunity is his snap count,
 * which the snap column already shows; target share and carry share describe
 * the players he throws to.
 */
const POSITION_METRICS: Record<string, MetricKey[]> = {
  WR: ['targetShare', 'airYardsShare', 'wopr'],
  TE: ['targetShare', 'airYardsShare', 'wopr'],
  RB: ['carryShare', 'targetShare'],
  FB: ['carryShare', 'targetShare'],
  QB: [],
};

const INDEX = Object.fromEntries(
  OPPORTUNITY_COLUMNS.map((column, i) => [column, i]),
) as Record<(typeof OPPORTUNITY_COLUMNS)[number], number>;

const COLUMN: Record<MetricKey, number> = {
  targetShare: INDEX.targetShare,
  airYardsShare: INDEX.airYardsShare,
  wopr: INDEX.wopr,
  carryShare: INDEX.carryShare,
};

export function opportunity(
  player: OpportunityPlayer,
  throughWeek: number,
): Opportunity | null {
  const keys = POSITION_METRICS[player.pos] ?? [];
  if (keys.length === 0) return null;

  const metrics: Metric[] = [];

  for (const key of keys) {
    const samples: Sample[] = player.weeks.map((week) => ({
      week: week[INDEX.week] as number,
      value: week[COLUMN[key]] as number | null,
    }));

    const window = summarize(samples, throughWeek);
    if (window) metrics.push({ key, label: LABELS[key], window, kind: KINDS[key] });
  }

  const headline = metrics[0];
  if (!headline) return null;

  return { pos: player.pos, metrics, headline };
}

export function opportunities(file: OpportunityFile): Map<string, Opportunity> {
  const result = new Map<string, Opportunity>();

  for (const [sleeperId, player] of Object.entries(file.players)) {
    const derived = opportunity(player, file.throughWeek ?? 0);
    if (derived) result.set(sleeperId, derived);
  }

  return result;
}
