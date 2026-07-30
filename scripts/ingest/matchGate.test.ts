import { describe, expect, it } from 'vitest';
import { newMatchStats, recordMatch, type MatchStats } from './crosswalk';
import { IngestError } from './errors';
import { requireMatchRates, type MatchGate } from './matchGate';

const GATE: MatchGate = { positions: ['QB', 'RB', 'WR', 'TE'], minRate: 0.9, minSample: 20 };

/** `matched` of `total` at `position`, all with a role unless said otherwise. */
function stats(
  entries: { position: string; total: number; matched: number; relevant?: boolean }[],
): MatchStats {
  const result = newMatchStats();
  for (const entry of entries) {
    for (let i = 0; i < entry.total; i++) {
      recordMatch(result, {
        position: entry.position,
        sleeperId: i < entry.matched ? String(1000 + i) : undefined,
        name: `${entry.position}${i}`,
        relevant: entry.relevant ?? true,
        note: `${entry.position}${i}`,
      });
    }
  }
  return result;
}

describe('requireMatchRates', () => {
  it('passes when every gated position clears the floor', () => {
    expect(() =>
      requireMatchRates('snaps', stats([{ position: 'WR', total: 100, matched: 98 }]), GATE),
    ).not.toThrow();
  });

  it('fails when a position drops below the floor', () => {
    expect(() =>
      requireMatchRates('snaps', stats([{ position: 'WR', total: 100, matched: 60 }]), GATE),
    ).toThrowError(/WR 60\.0% \(60\/100\)/);
  });

  it('reports a quality failure, which stops the build rather than falling back', () => {
    // A fetch failure keeps the committed copy; this must not, because the data
    // is present and wrong rather than absent.
    try {
      requireMatchRates('snaps', stats([{ position: 'WR', total: 100, matched: 10 }]), GATE);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(IngestError);
      expect((err as IngestError).kind).toBe('quality');
    }
  });

  it('names examples but defers the full list to the build log', () => {
    // A real break drops hundreds; repeating them all in the exception buries
    // the rates that explain it, and the log above already has every name.
    const failing = stats([{ position: 'TE', total: 40, matched: 20 }]);

    const run = () => requireMatchRates('snaps', failing, GATE);
    expect(run).toThrowError(/20 unmatched, including TE20 \(TE, TE20\)/);
    expect(run).toThrowError(/and 8 more listed above/);
  });

  it('ignores players below the relevance line', () => {
    // 8 of 108 overall, but every player with a role resolved. An offseason
    // depth chart looks exactly like this and must not fail a deploy.
    const offseason = stats([
      { position: 'WR', total: 100, matched: 100, relevant: true },
      { position: 'WR', total: 100, matched: 8, relevant: false },
    ]);

    expect(() => requireMatchRates('depth', offseason, GATE)).not.toThrow();
  });

  it('does not gate a position with too small a sample to mean anything', () => {
    // Two misses out of ten is 80%, under the floor, but on ten players that is
    // noise rather than evidence.
    expect(() =>
      requireMatchRates('depth', stats([{ position: 'TE', total: 10, matched: 8 }]), GATE),
    ).not.toThrow();
  });

  it('leaves ungated positions alone', () => {
    // There are about nineteen fullbacks in the league; one miss is five percent.
    expect(() =>
      requireMatchRates('snaps', stats([{ position: 'FB', total: 40, matched: 4 }]), GATE),
    ).not.toThrow();
  });

  it('lists every failing position, not just the first', () => {
    const broken = stats([
      { position: 'WR', total: 100, matched: 40 },
      { position: 'TE', total: 100, matched: 50 },
      { position: 'QB', total: 100, matched: 100 },
    ]);

    const run = () => requireMatchRates('snaps', broken, GATE);
    expect(run).toThrowError(/WR 40\.0%/);
    expect(run).toThrowError(/TE 50\.0%/);
    expect(run).not.toThrowError(/QB/);
  });

  it('says what the failure usually means, not just that it happened', () => {
    expect(() =>
      requireMatchRates('snaps', stats([{ position: 'WR', total: 100, matched: 0 }]), GATE),
    ).toThrowError(/id column changed format upstream/);
  });
});
