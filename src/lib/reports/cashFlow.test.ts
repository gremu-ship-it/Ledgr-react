import { describe, expect, it } from 'vitest';
import type { TrialBalanceRow } from '@/dal/repositories/ReportRepository';
import { computeBalanceSheet } from '@/lib/reports/balanceSheet';
import { computePnl } from '@/lib/reports/pnl';
import {
  CASH_FLOW_BALANCE_START_DATE,
  bsDelta,
  computeCashFlow,
  dayBefore,
  detectCashAccountCodes,
  isValidCashFlowPeriod,
  lineByKey,
} from './cashFlow';

function row(
  account_code: string,
  account_type: string,
  balance: number,
  account_name = `Account ${account_code}`,
): TrialBalanceRow {
  return {
    account_id: `id-${account_code}`,
    account_code,
    account_name,
    account_type,
    parent_account_id: null,
    total_debit: Math.max(balance, 0),
    total_credit: Math.max(-balance, 0),
    balance,
    level: 0,
  };
}

function makeCashFlow(
  periodRows: TrialBalanceRow[] = [],
  currentRows: TrialBalanceRow[] = [],
  priorRows: TrialBalanceRow[] = [],
  cashCodes: string[] = [],
) {
  return computeCashFlow(
    computePnl(periodRows),
    computeBalanceSheet(currentRows, false),
    computeBalanceSheet(priorRows, false),
    periodRows,
    cashCodes,
  );
}

