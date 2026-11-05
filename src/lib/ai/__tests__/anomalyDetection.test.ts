import { describe, expect, it } from 'vitest';
import { calculateZScore, detectLedgerAnomalies, supplierNameSimilarity, type AnomalyScanInput } from '../anomalyDetection';

const emptyInput = (): AnomalyScanInput => ({
  expenses: [], expenseLines: [], journalEntries: [], journalLines: [], payrollRuns: [],
});

describe('deterministic ledger anomaly detection', () => {
  it('uses sample z-scores only when there is enough non-constant history', () => {
    expect(calculateZScore(100, [10, 11, 12])).toBeNull();
    expect(calculateZScore(100, [10, 10, 10, 10, 10])).toBeNull();
    expect(calculateZScore(100, [10, 11, 9, 12, 8])).toMatchObject({ mean: 10, score: expect.any(Number) });
  });

  it('fuzzy-matches minor supplier-name differences without treating unrelated names as duplicates', () => {
    expect(supplierNameSimilarity('Mwayi Traders Ltd', 'Mwayi-Traders Limited')).toBeGreaterThanOrEqual(0.72);
    expect(supplierNameSimilarity('Mwayi Traders', 'Northern Motors')).toBeLessThan(0.72);
  });

  it('detects a same-supplier same-amount expense within seven days and points at the later record', () => {
    const input = emptyInput();
    input.expenses = [
      { id: 'expense-1', expense_number: 'EXP-1', expense_date: '2026-10-01', total_amount: 250000, currency: 'MWK', contact_id: 'supplier-1', supplier_name: 'Mwayi Traders Ltd' },
      { id: 'expense-2', expense_number: 'EXP-2', expense_date: '2026-10-07', total_amount: 250000, currency: 'MWK', contact_id: 'supplier-2', supplier_name: 'Mwayi Traders Limited' },
      { id: 'expense-3', expense_number: 'EXP-3', expense_date: '2026-10-08', total_amount: 250000, currency: 'MWK', contact_id: 'supplier-3', supplier_name: 'Northern Motors' },
    ];

    const findings = detectLedgerAnomalies(input);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ category: 'duplicate_invoice', source_table: 'expenses', source_id: 'expense-2', severity: 'high' });
    expect(findings[0].title).toBe('ai.anomalyTitles.duplicateInvoice');
  });

  it('flags missing tax codes and only flags missing cost centers on accounts that normally allocate them', () => {
    const input = emptyInput();
    input.expenseLines = [{ id: 'line-1', expense_id: 'expense-1', line_total: 100, tax_amount: 17.5, tax_code: 'none' }];
    input.journalEntries = [{ id: 'entry-1', entry_date: '2026-10-01', entry_number: 'JE-1', description: 'Supplies' }];
    input.journalLines = [
      ...[100, 110, 120, 130].map((amount, index) => ({ id: `allocated-${index}`, journal_entry_id: `entry-${index}`, account_id: 'acct-1', account_name: 'Office costs', amount_base: amount, is_debit: true, department_id: `dept-${index}`, tax_amount: 0, tax_code: 'none' })),
      { id: 'unallocated', journal_entry_id: 'entry-1', account_id: 'acct-1', account_name: 'Office costs', amount_base: 120, is_debit: true, department_id: null, tax_amount: 0, tax_code: 'none' },
      { id: 'tax-missing', journal_entry_id: 'entry-1', account_id: 'acct-2', account_name: 'Tax expense', amount_base: 100, is_debit: true, department_id: null, tax_amount: 15, tax_code: 'none' },
    ];

    const findings = detectLedgerAnomalies(input);
    expect(findings.some((item) => item.category === 'missing_tax_tag' && item.source_table === 'expense_lines' && item.source_id === 'line-1')).toBe(true);
    expect(findings.some((item) => item.category === 'unallocated_cost_center' && item.source_id === 'entry-1')).toBe(true);
    expect(findings.filter((item) => item.category === 'missing_tax_tag' && item.source_table === 'journal_entries')).toHaveLength(1);
  });

  it('uses statistical outlier scoring for posted journal and completed payroll amounts', () => {
    const input = emptyInput();
    input.journalEntries = Array.from({ length: 6 }, (_, index) => ({ id: `je-${index}`, entry_date: '2026-10-01', entry_number: `JE-${index}`, description: 'Expense' }));
    input.journalLines = [100, 110, 95, 105, 90, 1000].map((amount, index) => ({
      id: `jl-${index}`, journal_entry_id: `je-${index}`, account_id: 'acct-1', account_name: 'Expenses', amount_base: amount, is_debit: true, department_id: null, tax_amount: 0, tax_code: 'none',
    }));
    input.payrollRuns = [100, 101, 99, 102, 98, 500].map((amount, index) => ({
      id: `pay-${index}`, pay_date: '2026-10-01', run_number: `RUN-${index}`, total_gross: amount,
    }));

    const findings = detectLedgerAnomalies(input);
    expect(findings.find((item) => item.category === 'amount_outlier' && item.source_id === 'je-5')?.severity).toBe('high');
    expect(findings.find((item) => item.category === 'payroll_variance' && item.source_id === 'pay-5')?.severity).toBe('high');
  });
});
