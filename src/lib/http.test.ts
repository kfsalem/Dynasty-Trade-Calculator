import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, fetchJson } from './http';

/**
 * The point of this module is that every boundary failure arrives as one
 * legible `ApiError` naming the endpoint, rather than as whatever the platform
 * happened to throw. These tests are mostly about that promise holding on the
 * paths nobody plans for.
 */

const schema = z.object({ id: z.number() });
const URL = 'https://example.test/thing';

const respond = (body: unknown, init: { ok?: boolean; status?: number } = {}) => ({
  ok: init.ok ?? true,
  status: init.status ?? 200,
  json: async () => body,
});

/** The rejection, typed. `.catch(e => e)` widens to a union of it and the body. */
async function failure(): Promise<ApiError> {
  try {
    await fetchJson(URL, schema);
  } catch (err) {
    return err as ApiError;
  }
  throw new Error('expected fetchJson to reject, but it resolved');
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchJson', () => {
  it('returns the parsed body when the response matches the schema', async () => {
    vi.mocked(fetch).mockResolvedValue(respond({ id: 7 }) as unknown as Response);
    expect(await fetchJson(URL, schema)).toEqual({ id: 7 });
  });

  it('turns a network failure into an ApiError rather than a TypeError', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(fetchJson(URL, schema)).rejects.toThrow(ApiError);
    await expect(fetchJson(URL, schema)).rejects.toThrow(/check your connection/i);
  });

  it('says the id is wrong on a 404, because that is what a 404 means here', async () => {
    vi.mocked(fetch).mockResolvedValue(
      respond(null, { ok: false, status: 404 }) as unknown as Response,
    );

    await expect(fetchJson(URL, schema)).rejects.toThrow(/double-check the id/i);
  });

  it('carries the status and url on the error for anything else', async () => {
    vi.mocked(fetch).mockResolvedValue(
      respond(null, { ok: false, status: 503 }) as unknown as Response,
    );

    const err = await failure();
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(503);
    expect(err.url).toBe(URL);
  });

  /**
   * A 200 is not a promise of JSON. Captive portals, proxies and error pages
   * all answer 200 with HTML, and an unguarded `res.json()` surfaced a raw
   * `SyntaxError` — the user was shown `Unexpected token '<'`.
   */
  it('reports a non-JSON body as an ApiError naming the endpoint', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token '<', \"<!DOCTYPE\"... is not valid JSON");
      },
    } as unknown as Response);

    const err = await failure();
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toContain(URL);
    expect(err.message).toMatch(/not JSON/i);
  });

  it('names the offending field when the shape has drifted', async () => {
    // The reason the schemas exist: a shape change should say what changed,
    // not surface three layers deep as an undefined.
    vi.mocked(fetch).mockResolvedValue(
      respond({ id: 'seven' }) as unknown as Response,
    );

    const err = await failure();
    expect(err.message).toContain('id');
    expect(err.message).toContain(URL);
  });
});
