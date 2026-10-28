import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BankReconciliationRepository, type ImportBankStatementInput } from '../BankReconciliationRepository';

function rpcClient(result: { data: unknown; error: Error | null }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

const importInput: ImportBankStatementInput = {
  businessId: 'business-1',
  bankAccountId: 'bank-account-1',
  statementDate: '2026-01-31',
  periodStart: '2026-01-01',
  openingBalance: 100,
  closingBalance: 75,
  lines: [{
    transaction_date: '2026-01-15',
    description: 'Bank withdrawal',
    reference: 'REF-1',
    amount: -25,
    running_balance: 75,
  }],
};

describe('BankReconciliationRepository', () => {
  it('persists a fully validated statement through the atomic, idempotent import RPC', async () => {
    const { client, rpc } = rpcClient({ data: 'statement-id', error: null });

    await expect(BankReconciliationRepository.importStatement(client, importInput)).resolves.toBe('statement-id');
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith('import_bank_statement', {
      p_business_id: importInput.businessId,
      p_bank_account_id: importInput.bankAccountId,
      p_statement_date: importInput.statementDate,
      p_period_start: importInput.periodStart,
      p_opening_balance: importInput.openingBalance,
      p_closing_balance: importInput.closingBalance,
      p_lines: importInput.lines,
    });
  });

  it('surfaces import failures without a fallback client-side write', async () => {
    const failure = new Error('import rejected');
    const { client, rpc } = rpcClient({ data: null, error: failure });

    await expect(BankReconciliationRepository.importStatement(client, importInput)).rejects.toBe(failure);
    expect(rpc).toHaveBeenCalledOnce();
  });

  it('deletes a draft through the role-checked atomic delete RPC', async () => {
    const { client, rpc } = rpcClient({ data: null, error: null });

    await expect(BankReconciliationRepository.deleteStatement(client, 'business-1', 'statement-1')).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('delete_draft_bank_statement', {
      p_business_id: 'business-1',
      p_statement_id: 'statement-1',
    });
  });

  it('requests unreconciled GL lines for the selected business, account, and statement period', async () => {
    const line = { journal_line_id: 'line-1', amount: 25 };
    const { client, rpc } = rpcClient({ data: [line], error: null });

    await expect(BankReconciliationRepository.getUnreconciledGlLines(client, {
      businessId: 'business-1', bankAccountId: 'bank-account-1', dateFrom: '2026-01-01', dateTo: '2026-01-31',
    })).resolves.toEqual([line]);
    expect(rpc).toHaveBeenCalledWith('get_unreconciled_gl_lines', {
      p_business_id: 'business-1',
      p_bank_account_id: 'bank-account-1',
      p_date_from: '2026-01-01',
      p_date_to: '2026-01-31',
    });
  });
});
