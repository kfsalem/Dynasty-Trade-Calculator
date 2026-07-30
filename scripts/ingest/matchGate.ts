import { matchRate, sampleSize, type MatchStats } from './crosswalk';
import { IngestError } from './errors';

/** Names in the exception. The build log above it carries the complete list. */
const EXAMPLES_SHOWN = 12;

export interface MatchGate {
  /**
   * Positions the gate covers. FB is deliberately outside it: there are about
   * nineteen in the league, so one miss is five percent and the gate would be
   * measuring noise.
   */
  positions: readonly string[];
  /** Share of players-with-a-role that must resolve to a Sleeper id. */
  minRate: number;
  /**
   * Below this many players at a position, report the rate but do not gate on
   * it. Small denominators swing too hard to fail a deploy over.
   */
  minSample: number;
}

/**
 * Fail the build when too few players with a real role resolve to a Sleeper id.
 *
 * This is the check that catches the failure nothing else does. If an id format
 * changes upstream, every file still arrives, every column is still present,
 * every reduction still produces thousands of rows — and the app simply stops
 * knowing anything about the players it dropped. There is no exception to
 * notice, which is exactly why it needs a number.
 */
export function requireMatchRates(dataset: string, stats: MatchStats, gate: MatchGate): void {
  const failures: string[] = [];

  for (const position of gate.positions) {
    const counts = stats.relevant.byPosition[position];
    if (!counts) continue;

    const sample = sampleSize(counts);
    if (sample < gate.minSample) continue;

    const rate = matchRate(counts);
    if (rate < gate.minRate) {
      failures.push(
        `${position} ${(rate * 100).toFixed(1)}% (${counts.matched}/${sample})`,
      );
    }
  }

  if (failures.length === 0) return;

  // A sample, not the full list. Every unmatched player is already named in the
  // build log directly above this; a real break drops hundreds, and repeating
  // them all in the exception buries the rates that explain it.
  const unmatched = stats.unmatched.filter(
    (player) => player.relevant && gate.positions.includes(player.position),
  );
  const shown = unmatched
    .slice(0, EXAMPLES_SHOWN)
    .map((player) => `${player.name} (${player.position}, ${player.note})`);
  const hidden = unmatched.length - shown.length;

  throw new IngestError(
    'quality',
    `${dataset}: too few players with a real role resolved to a Sleeper id — ` +
      `${failures.join(', ')}, against a ${(gate.minRate * 100).toFixed(0)}% floor. ` +
      `This usually means an id column changed format upstream rather than that ` +
      `the players are new. ${unmatched.length} unmatched, including ` +
      `${shown.join('; ')}${hidden > 0 ? `; and ${hidden} more listed above` : ''}.`,
  );
}
