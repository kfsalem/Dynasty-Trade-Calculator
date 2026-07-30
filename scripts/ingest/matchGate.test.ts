import { describe, expect, it } from 'vitest';
import { newMatchStats, recordMatch, type MatchStats } from './crosswalk';
import { IngestError } from './errors';
import { requireMatchRates, type MatchGate } from './matchGate';

const GATE: MatchGate = {
  positions: ['QB', 'RB', 'WR', 'TE'],
  minRate: 0.9,
  minSample: 20,
  minRelevantTotal: 50,
};

interface Group {
  position: string;
  total: number;
  matched: number;
  relevant?: boolean;
}

/** Enough relevant players at every gated position to clear the global floor. */
const HEALTHY: Group[] = ['QB', 'RB', 'WR', 'TE'].map((position) => ({
  position,
  total: 30,
  matched: 30,
}));

/** `matched` of `total` at `position`, all with a role unless said otherwise. */
function stats(groups: Group[]): MatchStats {
  const result = newMatchStats();
  for (const group of groups) {
    for (let i = 0; i < group.total; i++) {
      recordMatch(result, {
        position: group.position,
        sleeperId: i < group.matched ? String(1000 + i) : undefined,
        name: `${group.position}${i}`,
        relevant: group.relevant ?? true,
        note: `${group.position}${i}`,
      });
    }
  }
  return result;
}

/** HEALTHY with one position replaced, so only the position under test varies. */
const except = (group: Group): Group[] => [
  ...HEALTHY.filter((g) => g.position !== group.position),
  group,
];

describe('requireMatchRates', () => {
  it('passes when every gated position clears the floor', () => {
    expect(() => requireMatchRates('snaps', stats(HEALTHY), GATE)).not.toThrow();
  });

  it('fails when a position drops below the floor', () => {
    const failing = stats(except({ position: 'WR', total: 100, matched: 60 }));

    expect(() => requireMatchRates('snaps', failing, GATE)).toThrowError(/WR 60\.0% \(60\/100\)/);
  });

  it('reports a quality failure, which stops the build rather than falling back', () => {
    // A fetch failure keeps the committed copy; this must not, because the data
    // is present and wrong rather than absent.
    try {
      requireMatchRates('snaps', stats(except({ position: 'WR', total: 100, matched: 10 })), GATE);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(IngestError);
      expect((err as IngestError).kind).toBe('quality');
    }
  });

  it('names examples but defers the full list to the build log', () => {
    // A real break drops hundreds; repeating them all in the exception buries
    // the rates that explain it, and the log above already has every name.
    const failing = stats(except({ position: 'TE', total: 40, matched: 20 }));

    const run = () => requireMatchRates('snaps', failing, GATE);
    expect(run).toThrowError(/20 unmatched at those positions, including TE20 \(TE, TE20\)/);
    expect(run).toThrowError(/and 8 more listed above/);
  });

  it('names only players from the positions that actually failed', () => {
    // Rows arrive grouped by team, so a healthy position is routinely recorded
    // before a broken one. Naming its players as the evidence for a TE failure
    // hands over the wrong players and double-counts the total.
    const mixed = stats([
      ...HEALTHY.filter((g) => g.position !== 'WR' && g.position !== 'TE'),
      { position: 'WR', total: 400, matched: 380 },
      { position: 'TE', total: 100, matched: 80 },
    ]);

    const run = () => requireMatchRates('snaps', mixed, GATE);
    expect(run).toThrowError(/20 unmatched at those positions/);
    expect(run).toThrowError(/including TE80 \(TE, TE80\)/);
    expect(run).not.toThrowError(/WR3\d\d/);
  });

  it('ignores players below the relevance line', () => {
    // 128 matched of 220 overall, but 100% among the players with a role. An
    // offseason depth chart looks exactly like this and must not fail a deploy.
    const offseason = stats([
      ...HEALTHY,
      { position: 'WR', total: 100, matched: 8, relevant: false },
    ]);

    expect(() => requireMatchRates('depth', offseason, GATE)).not.toThrow();
  });

  it('does not gate a position with too small a sample to mean anything', () => {
    // Two misses out of ten is 80%, under the floor, but on ten players that is
    // noise rather than evidence.
    const thin = stats(except({ position: 'TE', total: 10, matched: 8 }));

    expect(() => requireMatchRates('depth', thin, GATE)).not.toThrow();
  });

  it('fails when a gated position vanishes from the source entirely', () => {
    // A renamed position code drops every player at it. Skipping the position
    // because it has no bucket would pass the build green having lost all of
    // them — the one case where the loss is total.
    const noTightEnds = stats(HEALTHY.filter((g) => g.position !== 'TE'));

    expect(() => requireMatchRates('depth', noTightEnds, GATE)).toThrowError(
      /TE absent from the source/,
    );
  });

  it('fails when the relevance signal itself collapses', () => {
    // Relevance is derived from a source column. If depth rank switched to a
    // team-wide ordering, almost nobody would clear the bar, every position
    // would fall under minSample, and the gate would silently stop gating.
    const collapsed = stats([
      { position: 'WR', total: 5, matched: 0 },
      { position: 'RB', total: 5, matched: 0 },
      { position: 'WR', total: 900, matched: 0, relevant: false },
    ]);

    expect(() => requireMatchRates('depth', collapsed, GATE)).toThrowError(
      /only 10 players cleared the relevance bar, expected at least 50/,
    );
  });

  it('leaves ungated positions alone', () => {
    // There are about nineteen fullbacks in the league; one miss is five percent.
    const fullbacks = stats([...HEALTHY, { position: 'FB', total: 40, matched: 4 }]);

    expect(() => requireMatchRates('snaps', fullbacks, GATE)).not.toThrow();
  });

  it('lists every failing position, not just the first', () => {
    const broken = stats([
      ...HEALTHY.filter((g) => g.position !== 'WR' && g.position !== 'TE'),
      { position: 'WR', total: 100, matched: 40 },
      { position: 'TE', total: 100, matched: 50 },
    ]);

    const run = () => requireMatchRates('snaps', broken, GATE);
    expect(run).toThrowError(/WR 40\.0%/);
    expect(run).toThrowError(/TE 50\.0%/);
    expect(run).not.toThrowError(/QB/);
  });

  it('says what the failure usually means, not just that it happened', () => {
    const broken = stats(except({ position: 'WR', total: 100, matched: 0 }));

    expect(() => requireMatchRates('snaps', broken, GATE)).toThrowError(
      /id column changed format upstream/,
    );
  });
});
