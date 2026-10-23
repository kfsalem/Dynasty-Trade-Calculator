import { describe, expect, it } from 'vitest';
import type { LeagueBundle, PlayerProjection } from '../platforms/types';
import { withFreshInjuries } from './freshInjuries';
import { makePlayer } from './testFixtures';

const OUT = { status: 'out', description: 'Out' } as const;
const Q = { status: 'questionable', description: 'Questionable' } as const;

const bundle = (...players: ReturnType<typeof makePlayer>[]) =>
  ({
    players: new Map(players.map((p) => [p.id, p])),
    freeAgents: new Map([['fa', makePlayer('fa', 'WR')]]),
  }) as unknown as LeagueBundle;

const week = (rows: Record<string, PlayerProjection['injury']>) =>
  new Map(
    Object.entries(rows).map(([id, injury]) => [
      id,
      { opponent: 'LV', stats: {}, ...(injury !== undefined && { injury }) },
    ]),
  );

describe('withFreshInjuries (#184)', () => {
  it('rules a man out who the day-old index still has healthy', () => {
    const fresh = withFreshInjuries(bundle(makePlayer('a', 'QB')), week({ a: OUT }));

    expect(fresh?.players.get('a')?.injury).toEqual(OUT);
  });

  it('clears a designation that has lifted', () => {
    const fresh = withFreshInjuries(bundle(makePlayer('a', 'QB', 25, Q)), week({ a: null }));

    expect(fresh?.players.get('a')?.injury).toBeUndefined();
  });

  it('freshens free agents too, so the wire cannot offer a man who is out', () => {
    const fresh = withFreshInjuries(bundle(), week({ fa: OUT }));

    expect(fresh?.freeAgents.get('fa')?.injury).toEqual(OUT);
  });

  it('keeps the index where the projection says nothing, or the man has no projection', () => {
    const given = bundle(makePlayer('a', 'QB', 25, Q), makePlayer('b', 'RB', 25, Q));
    const fresh = withFreshInjuries(given, week({ a: undefined }));

    expect(fresh?.players.get('a')?.injury).toEqual(Q);
    expect(fresh?.players.get('b')?.injury).toEqual(Q);
  });

  it('hands back the same bundle when nothing differs, so nothing recomputes', () => {
    const given = bundle(makePlayer('a', 'QB', 25, Q), makePlayer('b', 'RB'));

    expect(withFreshInjuries(given, week({ a: Q, b: null }))).toBe(given);
    expect(withFreshInjuries(given, undefined)).toBe(given);
  });

  it('leaves the bundle it was given unchanged', () => {
    const given = bundle(makePlayer('a', 'QB'));
    withFreshInjuries(given, week({ a: OUT }));

    expect(given.players.get('a')?.injury).toBeUndefined();
  });
});
