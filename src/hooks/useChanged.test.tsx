import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChanged } from './useChanged';

/**
 * The rules that make a flash mean something.
 *
 * All three failures this covers look identical on screen — a highlight — and
 * are opposite in what they tell the user: one marks a change, one marks a
 * component appearing, one marks nothing at all. The middle case is the one
 * that quietly ruins the feature, because a flash that fires on mount fires on
 * every figure at once and teaches people to stop looking at it.
 */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const setup = (initial: unknown) =>
  renderHook(({ value }: { value: unknown }) => useChanged(value), {
    initialProps: { value: initial },
  });

describe('useChanged', () => {
  it('stays quiet on the first render', () => {
    const { result } = setup(500);
    expect(result.current).toBe(false);
  });

  it('reports a change, then stops', () => {
    const { result, rerender } = setup(500);

    rerender({ value: 900 });
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(result.current).toBe(false);
  });

  it('ignores a re-render that did not move the value', () => {
    const { result, rerender } = setup(500);

    rerender({ value: 500 });
    expect(result.current).toBe(false);
  });

  /**
   * The playoff-odds case. The figure is computed off the main thread, so it is
   * undefined for a beat and then simply appears — an arrival is exactly the
   * event worth marking, and `Object.is` is what makes it count as one.
   */
  it('counts an arrival from undefined as a change', () => {
    const { result, rerender } = setup(undefined);

    rerender({ value: 0.51 });
    expect(result.current).toBe(true);
  });

  /**
   * A fast series of edits re-arms rather than expiring on the first timer.
   * Without the cleanup, ticking four players in quick succession leaves the
   * highlight ending a second after the *first* click, while the number is
   * still moving.
   */
  it('re-arms while edits keep arriving', () => {
    const { result, rerender } = setup(500);

    rerender({ value: 900 });
    act(() => {
      vi.advanceTimersByTime(900);
    });
    rerender({ value: 1400 });

    // The first flash's timer would have fired by now had it survived.
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current).toBe(true);
  });
});
