import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

/**
 * Shared scaffolding for the tests that mount something.
 *
 * The one idea worth stating: these tests *drive* resolution order rather than
 * waiting on it. Three of the four bugs this suite exists for were ordering
 * bugs, and a test that waits for everything to settle before asserting cannot
 * see an ordering bug at all — it only ever observes the end state, which was
 * correct in every one of those cases. `deferred` is how a test holds one query
 * open while another finishes.
 */

/** A promise with its resolver, for holding a query open on purpose. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * A client with retries off and no cache shared between tests.
 *
 * Retries would turn a deliberate rejection into a multi-second wait, and a
 * shared cache would let one test's league leak into the next one's assertions.
 */
export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export function withClient(client = makeQueryClient()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

export function renderWithClient(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) {
  return render(ui, { wrapper: withClient(), ...options });
}

/**
 * Put the browser at a given URL, query string and all.
 *
 * `App` reads the shared trade at module scope, so a test that wants a
 * different link has to set the address *and* re-import the module. Callers
 * pair this with `vi.resetModules()` and a dynamic import.
 */
export function visit(url: string) {
  window.history.replaceState(null, '', url);
}
