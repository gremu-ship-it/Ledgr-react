import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/database';
import { PayrollRepository } from '../PayrollRepository';

describe('PayrollRepository dashboard query', () => {
  it('fetches only the nearest approved future payroll commitment', async () => {
    const row = { id: 'run-1', pay_date: '2026-11-12', total_net: 125000, status: 'approved' };
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ['select', 'eq', 'gte', 'order', 'limit']) {
      chain[method] = vi.fn(() => chain);
    }
    chain.maybeSingle = vi.fn(async () => ({ data: row, error: null }));
    const from = vi.fn(() => chain);
    const repository = new PayrollRepository({ from } as unknown as SupabaseClient<Database>);

    const result = await repository.findNextApproved('business-1', '2026-11-06');

    expect(result).toEqual(row);
    expect(from).toHaveBeenCalledWith('payroll_runs');
    expect(chain.select).toHaveBeenCalledWith('id, pay_date, total_net, status');
    expect(chain.eq).toHaveBeenNthCalledWith(1, 'business_id', 'business-1');
    expect(chain.eq).toHaveBeenNthCalledWith(2, 'status', 'approved');
    expect(chain.gte).toHaveBeenCalledWith('pay_date', '2026-11-06');
    expect(chain.order).toHaveBeenCalledWith('pay_date', { ascending: true });
    expect(chain.limit).toHaveBeenCalledWith(1);
  });
});
