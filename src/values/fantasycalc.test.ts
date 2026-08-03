import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeagueSettings } from '../types';

/**
 * The value source the whole app rests on, and until now the only one of the
 * two under `values/` without tests.
 *
 * `cached` is passed through rather than exercised — it has its own tests, and
 * leaving it in would mean every case here also depended on IndexedDB.
 */
vi.mock('../lib/http', () => ({ fetchJson: vi.fn() }));
vi.mock('../lib/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/cache')>()),
  cached: vi.fn(async (_key: string, _ttl: number, fetcher: () => Promise<unknown>) =>
    fetcher(),
  ),
}));

import { fetchJson } from '../lib/http';
import { cached } from '../lib/cache';
import { fetchFantasyCalcValues } from './fantasycalc';

const settings = (overrides: Partial<LeagueSettings> = {}): LeagueSettings => ({
  isDynasty: true,
  teamCount: 12,
  ppr: 1,
  numQbs: 1,
  startingSlots: ['QB', 'RB'],
  allSlots: ['QB', 'RB', 'BN'],
  taxiSlots: 0,
  reserveSlots: 0,
  draftRounds: 4,
  ...overrides,
});

const row = (over: Record<string, unknown> = {}) => ({
  player: { id: 1, name: 'A Player', position: 'rb', sleeperId: 'p1' },
  value: 1000,
  redraftValue: 500,
  overallRank: 1,
  positionRank: 1,
  trend30Day: 0,
  maybeTier: 1,
  ...over,
});

const urlOf = () => vi.mocked(fetchJson).mock.calls[0][0];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchFantasyCalcValues — the request', () => {
  it('passes the league format straight through when it is supported', async () => {
    vi.mocked(fetchJson).mockResolvedValue([row()]);
    await fetchFantasyCalcValues(settings({ teamCount: 12, ppr: 1, numQbs: 2 }));

    expect(urlOf()).toContain('numTeams=12');
    expect(urlOf()).toContain('ppr=1');
    expect(urlOf()).toContain('numQbs=2');
    expect(urlOf()).toContain('isDynasty=true');
  });

  it('snaps an unsupported league size to the nearest one published', async () => {
    // FantasyCalc publishes 8/10/12/14/16. An 11-team league is real and has to
    // be priced as something.
    vi.mocked(fetchJson).mockResolvedValue([row()]);
    await fetchFantasyCalcValues(settings({ teamCount: 11, ppr: 0.75 }));

    expect(urlOf()).toContain('numTeams=10');
    expect(urlOf()).toContain('ppr=0.5');
  });

  it('keys the cache on the format, so two leagues do not share a table', async () => {
    vi.mocked(fetchJson).mockResolvedValue([row()]);
    await fetchFantasyCalcValues(settings({ numQbs: 1 }));
    await fetchFantasyCalcValues(settings({ numQbs: 2 }));

    const [first, second] = vi.mocked(cached).mock.calls.map((c) => c[0]);
    expect(first).not.toBe(second);
  });
});

describe('fetchFantasyCalcValues — the mapping', () => {
  it('normalizes onto a 0-10000 scale topped by the most valuable player', async () => {
    vi.mocked(fetchJson).mockResolvedValue([
      row({ player: { id: 1, name: 'Top', position: 'WR', sleeperId: 'top' }, value: 8000 }),
      row({ player: { id: 2, name: 'Half', position: 'WR', sleeperId: 'half' }, value: 4000 }),
    ]);

    const { bySleeperId, rawMax } = await fetchFantasyCalcValues(settings());

    expect(rawMax).toBe(8000);
    expect(bySleeperId.get('top')!.value).toBe(10000);
    expect(bySleeperId.get('half')!.value).toBe(5000);
  });

  /**
   * The invariant that makes the two scales comparable.
   *
   * Redraft is divided by the *dynasty* maximum, not by a redraft maximum of
   * its own. Give each its own divisor and both run 0-10000, at which point a
   * player's dynasty and win-now figures can no longer be compared — which is
   * the one property the win-now split needs from them.
   */
  it('divides redraft by the dynasty maximum, not by its own', async () => {
    vi.mocked(fetchJson).mockResolvedValue([
      row({
        player: { id: 1, name: 'Young', position: 'WR', sleeperId: 'young' },
        value: 10000,
        redraftValue: 5000,
      }),
      row({
        player: { id: 2, name: 'Old', position: 'RB', sleeperId: 'old' },
        value: 2000,
        redraftValue: 4000,
      }),
    ]);

    const { bySleeperId } = await fetchFantasyCalcValues(settings());

    // The best redraft asset here is worth 4000 raw, and must NOT come back as
    // 10000 — that would mean an ageing back outranks a franchise receiver on a
    // scale they are supposed to share.
    expect(bySleeperId.get('old')!.redraftValue).toBe(4000);
    expect(bySleeperId.get('young')!.redraftValue).toBe(5000);
    expect(bySleeperId.get('young')!.redraftValue).toBeGreaterThan(
      bySleeperId.get('old')!.redraftValue,
    );
  });

  it('starts win-now equal to redraft, before any league adjustment', async () => {
    vi.mocked(fetchJson).mockResolvedValue([row({ value: 1000, redraftValue: 400 })]);
    const { bySleeperId } = await fetchFantasyCalcValues(settings());
    const v = bySleeperId.get('p1')!;
    expect(v.winNowValue).toBe(v.redraftValue);
  });

  it('drops a player with no Sleeper id rather than keying on undefined', async () => {
    vi.mocked(fetchJson).mockResolvedValue([
      row({ player: { id: 1, name: 'Unmatched', position: 'WR', sleeperId: null } }),
      row(),
    ]);

    const { bySleeperId } = await fetchFantasyCalcValues(settings());
    expect(bySleeperId.size).toBe(1);
    expect(bySleeperId.has('p1')).toBe(true);
  });

  it('uppercases the position and rejects anything it does not price', async () => {
    vi.mocked(fetchJson).mockResolvedValue([
      row({ player: { id: 1, name: 'Back', position: 'rb', sleeperId: 'rb' } }),
      row({ player: { id: 2, name: 'Punter', position: 'P', sleeperId: 'p' } }),
    ]);

    const { bySleeperId } = await fetchFantasyCalcValues(settings());
    expect(bySleeperId.get('rb')!.position).toBe('RB');
    expect(bySleeperId.get('p')!.position).toBeNull();
  });

  it('fills the optional columns rather than propagating undefined', async () => {
    vi.mocked(fetchJson).mockResolvedValue([
      row({ redraftValue: null, positionRank: null, trend30Day: null, maybeTier: null }),
    ]);

    const v = (await fetchFantasyCalcValues(settings())).bySleeperId.get('p1')!;
    expect(v.redraftValue).toBe(0);
    expect(v.positionRank).toBe(0);
    expect(v.trend30Day).toBe(0);
    expect(v.tier).toBeNull();
    expect(v.source).toBe('fantasycalc');
  });

  it('survives an empty table without dividing by zero', async () => {
    vi.mocked(fetchJson).mockResolvedValue([]);
    const { bySleeperId, rawMax } = await fetchFantasyCalcValues(settings());
    expect(bySleeperId.size).toBe(0);
    expect(rawMax).toBe(1);
  });
});
