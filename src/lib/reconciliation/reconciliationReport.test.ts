import { describe, expect, it } from 'vitest';
import type { BankReconciliationMatch } from '@/dal/repositories/BankReconciliationRepository';
import { computeReconciliationReport } from './reconciliationReport';
import type { BankStatementMatchLine, GlMatchLine } from './matcher';

const bank = (overrides: Partial<BankStatementMatchLine> = {}): BankStatementMatchLine => ({
  id: 'bank-1', transaction_date: '2026-01-15', description: 'Deposit', reference: null, amount: 100,
  ...overrides,
});
const gl = (overrides: Partial<GlMatchLine> = {}): GlMatchLine => ({
  id: 'gl-1', entry_date: '2026-01-15', description: 'Receipt', entry_number: 'JE-1', is_debit: true, amount: 100,
  ...overrides,
});
const match = (overrides: Partial<BankReconciliationMatch> = {}): BankReconciliationMatch => ({
  id: 'match-1', business_id: 'business-1', statement_line_id: 'bank-1', journal_line_id: 'gl-1',
  matched_amount: 100, is_auto_match: false, matched_by: 'user-1', matched_at: '2026-01-31T12:00:00Z',
  ...overrides,
});

describe('computeReconciliationReport', () => {
  it('returns zero difference for a fully matched statement and book balance', () => {
    const report = computeReconciliationReport([bank()], [gl()], [match()], 1_000, 1_000, {
      bankName: 'NBS Bank', accountNumber: '12345678', statementDate: '2026-01-31',
    });
    expect(report).toMatchObject({ adjustedBankBalance: 1_000, adjustedBookBalance: 1_000, difference: 0, isReconciled: true });
  });

  it('classifies unmatched GL cash debits as deposits in transit', () => {
    const report = computeReconciliationReport([], [gl({ amount: 100 })], [], 1_000, 1_100);
    expect(report.depositsInTransit).toHaveLength(1);
    expect(report.adjustedBankBalance).toBe(1_100);
    expect(report.difference).toBe(0);
  });

  it('classifies unmatched GL cash credits as outstanding cheques', () => {
    const report = computeReconciliationReport([], [gl({ is_debit: false, amount: 100 })], [], 1_100, 1_000);
    expect(report.outstandingCheques).toHaveLength(1);
    expect(report.adjustedBankBalance).toBe(1_000);
    expect(report.difference).toBe(0);
  });

  it('classifies bank deposits with no GL match and adjusts the book balance', () => {
    const report = computeReconciliationReport([bank({ amount: 100 })], [], [], 1_100, 1_000);
    expect(report.unpresentedDeposits).toHaveLength(1);
    expect(report.adjustedBookBalance).toBe(1_100);
    expect(report.difference).toBe(0);
  });

  it('identifies small fee-like withdrawals as bank charges', () => {
    const report = computeReconciliationReport([bank({ amount: -10, description: 'Monthly bank charge' })], [], [], 990, 1_000);
    expect(report.bankCharges).toHaveLength(1);
    expect(report.bankCharges[0].amount).toBe(10);
    expect(report.adjustedBookBalance).toBe(990);
    expect(report.difference).toBe(0);
  });

  it('keeps other unmatched withdrawals visible and handles an empty statement', () => {
    const report = computeReconciliationReport([bank({ amount: -50, description: 'Cash withdrawal' })], [], [], 950, 1_000);
    expect(report.otherUnmatchedBankLines).toHaveLength(1);
    expect(report.adjustedBookBalance).toBe(950);
    expect(computeReconciliationReport([], [], [], 0, 0)).toMatchObject({
      bankClosingBalance: 0, adjustedBankBalance: 0, adjustedBookBalance: 0, difference: 0, isReconciled: true,
    });
  });
});
