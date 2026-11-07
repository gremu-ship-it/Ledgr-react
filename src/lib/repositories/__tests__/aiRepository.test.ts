import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/dal/types/database';
import { AiRepository } from '../aiRepository';

function makeClient(rows: Record<string, unknown[]> = {}, rpcResult = 0) {
  const from = vi.fn((table: string) => {
    const query: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'neq', 'is', 'gte', 'in', 'order', 'limit', 'update']) {
      query[method] = vi.fn(() => query);
    }
    query.range = vi.fn(async () => ({ data: rows[table] ?? [], error: null }));
    query.maybeSingle = vi.fn(async () => ({ data: rows[table]?.[0] ?? null, error: null }));
    query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve, reject);
    return query;
  });
  const rpc = vi.fn(async () => ({ data: rpcResult, error: null }));
  const auth = { getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })) };
  return { client: { from, rpc, auth } as unknown as SupabaseClient<Database>, from, rpc, auth };
}

describe('AiRepository', () => {
  it('loads business-scoped findings through its injected client', async () => {
    const anomaly = { id: 'anomaly-1', business_id: 'business-1', category: 'amount_outlier' };
    const { client, from } = makeClient({ ai_anomaly_logs: [anomaly] });
    const repository = new AiRepository(client);

    await expect(repository.getAnomalies('business-1')).resolves.toEqual([anomaly]);
    expect(from).toHaveBeenCalledWith('ai_anomaly_logs');
  });

  it('scans ledger sources using the injected client and sends deterministic findings to the protected RPC', async () => {
    const firstDate = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
    const secondDate = new Date().toISOString().slice(0, 10);
    const { client, from, rpc } = makeClient({
      expenses: [
        { id: 'expense-1', expense_number: 'EXP-1', expense_date: firstDate, total_amount: 250000, currency: 'MWK', contact_id: 'supplier-1' },
        { id: 'expense-2', expense_number: 'EXP-2', expense_date: secondDate, total_amount: 250000, currency: 'MWK', contact_id: 'supplier-2' },
      ],
      journal_entries: [],
      payroll_runs: [],
      contacts: [{ id: 'supplier-1', name: 'Mwayi Traders Ltd' }, { id: 'supplier-2', name: 'Mwayi Traders Limited' }],
    }, 1);
    const repository = new AiRepository(client);

    await expect(repository.runDiagnosticScan('business-1')).resolves.toEqual({ scanned: 1, created: 1, skippedExisting: 0 });
    expect(from).toHaveBeenCalledWith('expenses');
    expect(from).toHaveBeenCalledWith('journal_entries');
    expect(from).toHaveBeenCalledWith('payroll_runs');
    expect(rpc).toHaveBeenCalledWith('run_ai_anomaly_scan', expect.objectContaining({
      p_business_id: 'business-1',
      p_anomalies: expect.arrayContaining([expect.objectContaining({
        category: 'duplicate_invoice', source_table: 'expenses', source_id: 'expense-2', title: 'ai.anomalyTitles.duplicateInvoice',
      })]),
    }));
  });

  it('resolves a finding only for the authenticated user through the injected client', async () => {
    const query: Record<string, unknown> = {};
    for (const method of ['update', 'eq', 'select']) query[method] = vi.fn(() => query);
    query.maybeSingle = vi.fn(async () => ({ data: { id: 'anomaly-1', is_resolved: true }, error: null }));
    const { client, from, auth } = makeClient();
    (client as unknown as { from: unknown }).from = vi.fn(() => query);
    const repository = new AiRepository(client);

    await expect(repository.resolveAnomaly('anomaly-1', 'user-1')).resolves.toMatchObject({ id: 'anomaly-1', is_resolved: true });
    expect(auth.getUser).toHaveBeenCalledOnce();
    expect(from).not.toHaveBeenCalled();
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ is_resolved: true, resolved_by: 'user-1' }));
  });

  it('refuses to attribute resolution to a different user', async () => {
    const { client, from } = makeClient();
    const repository = new AiRepository(client);
    await expect(repository.resolveAnomaly('anomaly-1', 'forged-user')).rejects.toThrow(/authenticated session/);
    expect(from).not.toHaveBeenCalled();
  });
});
