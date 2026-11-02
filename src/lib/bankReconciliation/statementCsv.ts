export interface ParsedStatementCsv {
  headers: string[];
  rows: string[][];
}

export interface StatementColumnMapping {
  date: number | null;
  description: number | null;
  reference: number | null;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  balance: number | null;
}

export interface ImportedStatementLine {
  transaction_date: string;
  description: string;
  reference: string | null;
  amount: number;
  running_balance: number | null;
}

export type StatementRowValidationError = {
  row: number;
  reason: 'invalidDate' | 'dateOutsidePeriod' | 'emptyDescription' | 'invalidAmount' | 'invalidBalance' | 'debitAndCredit';
};

export interface StatementValidationResult {
  lines: ImportedStatementLine[];
  errors: StatementRowValidationError[];
}

export class StatementCsvParseError extends Error {
  readonly reason: 'unclosedQuote' | 'missingHeader' | 'missingRows';

  constructor(reason: 'unclosedQuote' | 'missingHeader' | 'missingRows') {
    super(reason);
    this.reason = reason;
    this.name = 'StatementCsvParseError';
  }
}

/** Parse RFC-4180-style delimited rows, including escaped quotes and newlines in quoted cells. */
export function parseStatementCsv(source: string): ParsedStatementCsv {
  const input = source.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (inQuotes) {
      if (character === '"' && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"' && cell.length === 0) {
      inQuotes = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n' || character === '\r') {
      row.push(cell);
      cell = '';
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      if (character === '\r' && input[index + 1] === '\n') index += 1;
    } else {
      cell += character;
    }
  }

  if (inQuotes) throw new StatementCsvParseError('unclosedQuote');
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((value) => value.trim() !== '')) rows.push(row);
  }
  if (rows.length === 0 || rows[0].every((header) => header.trim() === '')) {
    throw new StatementCsvParseError('missingHeader');
  }
  if (rows.length === 1) throw new StatementCsvParseError('missingRows');

  const headers = rows[0].map((header) => header.trim());
  const dataRows = rows.slice(1).map((values) => headers.map((_, index) => (values[index] ?? '').trim()));
  return { headers, rows: dataRows };
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function findHeader(headers: string[], candidates: string[]): number | null {
  const normalized = headers.map(normalizeHeader);
  for (const candidate of candidates) {
    const index = normalized.indexOf(normalizeHeader(candidate));
    if (index >= 0) return index;
  }
  return null;
}

export function detectStatementColumns(headers: string[]): StatementColumnMapping {
  const debit = findHeader(headers, ['Debit', 'Debit Amount', 'Withdrawal', 'Withdrawals', 'Money Out']);
  const credit = findHeader(headers, ['Credit', 'Credit Amount', 'Deposit', 'Deposits', 'Money In']);
  return {
    date: findHeader(headers, ['Date', 'Transaction Date', 'Posting Date', 'Value Date']),
    description: findHeader(headers, ['Description', 'Narration', 'Details', 'Particulars']),
    reference: findHeader(headers, ['Reference', 'Ref', 'Cheque No', 'Transaction ID', 'Transaction Reference']),
    amount: findHeader(headers, ['Amount', 'Transaction Amount', 'Debit/Credit', 'Credit/Debit', 'Amount MWK']),
    debit,
    credit,
    balance: findHeader(headers, ['Balance', 'Running Balance', 'Closing Balance']),
  };
}

