import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ReportRepository } from '../ReportRepository';

const row = {
  account_id: 'account-1',
  account_code: '1000',
  account_name: 'Cash',
  account_type: 'asset',
  parent_account_id: null,
  total_debit: 1250,
  total_credit: 0,
  balance: 1250,
  level: 0,
};

describe('ReportRepository.getTrialBalance', () => {
  it('calls the additive RPC with the requested scope and date range', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [row], error: null });
    const client = { rpc } as unknown as SupabaseClient;

    await expect(ReportRepository.getTrialBalance(client, {
      businessId: 'business-1',
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
      branchId: 'branch-1',
    })).resolves.toEqual([row]);

    expect(rpc).toHaveBeenCalledWith('get_trial_balance', {
      p_business_id: 'business-1',
      p_date_from: '2026-01-01',
      p_date_to: '2026-01-31',
      p_branch_id: 'branch-1',
    });
  });

  it('passes a null branch for all-branch reports and propagates RPC errors', async () => {
    const failure = new Error('Access denied');
    const rpc = vi.fn().mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: null, error: failure });
    const client = { rpc } as unknown as SupabaseClient;
    const params = { businessId: 'business-1', dateFrom: '2026-01-01', dateTo: '2026-01-31' };

    await expect(ReportRepository.getTrialBalance(client, params)).resolves.toEqual([]);
    expect(rpc).toHaveBeenLastCalledWith('get_trial_balance', {
      p_business_id: params.businessId,
      p_date_from: params.dateFrom,
      p_date_to: params.dateTo,
      p_branch_id: null,
    });
    await expect(ReportRepository.getTrialBalance(client, params)).rejects.toBe(failure);
  });
});
