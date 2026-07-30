/**
 * Three failure modes, of which exactly one is survivable.
 *
 * A `fetch` failure means nflverse was unreachable. It must not break a deploy:
 * the committed copy of the data is still there and still correct, just older.
 *
 * A `schema` failure means a source file changed shape, or reduced to nothing.
 * That must break the build loudly. Shipping a silently-empty dataset looks
 * exactly like a season that has not started yet, and nobody would notice for
 * weeks.
 *
 * A `quality` failure means the data parsed and reduced, but too little of it
 * resolved to a Sleeper id to trust. This is the one that catches an id format
 * changing under us — nothing throws, every file is the right shape, and the
 * app just quietly stops knowing anything about a third of its receivers.
 */
export type IngestErrorKind = 'fetch' | 'schema' | 'quality';

export class IngestError extends Error {
  // Declared explicitly rather than via constructor parameter properties, which
  // tsconfig's erasableSyntaxOnly disallows.
  readonly kind: IngestErrorKind;

  constructor(kind: IngestErrorKind, message: string) {
    super(message);
    this.name = 'IngestError';
    this.kind = kind;
  }
}
