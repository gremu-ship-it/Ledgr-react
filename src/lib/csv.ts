// src/lib/csv.ts
//
// Shared CSV export helpers with protection against CSV/formula injection
// (CWE-1236). When a spreadsheet app opens an exported file, cells starting
// with `=`, `+`, `@`, tab, or carriage return are interpreted as formulas —
// so attacker-controlled data (e.g. a contact named `=HYPERLINK(...)`) could
// execute on the machine of whoever opens the export.
//
// Mitigation follows OWASP guidance: prefix risky cells with a single quote
// (`'`), which spreadsheet apps treat as "display as text". Legitimate
// negative numbers like "-500" or "-1,234.56" are NOT prefixed — a leading
// `-` is only guarded when it isn't a plain numeric value, so financial
// exports remain untouched.

/** True when the cell would be interpreted as a formula by Excel/Sheets. */
export function isFormulaLike(value: string): boolean {
  if (value.length === 0) return false;
  const first = value[0];
  if (first === '=' || first === '+' || first === '@' || first === '\t' || first === '\r') {
    return true;
  }
  // A leading "-" is only dangerous when the rest isn't a plain number
  // (e.g. "-2+3+cmd|' /C calc'!A0"). Keep ordinary negative amounts intact.
  if (first === '-') {
    return !/^-\d[\d,]*(\.\d+)?%?$/.test(value);
  }
  return false;
}

/**
 * Escape a single cell for CSV output: neutralise formula-trigger prefixes,
 * then apply standard RFC 4180 double-quote escaping.
 */
export function escapeCsvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  const guarded = isFormulaLike(s) ? `'${s}` : s;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/** Build a full CSV string from a header row and data rows. */
export function buildCsv(headers: string[], rows: unknown[][]): string {
  return [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((r) => r.map(escapeCsvCell).join(',')),
  ].join('\n');
}

/** Trigger a browser download of `csv` under `filename`. */
export function downloadCsvFile(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
