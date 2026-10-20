import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ValuesBadge } from './ValuesBadge';
import { valuesBadge, valuesLine, valuesSizeLine } from '../lib/valuesText';
import type { ValueOrigin } from '../values/source';

// Midday UTC, so the calendar date is the same in every timezone a test runs in.
const AS_OF = Date.parse('2026-10-06T12:00:00Z');
const NOW = Date.parse('2026-10-09T12:00:00Z');

const origin = (over: Partial<ValueOrigin> = {}): ValueOrigin => ({
  kind: 'snapshot',
  sourceId: 'fantasycalc-snapshot',
  label: 'FantasyCalc',
  asOf: AS_OF,
  ...over,
});

/**
 * The fallback must not be invisible (#43): values from another day are
 * different numbers, and the reader has to be able to find that out.
 */
describe('valuesBadge', () => {
  it('says nothing while the values are live', () => {
    expect(valuesBadge(origin({ kind: 'live' }), NOW)).toBeNull();
    expect(valuesBadge(undefined, NOW)).toBeNull();
  });

  it('dates a saved copy and says how old it is', () => {
    const badge = valuesBadge(origin(), NOW)!;
    expect(badge.label).toBe('Values from Oct 6');
    expect(badge.detail).toMatch(/FantasyCalc could not be reached/);
    expect(badge.detail).toMatch(/this app last saved them, on October 6, 2026 \(3 days ago\)/);
  });

  it('tells a browser copy from the saved one', () => {
    const badge = valuesBadge(origin({ kind: 'cached', sourceId: 'fantasycalc' }), NOW)!;
    expect(badge.detail).toMatch(/this browser last fetched, on October 6, 2026/);
  });

  it('does not call a copy from this morning days old', () => {
    expect(valuesBadge(origin({ asOf: NOW - 60 * 60 * 1000 }), NOW)!.detail).toMatch(
      /earlier today/,
    );
  });
});

describe('valuesSizeLine', () => {
  it('says nothing for a size FantasyCalc publishes', () => {
    expect(valuesSizeLine(12)).toBeNull();
    expect(valuesSizeLine(14)).toBeNull();
  });

  it('names the size a league is priced as when it differs (#156)', () => {
    expect(valuesSizeLine(16)).toBe(
      'FantasyCalc publishes no 16-team values, so players are priced as in a 14-team league.',
    );
    expect(valuesSizeLine(11)).toMatch(/as in a 10-team league/);
  });
});

describe('valuesLine', () => {
  it('names the source either way', () => {
    expect(valuesLine(origin({ kind: 'live' }))).toBe('Player values: FantasyCalc, live.');
    expect(valuesLine(origin())).toBe('Player values: FantasyCalc, as of October 6, 2026.');
    expect(valuesLine(undefined)).toBeNull();
  });
});

describe('ValuesBadge', () => {
  it('renders nothing for live values', () => {
    const { container } = render(<ValuesBadge origin={origin({ kind: 'live' })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is a warning that opens onto the explanation', async () => {
    render(<ValuesBadge origin={origin()} />);

    const pill = screen.getByLabelText(/Values from Oct 6/);
    expect(pill.className).toMatch(/text-caution/);

    await userEvent.click(pill);
    expect(screen.getByText(/priced as of that date/)).toBeVisible();
  });
});
