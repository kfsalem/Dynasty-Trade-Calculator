import { describe, expect, it } from 'vitest';
import { iterCsvRows, parseCsv } from './csv';

describe('parseCsv', () => {
  it('parses a simple table', () => {
    expect(parseCsv('a,b\n1,2\n3,4')).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });

  it('keeps commas inside quoted fields', () => {
    // DynastyProcess quotes player names, some of which contain commas.
    expect(parseCsv('player,pos\n"Smith, Jr.",WR')).toEqual([
      { player: 'Smith, Jr.', pos: 'WR' },
    ]);
  });

  it('unescapes doubled quotes', () => {
    expect(parseCsv('name\n"He said ""hi"""')).toEqual([{ name: 'He said "hi"' }]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([{ a: '1', b: '2' }]);
  });

  it('handles a final row with no trailing newline', () => {
    expect(parseCsv('a\n1\n2')).toEqual([{ a: '1' }, { a: '2' }]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('iterCsvRows', () => {
  it('yields the same records parseCsv collects', () => {
    const text = 'a,b\n1,2\n"x, y",4\n';
    expect([...iterCsvRows(text)]).toEqual(parseCsv(text));
  });

  it('yields nothing for a header-only file', () => {
    expect([...iterCsvRows('a,b')]).toEqual([]);
  });

  it('yields nothing for empty input', () => {
    expect([...iterCsvRows('')]).toEqual([]);
  });

  it('produces rows without reading to the end of the input', () => {
    // The point of the generator: the ingest reads a 53 MB depth-chart file
    // and keeps one snapshot out of 132, so it must not have to materialize
    // every row first.
    const rows = iterCsvRows(`a\n${Array.from({ length: 10_000 }, (_, i) => i).join('\n')}`);

    expect(rows.next().value).toEqual({ a: '0' });
    expect(rows.next().value).toEqual({ a: '1' });
    rows.return(undefined);
  });
});
