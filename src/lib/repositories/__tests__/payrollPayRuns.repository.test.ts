import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/dal/types/database';
import { PayrollRepository } from '@/lib/repositories/payroll.repository';

describe('PayrollRepository pay-run workflow methods', () => {
  it('finds a pay run by tenant and exact period using the injected client', async () => {
    const query = {
      select: vi.fn(function (this: unknown) { return this; }),
      eq: vi.fn(function (this: unknown) { return this; }),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'run-1', status: 'calculated' }, error: null }),
    };
    const client = { from: vi.fn(() => query) } as unknown as SupabaseClient<Database>;
    const repository = new PayrollRepository(client);

    await expect(repository.getPayRunByPeriod('business-1', '2026-10-01', '2026-10-31'))
      .resolves.toEqual({ id: 'run-1', status: 'calculated' });
    expect(client.from).toHaveBeenCalledWith('pay_runs');
    expect(query.eq).toHaveBeenNthCalledWith(1, 'business_id', 'business-1');
    expect(query.eq).toHaveBeenNthCalledWith(2, 'period_start', '2026-10-01');
    expect(query.eq).toHaveBeenNthCalledWith(3, 'period_end', '2026-10-31');
  });

  it('approves only a calculated run and keeps the update tenant-scoped', async () => {
    const query = {
      update: vi.fn(function (this: unknown) { return this; }),
      eq: vi.fn(function (this: unknown) { return this; }),
      select: vi.fn(function (this: unknown) { return this; }),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'run-1', status: 'approved' }, error: null }),
    };
    const client = { from: vi.fn(() => query) } as unknown as SupabaseClient<Database>;
    const repository = new PayrollRepository(client);

    await expect(repository.approvePayRun('business-1', 'run-1')).resolves.toEqual({ id: 'run-1', status: 'approved' });
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved', approved_at: expect.any(String), updated_at: expect.any(String) }));
    expect(query.eq).toHaveBeenCalledWith('business_id', 'business-1');
    expect(query.eq).toHaveBeenCalledWith('id', 'run-1');
    expect(query.eq).toHaveBeenCalledWith('status', 'calculated');
  });

  it('calls the reversal RPC and does not construct a client-side journal reversal', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: 'reversed', reversalJournalEntryId: 'journal-reversal-1' }, error: null });
    const client = { rpc } as unknown as SupabaseClient<Database>;
    const repository = new PayrollRepository(client);

    await expect(repository.reversePayRun('run-1')).resolves.toEqual({ status: 'reversed', reversalJournalEntryId: 'journal-reversal-1' });
    expect(rpc).toHaveBeenCalledWith('reverse_pay_run', { p_pay_run_id: 'run-1' });
    expect(client).not.toHaveProperty('from');
  });
});
