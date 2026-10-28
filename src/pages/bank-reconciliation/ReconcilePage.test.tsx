// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ReconcilePage } from './ReconcilePage';
import type { BankStatement, BankStatementLine, ReconciliationGlLine } from '@/dal/repositories/BankReconciliationRepository';

const mocks = vi.hoisted(() => ({
  getStatement: vi.fn(),
  getStatementLines: vi.fn(),
  getMatchesForStatement: vi.fn(),
  getReconciliationGlLines: vi.fn(),
  getBookBalance: vi.fn(),
  bulkCreateMatches: vi.fn(),
  deleteMatch: vi.fn(),
  reconcileStatement: vi.fn(),
  unreconcileStatement: vi.fn(),
}));

vi.mock('@/dal/repositories/BankReconciliationRepository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/dal/repositories/BankReconciliationRepository')>();
  return {
    ...actual,
    BankReconciliationRepository: {
      ...actual.BankReconciliationRepository,
      ...mocks,
    },
  };
});
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/hooks/usePermissions', () => ({ usePermissions: () => ({ canWrite: true, canDelete: true }) }));
vi.mock('@/store/useAppStore', () => ({
  useAppStore: (selector: (state: { currentBusiness: { business: { id: string } } }) => unknown) => selector({ currentBusiness: { business: { id: 'business-1' } } }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-MW' } }) }));

const statement: BankStatement = {
  id: 'statement-1', business_id: 'business-1', account_id: 'coa-1', bank_account_id: 'bank-account-1',
  bank_name: 'NBS Bank', account_number: '12345678', account_code: '1124', account_name: 'Bank Current Account',
  statement_date: '2026-01-31', period_start: '2026-01-01', opening_balance: 0, closing_balance: 100_000,
  total_deposits: 100_000, total_withdrawals: 0, line_count: 1, status: 'draft', created_at: '2026-01-31T12:00:00Z', source: 'csv_import',
};
const bankLines: BankStatementLine[] = [{
  id: 'bank-line-1', statement_id: 'statement-1', transaction_date: '2026-01-15', description: 'Customer deposit',
  reference: 'DEP-1', amount: 100_000, running_balance: 100_000, is_reconciled: false,
}];
const glLines: ReconciliationGlLine[] = [
  { id: 'gl-line-60', entry_date: '2026-01-15', description: 'Deposit part one', entry_number: 'JE-60', is_debit: true, amount: 60_000, account_id: 'coa-1', matchedAmount: 0 },
  { id: 'gl-line-40', entry_date: '2026-01-15', description: 'Deposit part two', entry_number: 'JE-40', is_debit: true, amount: 40_000, account_id: 'coa-1', matchedAmount: 0 },
];

function renderReconcilePage(status: 'draft' | 'reconciled' = 'draft') {
  mocks.getStatement.mockResolvedValue({ ...statement, status });
  mocks.getStatementLines.mockResolvedValue(bankLines);
  mocks.getMatchesForStatement.mockResolvedValue([]);
  mocks.getReconciliationGlLines.mockResolvedValue(glLines);
  mocks.getBookBalance.mockResolvedValue(100_000);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/bank-reconciliation/reconcile/statement-1']}>
        <Routes><Route path="/bank-reconciliation/reconcile/:statementId" element={<ReconcilePage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ReconcilePage', () => {
  it('creates a partial one-bank-to-many-GL manual match', async () => {
    mocks.bulkCreateMatches.mockResolvedValue(undefined);
    renderReconcilePage();

    fireEvent.click(await screen.findByRole('button', { name: /Customer deposit/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Deposit part one/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Deposit part two/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'bankReconciliation.reconcile.manualMatch' }));

    await waitFor(() => expect(mocks.bulkCreateMatches).toHaveBeenCalledOnce());
    expect(mocks.bulkCreateMatches.mock.calls[0][3]).toEqual([
      { bankLineId: 'bank-line-1', glLineId: 'gl-line-60', matchedAmount: 60_000, isAutoMatch: false },
      { bankLineId: 'bank-line-1', glLineId: 'gl-line-40', matchedAmount: 40_000, isAutoMatch: false },
    ]);
  });

  it('disables match mutations for reconciled statements and offers admin unreconcile', async () => {
    renderReconcilePage('reconciled');
    expect(await screen.findByText('bankReconciliation.reconcile.locked')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'bankReconciliation.reconcile.autoMatch' }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: 'bankReconciliation.reconcile.unmatch' })).toBeNull();
    expect(screen.getByRole('button', { name: 'bankReconciliation.reconcile.unreconcile' })).toBeTruthy();
  });
});
