import { describe, it, expect } from 'vitest';
import { csvCell } from '@/services/dataBackupService';

describe('csvCell (CSV injection defence)', () => {
  // OWASP CSV-injection test vectors: cells beginning with =, +, -, @,
  // tab, or CR must be prefixed with a single quote so Excel / Sheets /
  // LibreOffice treat them as text rather than evaluating a formula.
  // Note: when the cell also contains commas or quotes it gets wrapped
  // in double-quotes AFTER the apostrophe is prepended; Excel still sees
  // the apostrophe at the start of the cell value and treats it as text.
  const dangerousPrefixes = ['=', '+', '-', '@', '\t', '\r'];
  for (const prefix of dangerousPrefixes) {
    it(`defangs a cell starting with ${JSON.stringify(prefix)}`, () => {
      const out = csvCell(`${prefix}SUM(1+2)`);
      // Unquote then check the first real character is the safety apostrophe
      const inner = out.startsWith('"') && out.endsWith('"') ? out.slice(1, -1).replace(/""/g, '"') : out;
      expect(inner.charAt(0)).toBe("'");
    });
  }

  it('does not prefix safe cells', () => {
    const out1 = csvCell('Office supplies');
    expect(out1.charAt(0)).not.toBe("'");
  });

  it('quotes cells containing commas', () => {
    const out = csvCell('Kumwali, Ltd');
    expect(out.charAt(0)).toBe('"');
    expect(out.charAt(out.length - 1)).toBe('"');
  });

  it('doubles up embedded quotes', () => {
    const out = csvCell('He said "hi"');
    expect(out).toContain('""hi""');
  });

  it('strips C0 control characters that would break parsing', () => {
    const out = csvCell('hello\u0000world');
    expect(out).not.toContain('\u0000');
  });

  it('converts newlines to spaces', () => {
    const out = csvCell('line1\nline2');
    expect(out).not.toContain('\n');
    expect(out).toContain('line1 line2');
  });

  it('handles null/undefined as empty string', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('handles numbers and booleans', () => {
    expect(csvCell(42)).toBe('42');
    expect(csvCell(true)).toBe('true');
  });

  it('prefixes a negative-looking formula but not a plain negative number', () => {
    // "-1+cmd|..." is a known injection vector
    const attack = csvCell('-1+2+cmd|/c calc');
    const inner = attack.startsWith('"') ? attack.slice(1, -1).replace(/""/g, '"') : attack;
    expect(inner.charAt(0)).toBe("'");
    // Plain negative numbers should NOT get the quote (numeric sort matters)
    expect(csvCell('-42.50')).toBe('-42.50');
  });
});
