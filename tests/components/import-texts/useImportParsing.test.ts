import { describe, it, expect } from 'vitest';
import { parseSheet } from '@/components/app/import-texts/useImportParsing';

describe('parseSheet', () => {
  it('returns empty result for empty input', () => {
    const r = parseSheet({ input: '' });
    expect(r.rows).toEqual([]);
    expect(r.columnCount).toBe(0);
  });

  it('auto-detects comma delimiter', () => {
    const r = parseSheet({ input: 'a,b\n1,2\n3,4' });
    expect(r.detectedDelimiter).toBe(',');
    expect(r.rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('auto-detects semicolon', () => {
    const r = parseSheet({ input: 'a;b\n1;2' });
    expect(r.detectedDelimiter).toBe(';');
    expect(r.rows).toHaveLength(2);
  });

  it('auto-detects tab', () => {
    const r = parseSheet({ input: 'a\tb\n1\t2' });
    expect(r.detectedDelimiter).toBe('\t');
    expect(r.rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('auto-detects pipe', () => {
    const r = parseSheet({ input: 'a|b\n1|2' });
    expect(r.detectedDelimiter).toBe('|');
  });

  it('respects explicit delimiter override', () => {
    // This input contains both commas and semicolons; forcing semicolon should
    // produce a single column per line unless ;'s are used.
    const r = parseSheet({ input: 'a,b;c\n1,2;3', delimiter: ';' });
    expect(r.columnCount).toBe(2);
    expect(r.rows[0]).toEqual(['a,b', 'c']);
  });

  it('handles quoted cells containing delimiter', () => {
    const r = parseSheet({ input: '"Hello, world",greeting\nfoo,bar' });
    expect(r.rows[0]).toEqual(['Hello, world', 'greeting']);
  });

  it('strips BOM', () => {
    const r = parseSheet({ input: '\uFEFFGerman,Spanish\nHallo,Hola' });
    expect(r.rows[0][0]).toBe('German');
  });

  it('handles CRLF line endings', () => {
    const r = parseSheet({ input: 'a,b\r\n1,2\r\n3,4' });
    expect(r.rows).toHaveLength(3);
  });

  it('pads ragged rows to the widest column count', () => {
    const r = parseSheet({ input: 'a,b,c\n1,2' });
    expect(r.columnCount).toBe(3);
    expect(r.rows[1]).toEqual(['1', '2', '']);
  });

  it('drops entirely empty lines', () => {
    const r = parseSheet({ input: 'a,b\n\n1,2\n\n' });
    expect(r.rows).toHaveLength(2);
  });

  it('trims whitespace in each cell', () => {
    const r = parseSheet({ input: ' a , b \n  1  ,  2  ' });
    expect(r.rows[1]).toEqual(['1', '2']);
  });
});
