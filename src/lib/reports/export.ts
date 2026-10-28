/** Build a spreadsheet-friendly CSV string from report rows. */
export function generateCSV(
  headers: string[],
  rows: (string | number | null)[][],
  options?: { decimalPlaces?: number },
): string {
  const escape = (value: string | number | null): string => {
    if (value === null || value === undefined) return '';
    let text = typeof value === 'number'
      ? value.toFixed(options?.decimalPlaces ?? 2)
      : String(value);
    const isFormula = typeof value !== 'number'
      && text.length > 0
      && '=+-@\t\r'.includes(text.charAt(0))
      && !((text.charAt(0) === '-' || text.charAt(0) === '+') && /^-?\d+(\.\d+)?$/.test(text));
    if (isFormula) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  return [
    headers.map(escape).join(','),
    ...rows.map((row) => row.map(escape).join(',')),
  ].join('\n');
}

/** Start a browser download for generated report content. */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/** Produce a stable report filename with the selected date range. */
export function reportFilename(reportName: string, dateFrom?: string, dateTo?: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const period = dateFrom && dateTo ? `${dateFrom}_to_${dateTo}` : date;
  return `${reportName}_${period}.csv`;
}

/** Open the browser's native print dialog (users may choose Save as PDF). */
export function printReport(): void {
  window.print();
}
