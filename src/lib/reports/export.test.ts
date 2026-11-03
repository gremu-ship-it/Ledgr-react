// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadFile, generateCSV, printReport, reportFilename } from './export';

describe('report export utilities', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('formats numeric values and escapes commas, quotes, and newlines', () => {
    expect(generateCSV(
      ['Code', 'Account', 'Amount (MWK)', 'Note'],
      [
        ['4100', 'Cash, bank', 1234.5, 'line one\nline two'],
        ['4200', 'A "quoted" account', -2, null],
      ],
    )).toBe([
      'Code,Account,Amount (MWK),Note',
      '4100,"Cash, bank",1234.50,"line one\nline two"',
      '4200,"A ""quoted"" account",-2.00,',
    ].join('\n'));
  });

  it('prevents spreadsheet formula injection in string cells without altering negative amounts', () => {
    expect(generateCSV(['Formula', 'Negative formula', 'Negative amount'], [
      ['=SUM(1+1)', '-1+2+cmd|/c calc', '-42.50'],
    ])).toBe("Formula,Negative formula,Negative amount\n'=SUM(1+1),'-1+2+cmd|/c calc,-42.50");
  });

  it('supports custom decimal places and empty rows', () => {
    expect(generateCSV(['Amount'], [[1.234]], { decimalPlaces: 3 })).toBe('Amount\n1.234');
    expect(generateCSV(['Code', 'Account'], [])).toBe('Code,Account');
  });

  it('generates a period-based CSV filename, falling back to today', () => {
    expect(reportFilename('trial-balance', '2026-10-01', '2026-10-26'))
      .toBe('trial-balance_2026-10-01_to_2026-10-26.csv');
    expect(reportFilename('cash-flow')).toMatch(/^cash-flow_\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('downloads a blob and cleans up the temporary link and object URL', () => {
    const createObjectURL = vi.fn(() => 'blob:report');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    downloadFile('a,b\n1,2', 'report.csv', 'text/csv;charset=utf-8');

    expect(createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: 'text/csv;charset=utf-8' }));
    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector('a[download="report.csv"]')).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:report');
  });

  it('delegates PDF output to the browser print dialog', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    printReport();
    expect(print).toHaveBeenCalledOnce();
  });
});
