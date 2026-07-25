import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';

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