describe('computeCashFlow — indirect method', () => {
  it('starts operating cash flow with the P&L net income', () => {
    const report = makeCashFlow([
      row('4110', 'income', -100, 'Sales'),
      row('6100', 'expense', 20, 'Operating expenses'),
    ]);
    expect(lineByKey(report, 'netIncome')?.amount).toBe(80);
  });

  it('adds depreciation and amortisation back to net income', () => {
    const report = makeCashFlow([
      row('4110', 'income', -100, 'Sales'),
      row('6801', 'expense', 20, 'Depreciation — Buildings'),
      row('6806', 'expense', 5, 'Amortisation — Intangibles'),
    ]);
    expect(lineByKey(report, 'netIncome')?.amount).toBe(75);
    expect(lineByKey(report, 'depreciation')?.amount).toBe(25);
    expect(report.sections[0].total).toBe(100);
  });

  it('adds back impairment and removes disposal gains while adding disposal losses', () => {
    const report = makeCashFlow([
      row('4201', 'other_income', -12, 'Gain on disposal of equipment'),
      row('7431', 'expense', 5, 'Loss on disposal of vehicle'),
      row('7430', 'expense', 4, 'Impairment Losses'),
    ]);
    expect(lineByKey(report, 'impairment')?.amount).toBe(4);
    expect(lineByKey(report, 'gainLossDisposal')?.amount).toBe(-7);
    expect(report.sections[0].total).toBe(0);
  });

  it('treats increases in debtors, inventory, and WIP as cash outflows', () => {
    const prior = [
      row('1131', 'asset', 100, 'Trade Debtors'),
      row('1141', 'asset', 40, 'Raw Materials'),
      row('1142', 'asset', 10, 'Work In Progress'),
    ];
    const current = [
      row('1131', 'asset', 125, 'Trade Debtors'),
      row('1141', 'asset', 50, 'Raw Materials'),
      row('1142', 'asset', 14, 'Work In Progress'),
    ];
    const report = makeCashFlow([], current, prior);
    expect(lineByKey(report, 'changeInDebtors')?.amount).toBe(-25);
    expect(lineByKey(report, 'changeInInventory')?.amount).toBe(-10);
    expect(lineByKey(report, 'changeInWip')?.amount).toBe(-4);
  });

  it('treats decreases in debtors as inflows and decreases in creditors as outflows', () => {
    const prior = [
      row('1131', 'asset', 100, 'Trade Debtors'),
      row('2111', 'liability', -20, 'Trade Creditors'),
    ];
    const current = [
      row('1131', 'asset', 90, 'Trade Debtors'),
      row('2111', 'liability', -15, 'Trade Creditors'),
    ];
    const report = makeCashFlow([], current, prior);
    expect(lineByKey(report, 'changeInDebtors')?.amount).toBe(10);
    expect(lineByKey(report, 'changeInCreditors')?.amount).toBe(-5);
  });

  it('treats increases in creditors, accruals, VAT, and retention payables as inflows', () => {
    const prior = [
      row('2111', 'liability', -20, 'Trade Creditors'),
      row('2112', 'liability', -6, 'Accrued Expenses'),
      row('2121', 'liability', -4, 'VAT Payable (Output Tax)'),
      row('2180', 'liability', -3, 'Retention Payable'),
    ];
    const current = [
      row('2111', 'liability', -28, 'Trade Creditors'),
      row('2112', 'liability', -10, 'Accrued Expenses'),
      row('2121', 'liability', -7, 'VAT Payable (Output Tax)'),
      row('2180', 'liability', -5, 'Retention Payable'),
    ];
    const report = makeCashFlow([], current, prior);
    expect(lineByKey(report, 'changeInCreditors')?.amount).toBe(8);
    expect(lineByKey(report, 'changeInAccruals')?.amount).toBe(4);
    expect(lineByKey(report, 'changeInVat')?.amount).toBe(3);
    expect(lineByKey(report, 'changeInRetention')?.amount).toBe(2);
  });

  it('classifies PPE and intangible asset purchases as investing outflows', () => {
    const prior = [
      row('1311', 'asset', 100, 'Land'),
      row('1532', 'asset', 20, 'Software & Licences'),
    ];
    const current = [
      row('1311', 'asset', 150, 'Land'),
      row('1532', 'asset', 35, 'Software & Licences'),
    ];
    const report = makeCashFlow([], current, prior);
    expect(lineByKey(report, 'purchasePPE')?.amount).toBe(-50);
    expect(lineByKey(report, 'purchaseIntangibles')?.amount).toBe(-15);
    expect(report.sections[1].total).toBe(-65);
  });

  it('uses asset decreases as disposal proceeds and excludes accumulated depreciation', () => {
    const prior = [
      row('1311', 'asset', 100, 'Buildings'),
      row('1520', 'asset', -20, 'Accumulated Depreciation'),
    ];
    const current = [
      row('1311', 'asset', 60, 'Buildings'),
      row('1520', 'asset', -20, 'Accumulated Depreciation'),
    ];
    const report = makeCashFlow([], current, prior);
    expect(lineByKey(report, 'proceedsDisposal')?.amount).toBe(40);
    expect(lineByKey(report, 'purchasePPE')?.amount).toBe(0);
  });

  it('splits borrowing increases into proceeds and decreases into repayments', () => {
    const prior = [row('2511', 'liability', -50, 'Bank Loans — Long-term')];
    const increased = [row('2511', 'liability', -70, 'Bank Loans — Long-term')];
    const increaseReport = makeCashFlow([], increased, prior);
    expect(lineByKey(increaseReport, 'proceedsBorrowings')?.amount).toBe(20);
    expect(lineByKey(increaseReport, 'repaymentBorrowings')?.amount).toBe(0);

    const decreased = [row('2511', 'liability', -30, 'Bank Loans — Long-term')];
    const decreaseReport = makeCashFlow([], decreased, prior);
    expect(lineByKey(decreaseReport, 'proceedsBorrowings')?.amount).toBe(0);
    expect(lineByKey(decreaseReport, 'repaymentBorrowings')?.amount).toBe(-20);
  });

  it('shows share capital increases and dividends/drawings as financing flows', () => {
    const prior = [
      row('3110', 'equity', -10, "Owner's Capital"),
      row('3600', 'equity', 0, 'Owner Drawings'),
    ];
    const current = [
      row('3110', 'equity', -30, "Owner's Capital"),
      row('3600', 'equity', 5, 'Owner Drawings'),
    ];
    const report = makeCashFlow([], current, prior);
    expect(lineByKey(report, 'capitalContributions')?.amount).toBe(20);
    expect(lineByKey(report, 'dividendsPaid')?.amount).toBe(-5);
  });

  it('reconciles beginning cash plus the net change to ending cash within one cent', () => {
    const prior = [row('1110', 'asset', 100, 'Cash on Hand')];
    const current = [row('1110', 'asset', 110, 'Cash on Hand')];
    const report = makeCashFlow([row('4110', 'income', -10, 'Sales')], current, prior, ['1110']);
    expect(report.cashBeginning).toBe(100);
    expect(report.netCashChange).toBe(10);
    expect(report.cashEnd).toBe(110);
    expect(report.isReconciled).toBe(true);
    expect(report.discrepancy).toBe(0);
  });

  it('reconciles the live-observed inventory purchase pattern against current-period P&L', () => {
    const periodRows = [row('5180', 'expense', -96_322_060.82, 'Inventory Adjustments & Shrinkage')];
    const prior = [
      row('1110', 'asset', 10_511_000.04, 'Cash on Hand'),
      row('1141', 'asset', 59_434_707, 'Raw Materials'),
    ];
    const current = [
      row('1110', 'asset', 10_511_000.04, 'Cash on Hand'),
      row('1141', 'asset', 155_756_767.82, 'Raw Materials'),
    ];
    const report = makeCashFlow(periodRows, current, prior, ['1110']);
    expect(lineByKey(report, 'netIncome')?.amount).toBe(96_322_060.82);
    expect(lineByKey(report, 'changeInInventory')?.amount).toBe(-96_322_060.82);
    expect(report.cashBeginning).toBe(10_511_000.04);
    expect(report.cashEnd).toBe(10_511_000.04);
    expect(report.netCashChange).toBe(0);
    expect(report.isReconciled).toBe(true);
  });

  it('flags a cash reconciliation discrepancy greater than one cent', () => {
    const report = makeCashFlow([], [row('1110', 'asset', 120, 'Cash on Hand')], [row('1110', 'asset', 100, 'Cash on Hand')], ['1110']);
    expect(report.isReconciled).toBe(false);
    expect(report.discrepancy).toBe(-20);
  });

  it('returns zero-valued sections for empty data and tolerates missing account types', () => {
    const empty = makeCashFlow();
    expect(empty.netCashChange).toBe(0);
    expect(empty.cashBeginning).toBe(0);
    expect(empty.cashEnd).toBe(0);
    expect(empty.isReconciled).toBe(true);
    expect(empty.sections.map((section) => section.total)).toEqual([0, 0, 0]);

    const missingTypes = [row('1110', '', 10, 'Cash on Hand'), row('3110', '', -10, 'Owner Capital')];
    expect(() => makeCashFlow([], missingTypes, [], ['1110'])).not.toThrow();
  });

  it('detects only cash asset accounts from the returned chart rows', () => {
    expect(detectCashAccountCodes([
      row('1110', 'asset', 0, 'Cash on Hand'),
      row('1125', 'asset', 0, 'Airtel Money Account'),
      row('1131', 'asset', 0, 'Trade Debtors'),
      row('2150', 'liability', 0, 'Bank Overdraft'),
    ])).toEqual(['1110', '1125']);
  });

  it('computes account-code deltas and validates the supported opening date', () => {
    const prior = computeBalanceSheet([row('1141', 'asset', 10, 'Raw Materials')], false);
    const current = computeBalanceSheet([row('1141', 'asset', 15, 'Raw Materials')], false);
    expect(bsDelta(current, prior, '114')).toBe(5);
    expect(CASH_FLOW_BALANCE_START_DATE).toBe('2020-01-01');
    expect(dayBefore('2026-10-01')).toBe('2026-09-30');
    expect(dayBefore('2026-03-01')).toBe('2026-02-28');
    expect(isValidCashFlowPeriod({ from: '2026-10-01', to: '2026-10-26' })).toBe(true);
    expect(isValidCashFlowPeriod({ from: '2019-12-31', to: '2026-10-26' })).toBe(false);
    expect(isValidCashFlowPeriod({ from: '2026-10-31', to: '2026-10-01' })).toBe(false);
  });
});
