import { describeUnmatched, matchRate, sampleSize, type MatchStats } from './crosswalk';
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
  /**
   * Below this many players with a role across all gated positions, fail
   * outright. Without it the gate fails open: relevance is derived from a
   * source column, so if `pos_rank` changed to a team-wide ordering, or the
   * usage columns emptied, nearly nobody would qualify, every position would
   * fall under `minSample`, and the gate would go quiet exactly when it was
   * needed.
   */
  minRelevantTotal: number;
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
  const relevant = sampleSize(stats.relevant.total);
  if (relevant < gate.minRelevantTotal) {
    throw new IngestError(
      'quality',
      `${dataset}: only ${relevant} players cleared the relevance bar, expected at ` +
        `least ${gate.minRelevantTotal}. The bar is derived from the source — snap ` +
        `share, usage, depth rank — so this means that signal broke, not that the ` +
        `league emptied. Left unchecked it would silence the match gate entirely.`,
    );
  }

  const failed: string[] = [];
  const failedPositions = new Set<string>();

  for (const position of gate.positions) {
    const counts = stats.relevant.byPosition[position];

    // A gated position missing altogether is the one case where the loss is
    // total — a renamed position code drops every player at it — so it fails
    // rather than being skipped.
    if (!counts || sampleSize(counts) === 0) {
      failed.push(`${position} absent from the source`);
      failedPositions.add(position);
      continue;
    }

    const sample = sampleSize(counts);
    if (sample < gate.minSample) continue;

    const rate = matchRate(counts);
    if (rate < gate.minRate) {
      failed.push(`${position} ${(rate * 100).toFixed(1)}% (${counts.matched}/${sample})`);
      failedPositions.add(position);
    }
  }

  if (failed.length === 0) return;

  // Only the positions that actually failed. Naming players from a position
  // that passed would hand over the wrong evidence for the number reported.
  const unmatched = stats.unmatched.filter(
    (player) => player.relevant && failedPositions.has(player.position),
  );
  const shown = unmatched.slice(0, EXAMPLES_SHOWN).map(describeUnmatched);
  const hidden = unmatched.length - shown.length;

  throw new IngestError(
    'quality',
    `${dataset}: too few players with a real role resolved to a Sleeper id — ` +
      `${failed.join(', ')}, against a ${(gate.minRate * 100).toFixed(0)}% floor. ` +
      `This usually means an id column changed format upstream rather than that ` +
      `the players are new. ${unmatched.length} unmatched at those positions` +
      `${shown.length > 0 ? `, including ${shown.join('; ')}` : ''}` +
      `${hidden > 0 ? `; and ${hidden} more listed above` : ''}.`,
  );
}
