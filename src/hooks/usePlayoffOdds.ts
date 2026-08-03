import { useEffect, useRef, useState } from 'react';
import { simulate, type OddsInput } from '../engine/playoffOdds';
import type { OddsReply, OddsRequest } from '../workers/playoffOdds.worker';

/**
 * Playoff odds for a scenario, computed off the main thread.
 *
 * Pass `null` to ask nothing — no schedule, no known week, or a season already
 * over. The hook then reports no odds rather than a guess, which is the honest
 * answer and the one the UI needs in order to say nothing at all.
 */
export interface PlayoffOdds {
  /** Roster id to probability, 0-1. Null until an answer exists. */
  odds: Map<number, number> | null;
  /** A simulation is in flight. The previous answer stays on screen meanwhile. */
  pending: boolean;
}

/**
 * The input, reduced to a value that changes exactly when the answer would.
 *
 * Serialised rather than compared by reference on purpose. The caller builds
 * this object from several memos, and one of them slipping its dependencies
 * would otherwise fire a simulation on every render forever — the same failure
 * that made the builder's `onChange` need a stable identity, in a place where
 * it would cost far more. A few microseconds of `JSON.stringify` buys immunity
 * from a whole class of bug.
 */
const signatureOf = (input: OddsInput | null): string | null =>
  input === null ? null : JSON.stringify(input);

export function usePlayoffOdds(input: OddsInput | null): PlayoffOdds {
  const [odds, setOdds] = useState<Map<number, number> | null>(null);
  const [pending, setPending] = useState(false);

  const worker = useRef<Worker | null>(null);
  const latest = useRef(0);

  // Read inside the effect below, which depends on the signature rather than on
  // the object — so the object itself must not be a dependency.
  const current = useRef(input);
  current.current = input;

  useEffect(() => {
    // No `Worker` means jsdom, or a browser old enough that the app has larger
    // problems. Falling back to the main thread keeps the feature working
    // rather than silently blank; it is slower, which is the whole reason the
    // worker exists, and still better than nothing.
    if (typeof Worker === 'undefined') return;

    const instance = new Worker(
      new URL('../workers/playoffOdds.worker.ts', import.meta.url),
      { type: 'module' },
    );

    instance.onmessage = (event: MessageEvent<OddsReply>) => {
      // A reply for a scenario the user has already edited past is worse than
      // no reply: it would show odds for a trade that is no longer on screen.
      if (event.data.id !== latest.current) return;
      setOdds(new Map(event.data.odds.map((o) => [o.rosterId, o.odds])));
      setPending(false);
    };

    worker.current = instance;
    return () => {
      instance.terminate();
      worker.current = null;
    };
  }, []);

  const signature = signatureOf(input);

  useEffect(() => {
    const scenario = current.current;
    if (!scenario) {
      setOdds(null);
      setPending(false);
      return;
    }

    const id = latest.current + 1;
    latest.current = id;

    if (!worker.current) {
      // Main-thread fallback. Synchronous, so nothing to correlate.
      setOdds(new Map(simulate(scenario).map((o) => [o.rosterId, o.odds])));
      setPending(false);
      return;
    }

    setPending(true);
    worker.current.postMessage({ id, input: scenario } satisfies OddsRequest);
  }, [signature]);

  return { odds, pending };
}
