/**
 * Minimal RFC-4180 CSV parser.
 *
 * DynastyProcess ships plain CSV with quoted fields (team names and player
 * names contain commas), which is a few dozen lines to handle correctly and
 * not worth a dependency.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
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
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  // Trailing field/row when the file does not end in a newline.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows;
  if (!header) return [];

  return body
    // Skip blank trailing lines without discarding legitimate single-column rows.
    .filter((cells) => cells.some((cell) => cell !== ''))
    .map((cells) => {
      const record: Record<string, string> = {};
      header.forEach((key, i) => {
        record[key] = cells[i] ?? '';
      });
      return record;
    });
}
