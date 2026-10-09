import type { ValueOrigin } from '../values/source';

/**
 * Which copy of the market the values are, in words (#43).
 *
 * A fallback that is invisible is the thing #43 rules out: prices from another
 * day are different numbers, and the trade advice built on them is only as good
 * as the day they came from. So a reader on a saved copy is told, with the date.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const shortDate = (ms: number) =>
  new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const longDate = (ms: number) =>
  new Date(ms).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

function age(asOf: number, now: number): string {
  const days = Math.floor((now - asOf) / DAY_MS);
  if (days <= 0) return 'earlier today';
  if (days === 1) return 'a day ago';
  return `${days} days ago`;
}

/** One line for the league popover, whatever the origin. */
export function valuesLine(origin: ValueOrigin | undefined): string | null {
  if (!origin) return null;
  return origin.kind === 'live'
    ? `Player values: ${origin.label}, live.`
    : `Player values: ${origin.label}, as of ${longDate(origin.asOf)}.`;
}

/**
 * The header badge for values that are not live. Null when they are — a badge
 * that says everything is normal is a badge people learn not to read.
 */
export function valuesBadge(
  origin: ValueOrigin | undefined,
  now: number = Date.now(),
): { label: string; detail: string } | null {
  if (!origin || origin.kind === 'live') return null;

  const copy =
    origin.kind === 'snapshot'
      ? `its prices as this app last saved them, on ${longDate(origin.asOf)}`
      : `the prices this browser last fetched, on ${longDate(origin.asOf)}`;

  return {
    label: `Values from ${shortDate(origin.asOf)}`,
    detail:
      `${origin.label} could not be reached, so player values are ${copy} (${age(origin.asOf, now)}). ` +
      `Every grade, verdict and suggestion here is priced as of that date. ` +
      `The app asks for live values again each time it loads.`,
  };
}
