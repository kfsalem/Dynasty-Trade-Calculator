import { useEffect, useRef, useState } from 'react';

/**
 * True for a moment after `value` changes — never on the first render.
 *
 * The "never on mount" half is the whole point. A flash means "this moved while
 * you were looking at it"; firing it on mount would light up every figure on
 * the panel the instant it appears, which says nothing and trains the user to
 * ignore the one that matters later.
 *
 * Compared with `Object.is`, so `undefined` → a number counts as a change. That
 * is the playoff-odds case: the figure arrives late from a worker, and its
 * appearance is exactly the event worth marking.
 *
 * Pair with the `.flash-change` class, which is what actually draws it and what
 * `prefers-reduced-motion` switches off.
 */
export function useChanged(value: unknown, ms = 1100): boolean {
  const previous = useRef(value);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    if (Object.is(previous.current, value)) return;
    previous.current = value;
    setChanged(true);
    const timer = setTimeout(() => setChanged(false), ms);
    // Clears on the next change too, so a fast series of edits re-arms the
    // flash rather than letting the first one's timer end it early.
    return () => clearTimeout(timer);
  }, [value, ms]);

  return changed;
}
