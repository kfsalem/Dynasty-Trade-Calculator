import { describe, expect, it } from 'vitest';
import { barPath, linear, niceTicks } from './scale';

describe('linear', () => {
  it('maps the domain onto the range', () => {
    const scale = linear([0, 100], [0, 200]);
    expect(scale(0)).toBe(0);
    expect(scale(50)).toBe(100);
    expect(scale(100)).toBe(200);
  });

  it('inverts happily, which is how every y-axis is built', () => {
    // SVG y grows downward, so a y-scale runs from the bottom of the plot up.
    const y = linear([0, 10], [300, 20]);
    expect(y(0)).toBe(300);
    expect(y(10)).toBe(20);
    expect(y(5)).toBe(160);
  });

  it('clamps rather than drawing outside the plot', () => {
    const scale = linear([0, 100], [0, 200]);
    expect(scale(-50)).toBe(0);
    expect(scale(150)).toBe(200);
  });

  it('puts a degenerate domain in the middle instead of dividing by zero', () => {
    // A one-team league, or ten teams that somehow score identically.
    const scale = linear([5, 5], [0, 200]);
    expect(scale(5)).toBe(100);
    expect(Number.isFinite(scale(5))).toBe(true);
  });
});

describe('niceTicks', () => {
  it('lands on round numbers', () => {
    expect(niceTicks(0, 1000)).toEqual([0, 200, 400, 600, 800, 1000]);
  });

  it('handles a fractional domain without float noise', () => {
    // 0.1 * 3 is 0.30000000000000004, which would render as an axis label.
    expect(niceTicks(0, 1, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    for (const tick of niceTicks(0, 0.3, 3)) {
      expect(String(tick).length).toBeLessThan(6);
    }
  });

  it('covers the domain it is given', () => {
    const ticks = niceTicks(1234, 8765);
    expect(ticks[0]).toBeGreaterThanOrEqual(1234);
    expect(ticks[ticks.length - 1]).toBeLessThanOrEqual(8765);
    expect(ticks.length).toBeGreaterThan(2);
  });

  it('degrades rather than looping forever', () => {
    expect(niceTicks(5, 5)).toEqual([5]);
    expect(niceTicks(Number.NaN, 10)).toEqual([]);
    expect(niceTicks(0, Number.POSITIVE_INFINITY)).toEqual([]);
  });
});

describe('barPath', () => {
  it('starts at the baseline and closes', () => {
    const path = barPath(10, 0, 100, 12, 4, 'right');
    expect(path.startsWith('M10 0')).toBe(true);
    expect(path.endsWith('Z')).toBe(true);
  });

  it('mirrors for a bar growing left', () => {
    // A diverging bar's left half is measured from the same centre line, so it
    // has to start at the far edge and round the other end.
    const path = barPath(10, 0, 100, 12, 4, 'left');
    expect(path.startsWith('M110 0')).toBe(true);
  });

  it('degrades to a rectangle rather than a lens on a tiny bar', () => {
    // A 2px bar with a 4px corner radius has no straight edge left to draw.
    const path = barPath(0, 0, 2, 12, 4, 'right');
    expect(path).not.toContain('a4 4');
    expect(path.endsWith('Z')).toBe(true);
  });

  it('draws nothing wide for a zero value, without going negative', () => {
    const path = barPath(0, 0, -5, 12, 4, 'right');
    expect(path).toBe('M0 0h0v12h0Z');
  });

  it('never rounds more than the bar is tall', () => {
    // Radius is capped at half the height, so a thin bar stays a bar.
    const path = barPath(0, 0, 100, 4, 8, 'right');
    expect(path).toContain('a2 2');
  });
});
