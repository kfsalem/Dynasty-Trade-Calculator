import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLeague, getMatchups } from './client';
import { isSampleId, resetSample } from './sample';

const LEAGUE = {
  league_id: 'sample',
  name: 'Sample League',
  season: '2026',
  status: 'in_season',
  total_rosters: 10,
  roster_positions: ['QB'],
};

describe('the sample league', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    resetSample();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const serve = (responses: Record<string, unknown>) =>
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ generatedAt: '', season: '2026', responses })),
    );

  it('recognises its own ids and no real ones', () => {
    expect(isSampleId('sample')).toBe(true);
    expect(isSampleId('sample-2')).toBe(true);
    expect(isSampleId('sample-draft-1')).toBe(true);
    expect(isSampleId('1336802780030988288')).toBe(false);
  });

  it('answers league endpoints from the recording, never from Sleeper', async () => {
    serve({ '/league/sample': LEAGUE });
    expect((await getLeague('sample')).name).toBe('Sample League');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/data\/sample\/league\.json$/);
  });

  it('downloads the recording once for every endpoint', async () => {
    serve({ '/league/sample': LEAGUE, '/league/sample/matchups/1': [] });
    await getLeague('sample');
    await getMatchups('sample', 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('answers an unrecorded path as Sleeper answers an unknown league', async () => {
    serve({});
    await expect(getMatchups('sample', 9)).rejects.toMatchObject({ status: 404 });
  });

  it('validates a recorded response like a live one', async () => {
    serve({ '/league/sample': { league_id: 'sample' } });
    await expect(getLeague('sample')).rejects.toThrow(/no longer matches/);
  });

  it('asks again after a failed download', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await expect(getLeague('sample')).rejects.toThrow(/could not be loaded/);
    serve({ '/league/sample': LEAGUE });
    expect((await getLeague('sample')).season).toBe('2026');
  });
});
