import { describe, expect, it } from 'vitest';
import { num, requireColumns, requireRows, round } from './columns';
import { IngestError } from './errors';

describe('requireColumns', () => {
  it('passes a row through when every column is present', () => {
    const row = { week: '1', wopr: '0.7' };
    expect(requireColumns('stats', row, ['week', 'wopr'])).toBe(row);
  });

  it('names the missing columns and what was there instead', () => {
    // The point of this message is that whoever reads the failed build can
    // diff it against the source without opening an 8 MB CSV.
    expect(() => requireColumns('stats', { week: '1', target_pct: '0.3' }, ['week', 'target_share']))
      .toThrowError(
        'stats: source is missing column target_share. Columns present: week, target_pct.',
      );
  });

  it('reports schema drift, not a fetch failure, so the build stops', () => {
    try {
      requireColumns('stats', { week: '1' }, ['wopr']);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(IngestError);
      expect((err as IngestError).kind).toBe('schema');
    }
  });

  it('treats a file with no rows as drift rather than an empty result', () => {
    expect(() => requireColumns('stats', undefined, ['week'])).toThrowError(
      /stats: source has no data rows\. Expected columns: week\./,
    );
  });
});

describe('requireRows', () => {
  it('accepts a reduction at or above the floor', () => {
    expect(() => requireRows('snaps', 300, 300)).not.toThrow();
  });

  it('fails when a reduction collapses to almost nothing', () => {
    expect(() => requireRows('snaps', 4, 300)).toThrowError(
      /snaps: reduced to 4 players, expected at least 300/,
    );
  });
});

describe('num', () => {
  it('reads NA, blank and absent as missing rather than zero', () => {
    expect(num('NA')).toBeNull();
    expect(num('')).toBeNull();
    expect(num(undefined)).toBeNull();
  });

  it('reads real numbers, including zero', () => {
    expect(num('0')).toBe(0);
    expect(num('0.3721')).toBe(0.3721);
    expect(num('-1.5')).toBe(-1.5);
  });

  it('rejects anything non-numeric instead of returning NaN', () => {
    expect(num('QB')).toBeNull();
  });
});

describe('round', () => {
  it('trims float noise to the requested places', () => {
    expect(round(0.8666666666666667, 3)).toBe(0.867);
    expect(round(36.499999999, 2)).toBe(36.5);
  });

  it('leaves a missing value missing', () => {
    expect(round(null, 3)).toBeNull();
  });
});
