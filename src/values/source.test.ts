import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSettings } from '../engine/testFixtures';
import { ApiError } from '../lib/http';
import { TTL } from '../lib/cache';
import type { ValueBundle } from './fantasycalc';
import { VALUE_COLUMNS } from './fantasycalcRows';
import { fantasyCalcSnapshot, loadPlayerValues, type ValueSource } from './source';

/**
 * The fallback chain (#43). What it has to get right is *which* copy a reader
 * ends up on and that it says so — a snapshot served silently is a different
 * day's market presented as today's.
 */
const NOW = Date.parse('2026-10-09T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const settings = makeSettings(['QB', 'RB'], { teamCount: 10, ppr: 1 });

const bundle = (fetchedAt: number): ValueBundle => ({
  bySleeperId: new Map(),
  rawMax: 1,
  fetchedAt,
});

const source = (id: string, result: ValueBundle | Error): ValueSource => ({
  id,
  label: 'FantasyCalc',
  fetchPlayerValues: vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  }),
});

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('loadPlayerValues', () => {
  it('uses the live source and never asks for the snapshot when it answers', async () => {
    const live = source('live', bundle(NOW - HOUR));
    const snapshot = source('snapshot', bundle(NOW - 3 * DAY));

    const values = await loadPlayerValues(settings, live, [snapshot], NOW);

    expect(values.origin).toMatchObject({ kind: 'live', sourceId: 'live', asOf: NOW - HOUR });
    expect(snapshot.fetchPlayerValues).not.toHaveBeenCalled();
  });

  it('falls back to the snapshot when the live source throws', async () => {
    const live = source('live', new ApiError('Request failed with status 503.'));
    const snapshot = source('snapshot', bundle(NOW - 3 * DAY));

    const values = await loadPlayerValues(settings, live, [snapshot], NOW);

    expect(values.origin).toMatchObject({
      kind: 'snapshot',
      sourceId: 'snapshot',
      asOf: NOW - 3 * DAY,
    });
  });

  // A changed response shape is the permanent failure #43 is about, and it
  // arrives as a thrown `ApiError` like any other.
  it('falls back on a shape error, not only on a network one', async () => {
    const live = source('live', new ApiError('Unexpected response shape'));
    const values = await loadPlayerValues(settings, live, [source('snapshot', bundle(NOW))], NOW);
    expect(values.origin.kind).toBe('snapshot');
  });

  it('prefers the snapshot to an expired browser copy that is older than it', async () => {
    // `cached()` hands back the visitor's last copy when a refresh fails. Last
    // here in August, that copy is August's.
    const live = source('live', bundle(NOW - 60 * DAY));
    const snapshot = source('snapshot', bundle(NOW - 3 * DAY));

    const values = await loadPlayerValues(settings, live, [snapshot], NOW);
    expect(values.origin).toMatchObject({ kind: 'snapshot', asOf: NOW - 3 * DAY });
  });

  it('keeps an expired browser copy that is newer than the snapshot', async () => {
    const live = source('live', bundle(NOW - 2 * DAY));
    const snapshot = source('snapshot', bundle(NOW - 6 * DAY));

    const values = await loadPlayerValues(settings, live, [snapshot], NOW);
    expect(values.origin).toMatchObject({ kind: 'cached', sourceId: 'live', asOf: NOW - 2 * DAY });
  });

  it('serves an expired browser copy when the snapshot is missing too', async () => {
    const live = source('live', bundle(NOW - 2 * DAY));
    const values = await loadPlayerValues(settings, live, [source('snapshot', new Error('404'))], NOW);
    expect(values.origin.kind).toBe('cached');
  });

  it('does not call a copy just past its expiry an outage', async () => {
    const live = source('live', bundle(NOW - TTL.VALUES - 60 * 1000));
    const values = await loadPlayerValues(settings, live, [source('snapshot', bundle(NOW))], NOW);
    expect(values.origin.kind).toBe('live');
  });

  it('throws the live error when nothing can be served', async () => {
    const live = source('live', new ApiError('Request failed with status 503.'));
    const snapshot = source('snapshot', new ApiError('Not found.'));

    await expect(loadPlayerValues(settings, live, [snapshot], NOW)).rejects.toThrow(/503/);
  });
});

describe('fantasyCalcSnapshot', () => {
  const file = (over: Record<string, unknown> = {}) => ({
    generatedAt: '2026-10-06T11:00:00.000Z',
    source: 'https://api.fantasycalc.com/values/current?x',
    columns: [...VALUE_COLUMNS],
    rawMax: 8000,
    rows: [
      ['top', 'WR', 8000, 4000, 1, 1, 0, 1],
      ['half', 'rb', 4000, 6000, 2, 1, -12, null],
    ],
    ...over,
  });

  const serve = (body: unknown) => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(
      async () => new Response(JSON.stringify(body), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('asks for the file of the league format, under the app base path', async () => {
    const fetchMock = serve(file());
    await fantasyCalcSnapshot.fetchPlayerValues(
      makeSettings(['QB', 'SUPER_FLEX'], { teamCount: 11, ppr: 0.5 }),
    );

    expect(String(fetchMock.mock.calls[0][0])).toMatch(
      /data\/values\/dynasty-2qb-10t-ppr0\.5\.json$/,
    );
  });

  it('reads the rows through the live mapping and dates them by the ingest', async () => {
    serve(file());
    const { bySleeperId, rawMax, fetchedAt } = await fantasyCalcSnapshot.fetchPlayerValues(settings);

    expect(rawMax).toBe(8000);
    expect(fetchedAt).toBe(Date.parse('2026-10-06T11:00:00.000Z'));
    expect(bySleeperId.get('top')).toMatchObject({ value: 10000, redraftValue: 5000 });
    // Redraft on the dynasty maximum, as live: 6000 of 8000, not 10000.
    expect(bySleeperId.get('half')).toMatchObject({
      position: 'RB',
      value: 5000,
      redraftValue: 7500,
      winNowValue: 7500,
      trend30Day: -12,
      tier: null,
      source: 'fantasycalc',
    });
  });

  // Rows are positional. A file from a build with another column order parses
  // cleanly and reads every figure from its neighbour.
  it('rejects a file whose columns are not the ones this build reads', async () => {
    const columns = [...VALUE_COLUMNS];
    [columns[2], columns[3]] = [columns[3], columns[2]];
    serve(file({ columns }));

    await expect(fantasyCalcSnapshot.fetchPlayerValues(settings)).rejects.toThrow(/shape/);
  });

  it('rejects a file with no usable date', async () => {
    serve(file({ generatedAt: 'yesterday' }));
    await expect(fantasyCalcSnapshot.fetchPlayerValues(settings)).rejects.toThrow(/date/);
  });
});
