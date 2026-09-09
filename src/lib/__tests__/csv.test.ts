import { describe, it, expect } from 'vitest';
import { isFormulaLike, escapeCsvCell, buildCsv } from '../csv';

describe('isFormulaLike', () => {
  it('flags formula-trigger prefixes', () => {
    expect(isFormulaLike('=HYPERLINK("http://evil")')).toBe(true);
    expect(isFormulaLike('+1+2')).toBe(true);
    expect(isFormulaLike('@SUM(A1)')).toBe(true);
    expect(isFormulaLike('\t=cmd')).toBe(true);
    expect(isFormulaLike('\r=cmd')).toBe(true);
  });

  it('flags dangerous leading-minus payloads but not negative numbers', () => {
    expect(isFormulaLike("-2+3+cmd|' /C calc'!A0")).toBe(true);
    expect(isFormulaLike('-500')).toBe(false);
    expect(isFormulaLike('-1,234.56')).toBe(false);
    expect(isFormulaLike('-12.5%')).toBe(false);
  });

  it('leaves ordinary values alone', () => {
    expect(isFormulaLike('Acme Ltd')).toBe(false);
    expect(isFormulaLike('2026-09-09')).toBe(false);
    expect(isFormulaLike('')).toBe(false);
    expect(isFormulaLike('100')).toBe(false);
  });
});

describe('escapeCsvCell', () => {
  it('neutralises formula cells with a leading apostrophe', () => {
    expect(escapeCsvCell('=1+1')).toBe('"\'=1+1"');
    expect(escapeCsvCell('@cmd')).toBe('"\'@cmd"');
  });

  it('applies RFC 4180 quote escaping', () => {
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it('stringifies null/undefined as empty', () => {
    expect(escapeCsvCell(null)).toBe('""');
    expect(escapeCsvCell(undefined)).toBe('""');
  });

  it('keeps negative amounts untouched', () => {
    expect(escapeCsvCell('-500')).toBe('"-500"');
  });
});

describe('buildCsv', () => {
  it('builds a header + rows CSV with guarded cells', () => {
    const csv = buildCsv(['name', 'amount'], [
      ['=HYPERLINK("http://evil","x")', -500],
      ['Acme, Ltd', 1000],
    ]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('"name","amount"');
    expect(lines[1]).toBe('"\'=HYPERLINK(""http://evil"",""x"")","-500"');
    expect(lines[2]).toBe('"Acme, Ltd","1000"');
  });
});
