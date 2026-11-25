import type { TrendWindow } from '../values/valueTrend';
import { formatValue } from './format';

/** "Nov 24", read as a calendar day wherever the reader is. */
export const shortDate = (date: string): string =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

/** The window's name on its button: what it is called, not the days it covers. */
export const windowLabel = (window: TrendWindow): string =>
  window.key === 'week'
    ? '1 week'
    : window.key === 'month'
      ? '4 weeks'
      : `Since ${shortDate(window.start)}`;

/**
 * A change in market points with its sign, and a real minus: "+784", "−1,320".
 * The sign is what carries gain against loss; the colour beside it is extra.
 */
export const signedValue = (n: number): string =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatValue(Math.abs(n))}`;

/**
 * A share with its sign, to a whole percent — or one decimal under ten, where
 * a whole percent would round a real move to "0%".
 */
export const signedShare = (share: number): string => {
  const pct = Math.abs(share * 100);
  const digits = pct < 10 ? 1 : 0;
  const text = pct.toFixed(digits);
  if (Number(text) === 0) return '0%';
  return `${share > 0 ? '+' : '−'}${text}%`;
};
