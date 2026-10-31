import { describe, expect, it } from 'vitest';
import { MAX_CHANGES, changesSince, type VisitSnapshot } from './sinceLastVisit';

const snap = (over: Partial<VisitSnapshot> = {}): VisitSnapshot => ({
  version: 1,
  at: '2026-10-24T12:00:00.000Z',
  rosterId: 1,
  players: {
    a: { market: 4000, role: 'starter' },
    b: { market: 2000, role: 'rotational' },
    c: { market: 600, role: 'backup' },
  },
  nowRank: 5,
  laterRank: 5,
  teamCount: 12,
  ...over,
});

const name = (id: string) => `Player ${id}`;

describe('changesSince', () => {
  it('says nothing on a first visit', () => {
    expect(changesSince(null, snap(), name)).toEqual([]);
  });

  it('says nothing when nothing crossed a threshold', () => {
    const now = snap({
      players: {
        a: { market: 4400, role: 'starter' }, // +10%: under the share
        b: { market: 2300, role: 'rotational' }, // +15% but only 300 points
        c: { market: 900, role: 'backup' }, // +50% but only 300 points
      },
      nowRank: 4, // one place is a photo finish
    });
    expect(changesSince(snap(), now, name)).toEqual([]);
  });

  it('reports a value move that clears both the share and the points', () => {
    const now = snap({ players: { ...snap().players, a: { market: 3200, role: 'starter' } } });
    expect(changesSince(snap(), now, name)).toEqual([
      expect.objectContaining({
        kind: 'value',
        playerId: 'a',
        direction: 'down',
        text: "Player a's value fell 20%, 4,000 to 3,200.",
      }),
    ]);
  });

  it('reports a role only when it crosses into or out of starting', () => {
    const now = snap({
      players: {
        a: { market: 4000, role: 'rotational' },
        b: { market: 2000, role: 'starter' },
        c: { market: 600, role: 'inactive' }, // backup to inactive: not the line that matters
      },
    });
    const changes = changesSince(snap(), now, name);
    expect(changes.map((c) => [c.kind, c.playerId, c.direction])).toEqual([
      ['role', 'a', 'down'],
      ['role', 'b', 'up'],
    ]);
  });

  it('reports a rank that moved two places or more, up meaning better', () => {
    const changes = changesSince(snap(), snap({ nowRank: 2, laterRank: 8 }), name);
    expect(changes.map((c) => c.text)).toEqual([
      'Your win-now rank went from 5th to 2nd of 12.',
      'Your dynasty rank went from 5th to 8th of 12.',
    ]);
    expect(changes.map((c) => c.direction)).toEqual(['up', 'down']);
  });

  it('leads with roles, then ranks, then the largest value moves, and stops at three', () => {
    const now = snap({
      players: {
        a: { market: 6000, role: 'starter' }, // +50%
        b: { market: 1000, role: 'starter' }, // role up, and -50%
        c: { market: 600, role: 'backup' },
      },
      nowRank: 1,
    });
    const changes = changesSince(snap(), now, name);
    expect(changes).toHaveLength(MAX_CHANGES);
    expect(changes.map((c) => c.key)).toEqual(['role:b', 'grade:now', 'value:a']);
  });

  it('ignores players who joined or left, a different team, and a different league size', () => {
    const joined = snap({ players: { ...snap().players, d: { market: 9000, role: 'starter' } } });
    expect(changesSince(snap(), joined, name)).toEqual([]);
    expect(changesSince(snap(), snap({ rosterId: 2, nowRank: 1 }), name)).toEqual([]);
    expect(changesSince(snap(), snap({ teamCount: 14, nowRank: 1 }), name)).toEqual([]);
  });

  it('skips a role it did not know last time', () => {
    const before = snap({ players: { a: { market: 4000, role: null } } });
    const now = snap({ players: { a: { market: 4000, role: 'starter' } } });
    expect(changesSince(before, now, name)).toEqual([]);
  });
});
