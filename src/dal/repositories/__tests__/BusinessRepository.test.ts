import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/database';
import { BusinessRepository } from '../BusinessRepository';

const rpc = vi.fn();
const repository = new BusinessRepository({ rpc } as unknown as SupabaseClient<Database>);

describe('construction COA provisioning', () => {
  it('calls the separate idempotent Retention Receivable provision command', async () => {
    rpc.mockResolvedValue({ data: 'account-id', error: null });
    await repository.provisionConstructionCoaAccounts('business-1');
    expect(rpc).toHaveBeenCalledWith('provision_construction_coa_accounts', {
      p_business_id: 'business-1',
    });
  });

  it('surfaces provisioning failures through the repository error boundary', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Account code range exhausted.' } });
    await expect(repository.provisionConstructionCoaAccounts('business-1'))
      .rejects.toThrow('Account code range exhausted.');
  });
});
