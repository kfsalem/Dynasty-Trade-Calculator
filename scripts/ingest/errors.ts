/**
 * Two failure modes, deliberately distinguished.
 *
 * A `fetch` failure means nflverse was unreachable. It must not break a deploy:
 * the committed copy of the data is still there and still correct, just older.
 *
 * A `schema` failure means a source file changed shape, or reduced to nothing.
 * That must break the build loudly. Shipping a silently-empty dataset looks
 * exactly like a season that has not started yet, and nobody would notice for
 * weeks.
 */
export class IngestError extends Error {
  // Declared explicitly rather than via constructor parameter properties, which
  // tsconfig's erasableSyntaxOnly disallows.
  readonly kind: 'fetch' | 'schema';

  constructor(kind: 'fetch' | 'schema', message: string) {
    super(message);
    this.name = 'IngestError';
    this.kind = kind;
  }
}