function isValidDate(year: number, month: number, day: number): boolean {
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Accept ISO dates and unambiguous Malawi-friendly day-first dates. */
export function parseStatementDate(value: string): string | null {
  const text = value.trim();
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (match) {
    const [, yearText, monthText, dayText] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    return isValidDate(year, month, day)
      ? `${yearText}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      : null;
  }

  match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(text);
  if (match) {
    const [, dayText, monthText, yearText] = match;
    const day = Number(dayText);
    const month = Number(monthText);
    const year = Number(yearText);
    return isValidDate(year, month, day)
      ? `${yearText}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      : null;
  }

  match = /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/.exec(text);
  if (match) {
    const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const month = monthNames.indexOf(match[2].slice(0, 3).toLowerCase()) + 1;
    const day = Number(match[1]);
    const year = Number(match[3]);
    if (month && isValidDate(year, month, day)) {
      return `${match[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return null;
}

function parseAmount(value: string): number | null {
  let text = value.trim();
  if (!text) return null;

  let sign = 1;
  const suffix = /\s*(CR|DR)\s*$/i.exec(text);
  if (suffix) {
    sign = suffix[1].toUpperCase() === 'DR' ? -1 : 1;
    text = text.slice(0, suffix.index).trim();
  }
  const parenthesized = /^\(.*\)$/.test(text);
  if (parenthesized) {
    sign *= -1;
    text = text.slice(1, -1).trim();
  }
  text = text.replace(/^(?:MWK|MK|K)\s*/i, '').replace(/\s*(?:MWK|MK)\s*$/i, '').replace(/\s/g, '');
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) return null;
  const amount = Number(text.replace(/,/g, '')) * sign;
  return Number.isFinite(amount) ? amount : null;
}

/** Validates the entire file; any invalid row suppresses all returned lines. */
export function validateStatementRows(
  rows: string[][],
  mapping: StatementColumnMapping,
  periodStart: string,
  statementDate: string,
): StatementValidationResult {
  const errors: StatementRowValidationError[] = [];
  const lines: ImportedStatementLine[] = [];
  const canUseAmount = mapping.amount !== null;
  const canUseDebitCredit = mapping.debit !== null || mapping.credit !== null;
  if (!canUseAmount && !(mapping.debit !== null && mapping.credit !== null)) {
    return { lines: [], errors: [{ row: 1, reason: 'invalidAmount' }] };
  }

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const date = mapping.date === null ? null : parseStatementDate(row[mapping.date] ?? '');
    if (!date) {
      errors.push({ row: rowNumber, reason: 'invalidDate' });
      return;
    }
    if (date < periodStart || date > statementDate) {
      errors.push({ row: rowNumber, reason: 'dateOutsidePeriod' });
      return;
    }
    const description = mapping.description === null ? '' : (row[mapping.description] ?? '').trim();
    if (!description) {
      errors.push({ row: rowNumber, reason: 'emptyDescription' });
      return;
    }

    let amount: number | null = null;
    if (canUseDebitCredit && mapping.debit !== null && mapping.credit !== null) {
      const rawDebit = (row[mapping.debit] ?? '').trim();
      const rawCredit = (row[mapping.credit] ?? '').trim();
      const debit = rawDebit ? parseAmount(rawDebit) : 0;
      const credit = rawCredit ? parseAmount(rawCredit) : 0;
      if (debit === null || credit === null) {
        errors.push({ row: rowNumber, reason: 'invalidAmount' });
        return;
      }
      if (debit !== 0 && credit !== 0) {
        errors.push({ row: rowNumber, reason: 'debitAndCredit' });
        return;
      }
      if (!rawDebit && !rawCredit) {
        errors.push({ row: rowNumber, reason: 'invalidAmount' });
        return;
      }
      amount = Math.abs(credit) - Math.abs(debit);
    } else if (mapping.amount !== null) {
      amount = parseAmount(row[mapping.amount] ?? '');
    }
    if (amount === null) {
      errors.push({ row: rowNumber, reason: 'invalidAmount' });
      return;
    }

    const rawBalance = mapping.balance === null ? '' : (row[mapping.balance] ?? '').trim();
    const runningBalance = rawBalance ? parseAmount(rawBalance) : null;
    if (rawBalance && runningBalance === null) {
      errors.push({ row: rowNumber, reason: 'invalidBalance' });
      return;
    }
    const reference = mapping.reference === null ? '' : (row[mapping.reference] ?? '').trim();
    lines.push({
      transaction_date: date,
      description,
      reference: reference || null,
      amount,
      running_balance: runningBalance,
    });
  });

  return { lines: errors.length === 0 ? lines : [], errors };
}

export function calculateStatementBalance(openingBalance: number, lines: ImportedStatementLine[]): number {
  return lines.reduce((balance, line) => balance + line.amount, openingBalance);
}
