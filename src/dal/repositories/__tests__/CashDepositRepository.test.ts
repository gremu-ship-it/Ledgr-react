import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/dal/types/database';
import { CashDepositRepository } from '../CashDepositRepository';

const asClient = (value: unknown) => value as SupabaseClient<Database>;

describe('CashDepositRepository', () => {
  it('posts through the transactional cash-deposit RPC and returns the journal id', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'journal-1', error: null });
    const repository = new CashDepositRepository(asClient({ rpc }));

    await expect(repository.post('deposit-1')).resolves.toBe('journal-1');
    expect(rpc).toHaveBeenCalledWith('post_cash_deposit', { p_deposit_id: 'deposit-1' });
  });

  it('saves the draft header and all source lines in one RPC call', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'deposit-1', error: null });
    const from = vi.fn(() => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ single: async () => ({ data: { id: 'deposit-1', business_id: 'business-1', status: 'draft' }, error: null }) }),
        }),
      }),
    }));
    const repository = new CashDepositRepository(asClient({ rpc, from }));

    await expect(repository.createDraft({
      business_id: 'business-1', deposit_date: '2026-12-01', bank_account_id: 'bank-1', reference: 'DEP-1',
    }, [{ source_account_id: 'cash-1', amount: 30 }])).resolves.toMatchObject({ id: 'deposit-1' });
    expect(rpc).toHaveBeenCalledWith('save_cash_deposit_draft', expect.objectContaining({
      p_business_id: 'business-1',
      p_deposit_id: null,
      p_bank_account_id: 'bank-1',
      p_lines: [{ source_account_id: 'cash-1', amount: 30 }],
    }));
  });

  it('requires a non-empty reason and forwards a trimmed reason when reversing', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'reversal-1', error: null });
    const repository = new CashDepositRepository(asClient({ rpc }));

    await expect(repository.voidAndReverse('deposit-1', '   ')).rejects.toThrow(/reason is required/i);
    expect(rpc).not.toHaveBeenCalled();

    await expect(repository.voidAndReverse('deposit-1', '  Duplicate deposit  ')).resolves.toBe('reversal-1');
    expect(rpc).toHaveBeenCalledWith('void_cash_deposit', { p_deposit_id: 'deposit-1', p_reason: 'Duplicate deposit' });
  });

  it('rejects empty or non-positive source lines before making database writes', async () => {
    const from = vi.fn();
    const repository = new CashDepositRepository(asClient({ from }));
    const input = { business_id: 'business-1', deposit_date: '2026-12-01', bank_account_id: 'bank-1' };

    await expect(repository.createDraft(input, [])).rejects.toThrow(/at least one source line/i);
    await expect(repository.createDraft(input, [{ source_account_id: 'cash-1', amount: 0 }])).rejects.toThrow(/positive amount/i);
    expect(from).not.toHaveBeenCalled();
  });
});
