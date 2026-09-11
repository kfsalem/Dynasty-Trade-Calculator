import { IngestError } from './errors';

/**
 * Assert a source CSV still has the columns we read.
 *
 * Checked against the first data row rather than the header, because the parser
 * fills every header key into every record — so the row's keys *are* the header,
 * and an empty file fails here too. Both are schema drift as far as the build is
 * concerned: a renamed column and a file that suddenly has no rows produce the
 * same silently-empty output.
 */
export function requireColumns(
  dataset: string,
  row: Record<string, string> | undefined,
  required: readonly string[],
): Record<string, string> {
  if (!row) {
    throw new IngestError(
      'schema',
      `${dataset}: source has no data rows. Expected columns: ${required.join(', ')}.`,
    );
  }

  const missing = required.filter((column) => !(column in row));
  if (missing.length > 0) {
    throw new IngestError(
      'schema',
      `${dataset}: source is missing ${missing.length === 1 ? 'column' : 'columns'} ` +
        `${missing.join(', ')}. Columns present: ${Object.keys(row).join(', ')}.`,
    );
  }

  return row;
}

/**
 * The failure for a source that parsed into almost nothing.
 *
 * Returned rather than thrown so a caller that has already decided it has
 * nothing usable can `throw` it without a condition the compiler cannot see
 * through — one message, both shapes of call.
 */
export function emptyDataset(dataset: string, count: number, minimum: number): IngestError {
  return new IngestError(
    'schema',
    `${dataset}: reduced to ${count} players, expected at least ${minimum}. ` +
      `The source parsed but produced almost nothing. A season that has only just ` +
      `kicked off is not this — the caller falls back to the season before it — so ` +
      `every season it could reach came up short. Check for a changed id column, ` +
      `position code, or season-type filter.`,
  );
}

/** Fail rather than ship an empty dataset that reads as "the season hasn't started". */
export function requireRows(dataset: string, count: number, minimum: number): void {
  if (count < minimum) throw emptyDataset(dataset, count, minimum);
}

/** nflverse writes `NA` for missing values; everything else is a number or blank. */
export function num(value: string | undefined): number | null {
  if (value === undefined || value === '' || value === 'NA') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Trim float noise. Snap and target shares carry far more digits than they mean. */
export function round(value: number | null, places: number): number | null {
  if (value === null) return null;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
