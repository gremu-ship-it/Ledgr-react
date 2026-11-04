import { describe, expect, it } from 'vitest';
import {
  calculateStatementBalance,
  detectStatementColumns,
  parseStatementCsv,
  parseStatementDate,
  validateStatementRows,
} from './statementCsv';

describe('bank statement CSV parsing', () => {
  it('parses quoted commas, escaped quotes, CRLF rows, and embedded newlines', () => {
    const parsed = parseStatementCsv('\uFEFFDate,Description,Reference,Amount\r\n2026-01-15,"Payment, Client A",INV-1,500.00\r\n2026-01-16,"Supplier ""A""\nPayment",SUP-2,-250.00\r\n');
    expect(parsed.headers).toEqual(['Date', 'Description', 'Reference', 'Amount']);
    expect(parsed.rows).toEqual([
      ['2026-01-15', 'Payment, Client A', 'INV-1', '500.00'],
      ['2026-01-16', 'Supplier "A"\nPayment', 'SUP-2', '-250.00'],
    ]);
  });

  it('detects common header aliases for the standard and debit-credit formats', () => {
    expect(detectStatementColumns(['Posting Date', 'Narration', 'Cheque No', 'Amount', 'Running Balance']))
      .toEqual({ date: 0, description: 1, reference: 2, amount: 3, debit: null, credit: null, balance: 4 });
    expect(detectStatementColumns(['Transaction Date', 'Particulars', 'Debit', 'Credit']))
      .toEqual({ date: 0, description: 1, reference: null, amount: null, debit: 2, credit: 3, balance: null });
  });

  it('validates standard signed amounts, references, balances, and period dates', () => {
    const csv = parseStatementCsv([
      'Date,Description,Reference,Amount,Balance',
      '2026-01-15,Payment from Client A,INV-001,500000.00,1500000.00',
      '2026-01-16,Supplier Payment,SUP-042,-250000.00,1250000.00',
    ].join('\n'));
    const result = validateStatementRows(csv.rows, detectStatementColumns(csv.headers), '2026-01-01', '2026-01-31');
    expect(result.errors).toEqual([]);
    expect(result.lines).toEqual([
      { transaction_date: '2026-01-15', description: 'Payment from Client A', reference: 'INV-001', amount: 500000, running_balance: 1500000 },
      { transaction_date: '2026-01-16', description: 'Supplier Payment', reference: 'SUP-042', amount: -250000, running_balance: 1250000 },
    ]);
    expect(calculateStatementBalance(1250000, result.lines)).toBe(1500000);
  });

  it('converts separate debit and credit columns into signed amounts', () => {
    const csv = parseStatementCsv('Date,Description,Debit,Credit\n2026-01-15,Client payment,,500000.00\n2026-01-16,Supplier payment,250000.00,');
    const result = validateStatementRows(csv.rows, detectStatementColumns(csv.headers), '2026-01-01', '2026-01-31');
    expect(result.errors).toEqual([]);
    expect(result.lines.map((line) => line.amount)).toEqual([500000, -250000]);
  });

  it('rejects the entire file when any date is invalid or outside the period', () => {
    const csv = parseStatementCsv('Date,Description,Amount\nnot-a-date,Valid description,10\n2026-02-01,Outside period,5');
    const result = validateStatementRows(csv.rows, detectStatementColumns(csv.headers), '2026-01-01', '2026-01-31');
    expect(result.errors).toEqual([
      { row: 2, reason: 'invalidDate' },
      { row: 3, reason: 'dateOutsidePeriod' },
    ]);
    expect(result.lines).toEqual([]);
  });

  it('rejects empty descriptions, malformed amounts, and rows with both debit and credit', () => {
    const csv = parseStatementCsv('Date,Description,Debit,Credit\n2026-01-01,,10,\n2026-01-02,Invalid,abc,\n2026-01-03,Both,10,20');
    const result = validateStatementRows(csv.rows, detectStatementColumns(csv.headers), '2026-01-01', '2026-01-31');
    expect(result.errors).toEqual([
      { row: 2, reason: 'emptyDescription' },
      { row: 3, reason: 'invalidAmount' },
      { row: 4, reason: 'debitAndCredit' },
    ]);
    expect(result.lines).toEqual([]);
  });

  it('parses day-first and month-name dates while rejecting impossible calendar dates', () => {
    expect(parseStatementDate('15/01/2026')).toBe('2026-01-15');
    expect(parseStatementDate('15 Jan 2026')).toBe('2026-01-15');
    expect(parseStatementDate('2026-02-30')).toBeNull();
  });
});
