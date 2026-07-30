/**
 * Minimal RFC-4180 CSV parser.
 *
 * DynastyProcess ships plain CSV with quoted fields (team names and player
 * names contain commas), which is a few dozen lines to handle correctly and
 * not worth a dependency.
 */
function* iterRawRows(text: string): Generator<string[]> {
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      yield row;
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  // Trailing field/row when the file does not end in a newline.
  if (field !== '' || row.length > 0) {
    row.push(field);
    yield row;
  }
}

/**
 * Same parse as `parseCsv`, one row at a time.
 *
 * The build-time ingest reads a 53 MB nflverse depth-chart file and keeps only
 * the newest snapshot inside it. Materializing all ~385,000 rows as objects
 * first costs well over a gigabyte for data that is discarded a line later, so
 * anything reading a release-sized file should iterate instead.
 */
export function* iterCsvRows(text: string): Generator<Record<string, string>> {
  const rows = iterRawRows(text);

  const first = rows.next();
  if (first.done) return;
  const header = first.value;

  for (const cells of rows) {
    // Skip blank trailing lines without discarding legitimate single-column rows.
    if (!cells.some((cell) => cell !== '')) continue;

    const record: Record<string, string> = {};
    header.forEach((key, i) => {
      record[key] = cells[i] ?? '';
    });
    yield record;
  }
}

export function parseCsv(text: string): Record<string, string>[] {
  return [...iterCsvRows(text)];
}
