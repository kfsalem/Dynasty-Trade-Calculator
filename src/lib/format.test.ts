import { describe, expect, it } from 'vitest';
import { formatValue } from './format';

describe('formatValue', () => {
  it('rounds and groups like a normal number', () => {
    expect(formatValue(0)).toBe('0');
    expect(formatValue(5)).toBe('5');
    expect(formatValue(1499.6)).toBe('1,500');
    expect(formatValue(43999)).toBe('43,999');
  });

  it('never renders a player worth something as worth nothing', () => {
    /**
     * The defect this exists for. The win-now scale reaches far closer to zero
     * than dynasty ever did — on a real league 25 players carried a positive
     * value under 10, and four receivers rounded to a flat `0`. The engine goes
     * to some trouble never to return zero for a ranked player (see
     * `leagueValue`), and rounding threw that away in the last three characters
     * before it reached the screen.
     */
    expect(formatValue(0.4)).toBe('~0');
    expect(formatValue(0.001)).toBe('~0');
    expect(formatValue(0.5)).toBe('1');
  });

  it('does not show a negative zero', () => {
    // `Math.round(-0.2)` is `-0`, which reads as a bug in a trade delta.
    expect(formatValue(-0.2)).toBe('0');
    expect(formatValue(-0.6)).toBe('-1');
  });
});
