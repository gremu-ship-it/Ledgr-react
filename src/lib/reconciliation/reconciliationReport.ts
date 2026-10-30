import type { BankReconciliationMatch } from '@/dal/repositories/BankReconciliationRepository';
import type { BankStatementMatchLine, GlMatchLine } from './matcher';

export interface ReconciliationItem {
  id: string;
  date: string;
  description: string;
  reference: string | null;
  /** Positive magnitude; the report section communicates the adjustment sign. */
  amount: number;
}

export interface ReconciliationReport {
  bankName: string;
  accountNumber: string;
  statementDate: string;
  bankClosingBalance: number;
  depositsInTransit: ReconciliationItem[];
  outstandingCheques: ReconciliationItem[];
  unpresentedDeposits: ReconciliationItem[];
  bankCharges: ReconciliationItem[];
  otherUnmatchedBankLines: ReconciliationItem[];
  adjustedBankBalance: number;
  bookBalance: number;
  adjustedBookBalance: number;
  difference: number;
  isReconciled: boolean;
}

export interface ReconciliationStatementSummary {
  bankName: string;
  accountNumber: string;
  statementDate: string;
}

export interface ReconciliationReportOptions {
  bankName?: string;
  accountNumber?: string;
  statementDate?: string;
  smallChargeThreshold?: number;
}

function cents(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function matchTotals(matches: BankReconciliationMatch[]): {
  bank: Map<string, number>;
  gl: Map<string, number>;
} {
  const bank = new Map<string, number>();
  const gl = new Map<string, number>();
  for (const match of matches) {
    bank.set(match.statement_line_id, (bank.get(match.statement_line_id) ?? 0) + Number(match.matched_amount));
    gl.set(match.journal_line_id, (gl.get(match.journal_line_id) ?? 0) + Number(match.matched_amount));
  }
  return { bank, gl };
}

function residual(rawAmount: number, matchedAmount: number): number {
  const left = Math.max(0, Math.abs(rawAmount) - Math.max(0, matchedAmount));
  return cents(left) * (rawAmount < 0 ? -1 : 1);
}

function itemFromBank(line: BankStatementMatchLine, amount: number): ReconciliationItem {
  return { id: line.id, date: line.transaction_date, description: line.description, reference: line.reference, amount: Math.abs(amount) };
}

function itemFromGl(line: GlMatchLine, amount: number): ReconciliationItem {
  return { id: line.id, date: line.entry_date, description: line.description, reference: line.entry_number || null, amount: Math.abs(amount) };
}

/** Compute timing differences from the remaining unmatched amounts on both sides. */
export function computeReconciliationReport(
  bankLines: BankStatementMatchLine[],
  glLines: GlMatchLine[],
  matches: BankReconciliationMatch[],
  bankClosingBalance: number,
  bookBalance: number,
  options: ReconciliationReportOptions = {},
): ReconciliationReport {
  const totals = matchTotals(matches);
  const depositsInTransit: ReconciliationItem[] = [];
  const outstandingCheques: ReconciliationItem[] = [];
  const unpresentedDeposits: ReconciliationItem[] = [];
  const bankCharges: ReconciliationItem[] = [];
  const otherUnmatchedBankLines: ReconciliationItem[] = [];
  let glTimingAdjustment = 0;
  let bankBookAdjustment = 0;
  const chargeThreshold = Math.max(0, options.smallChargeThreshold ?? 10_000);

  for (const line of glLines) {
    const matchedAmount = Math.max(totals.gl.get(line.id) ?? 0, line.matchedAmount ?? 0);
    const signedAmount = (line.is_debit ? 1 : -1) * residual(line.amount, matchedAmount);
    if (Math.abs(signedAmount) < 0.005) continue;
    glTimingAdjustment += signedAmount;
    const item = itemFromGl(line, signedAmount);
    if (signedAmount > 0) depositsInTransit.push(item);
    else outstandingCheques.push(item);
  }

  for (const line of bankLines) {
    const matchedAmount = Math.max(totals.bank.get(line.id) ?? 0, line.matchedAmount ?? 0);
    const signedAmount = residual(line.amount, matchedAmount);
    if (Math.abs(signedAmount) < 0.005) continue;
    bankBookAdjustment += signedAmount;
    if (signedAmount > 0) {
      unpresentedDeposits.push(itemFromBank(line, signedAmount));
      continue;
    }
    const feeLike = /\b(fee|fees|charge|charges|commission)\b/i.test(line.description);
    if (feeLike && Math.abs(signedAmount) <= chargeThreshold) bankCharges.push(itemFromBank(line, signedAmount));
    else otherUnmatchedBankLines.push(itemFromBank(line, signedAmount));
  }

  const adjustedBankBalance = cents(bankClosingBalance + glTimingAdjustment);
  const adjustedBookBalance = cents(bookBalance + bankBookAdjustment);
  const difference = cents(adjustedBankBalance - adjustedBookBalance);
  return {
    bankName: options.bankName ?? '',
    accountNumber: options.accountNumber ?? '',
    statementDate: options.statementDate ?? '',
    bankClosingBalance: cents(bankClosingBalance),
    depositsInTransit,
    outstandingCheques,
    unpresentedDeposits,
    bankCharges,
    otherUnmatchedBankLines,
    adjustedBankBalance,
    bookBalance: cents(bookBalance),
    adjustedBookBalance,
    difference,
    isReconciled: Math.abs(difference) < 0.005,
  };
}
