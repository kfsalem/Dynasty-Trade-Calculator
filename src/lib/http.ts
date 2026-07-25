import type { ZodType } from 'zod';

export class ApiError extends Error {
  // Declared explicitly rather than via constructor parameter properties, which
  // tsconfig's erasableSyntaxOnly disallows.
  readonly status?: number;
  readonly url?: string;

  constructor(message: string, status?: number, url?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.url = url;
  }
}

/**
 * Fetch JSON and validate it against a schema.
 *
 * Every upstream here is third-party and, in FantasyCalc's case, undocumented.
 * Validating at the boundary means a shape change surfaces as one clear error
 * naming the endpoint, instead of an `undefined` that only explodes three
 * layers deep in the valuation code.
 */
export async function fetchJson<T>(
  url: string,
  schema: ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError('Network request failed. Check your connection.', undefined, url);
  }

  if (!res.ok) {
    throw new ApiError(
      res.status === 404
        ? 'Not found. Double-check the ID.'
        : `Request failed with status ${res.status}.`,
      res.status,
      url,
    );
  }

  const body: unknown = await res.json();
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ApiError(
      `Unexpected response shape from ${url}: ${issue?.path.join('.') || '(root)'} — ${issue?.message ?? 'validation failed'}`,
      res.status,
      url,
    );
  }

  return parsed.data;
}
