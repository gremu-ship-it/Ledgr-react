import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BankReconciliationRepository } from '../BankReconciliationRepository';

const result = (data: unknown = null, error: Error | null = null) => ({ data, error });
function rpcClient(response = result()) {
  const rpc = vi.fn().mockResolvedValue(response);
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe('Bank reconciliation matching repository', () => {
  it('creates several manual or automatic partial allocations atomically', async () => {
    const { client, rpc } = rpcClient(result(2));
    await BankReconciliationRepository.bulkCreateMatches(client, 'business-1', 'statement-1', [
      { bankLineId: 'bank-1', glLineId: 'gl-60', matchedAmount: 60_000, isAutoMatch: false },
      { bankLineId: 'bank-1', glLineId: 'gl-40', matchedAmount: 40_000, isAutoMatch: false },
    ]);
    expect(rpc).toHaveBeenCalledWith('create_bank_reconciliation_matches', {
      p_business_id: 'business-1',
      p_statement_id: 'statement-1',
      p_matches: [
        { statement_line_id: 'bank-1', journal_line_id: 'gl-60', matched_amount: 60_000, is_auto_match: false },
        { statement_line_id: 'bank-1', journal_line_id: 'gl-40', matched_amount: 40_000, is_auto_match: false },
      ],
    });
  });

  it('deletes an individual match through the guarded RPC', async () => {
    const { client, rpc } = rpcClient();
    await BankReconciliationRepository.deleteMatch(client, 'business-1', 'match-1');
    expect(rpc).toHaveBeenCalledWith('delete_bank_reconciliation_match', {
      p_business_id: 'business-1', p_match_id: 'match-1',
    });
  });

  it('marks and admin-unmarks statements through dedicated status RPCs', async () => {
    const { client, rpc } = rpcClient();
    await BankReconciliationRepository.reconcileStatement(client, 'business-1', 'statement-1');
    await BankReconciliationRepository.unreconcileStatement(client, 'business-1', 'statement-1');
    expect(rpc).toHaveBeenNthCalledWith(1, 'reconcile_bank_statement', {
      p_business_id: 'business-1', p_statement_id: 'statement-1',
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'unreconcile_bank_statement', {
      p_business_id: 'business-1', p_statement_id: 'statement-1',
    });
  });

  it('returns an error when the server rejects a match or status transition', async () => {
    const failure = new Error('locked');
    const { client } = rpcClient(result(null, failure));
    await expect(BankReconciliationRepository.deleteMatch(client, 'business-1', 'match-1')).rejects.toBe(failure);
  });
});
