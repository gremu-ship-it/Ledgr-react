import { describe, expect, it, vi } from 'vitest';
import { PartnerPortalRepository, type PartnerPortalClient } from '@/dal/repositories/PartnerPortalRepository';

function makeClient(result: { data?: unknown; error?: { message: string } | null }) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'limit', 'update', 'upsert']) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => result);
  builder.single = vi.fn(async () => result);
  builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  const from = vi.fn(() => builder);
  const rpc = vi.fn(async () => result);
  return { client: { from, rpc } as unknown as PartnerPortalClient, builder, from, rpc };
}

describe('PartnerPortalRepository', () => {
  it('loads a firm profile with the injected client', async () => {
    const row = {
      id: 'partner-1', name: 'Ledger & Co', slug: 'ledger', domain: null, custom_domain: null,
      logo_url: null, primary_colour: '#10B981', support_email: 'hello@example.test', support_phone: null,
      app_name: 'Ledger & Co', onboarding_title: null, onboarding_subtitle: null, client_limit: 50,
      allow_client_visibility: false, is_active: true, billing_email: null, billing_contact_name: null,
      price_per_client: 0, billing_currency: 'MWK', created_at: '2026-01-01T00:00:00Z', updated_at: null,
    };
    const { client, from } = makeClient({ data: row, error: null });
    const repository = new PartnerPortalRepository(client);

    const partner = await repository.getPartnerProfile('partner-1');

    expect(from).toHaveBeenCalledWith('partners');
    expect(partner?.name).toBe('Ledger & Co');
    expect(partner?.primary_colour).toBe('#10B981');
  });

  it('updates branding through its injected client', async () => {
    const row = {
      id: 'partner-1', name: 'New name', slug: null, domain: null, custom_domain: null, logo_url: null,
      primary_colour: '#123456', support_email: null, support_phone: null, app_name: 'New name',
      onboarding_title: null, onboarding_subtitle: null, client_limit: 10, allow_client_visibility: false,
      is_active: true, billing_email: null, billing_contact_name: null, price_per_client: 0,
      billing_currency: 'MWK', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
    };
    const { client, builder } = makeClient({ data: row, error: null });
    const repository = new PartnerPortalRepository(client);

    await repository.updatePartnerBranding('partner-1', { name: 'New name', primary_colour: '#123456' });

    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ name: 'New name', primary_colour: '#123456' }));
  });

  it('uses the injected client and maps partner health rows', async () => {
    const row = {
      partner_id: 'partner-1', business_id: 'business-1', business_name: 'Acme', plan_tier: 'growth',
      is_active: true, status: 'onboarding', notes: null, onboarded_at: '2026-12-01T00:00:00Z',
      journal_entry_count: 8, invoice_count: 3, pay_run_count: 1, total_activity_count: 12,
      user_count: 2, last_activity_at: null,
    };
    const { client, from } = makeClient({ data: [row], error: null });
    const repository = new PartnerPortalRepository(client);

    const result = await repository.getPartnerClients('partner-1');

    expect(from).toHaveBeenCalledWith('v_partner_client_usage');
    expect(result).toEqual([{
      ...row,
      status: 'onboarding',
      notes: null,
      total_activity_count: 12,
    }]);
  });

  it('links a client through the injected table client and leaves it onboarding', async () => {
    const { client, from, builder } = makeClient({ data: null, error: null });
    const repository = new PartnerPortalRepository(client);

    await repository.addPartnerClient('partner-1', 'business-1', 'Start onboarding');

    expect(from).toHaveBeenCalledWith('partner_clients');
    expect(builder.upsert).toHaveBeenCalledWith(expect.objectContaining({
      partner_id: 'partner-1',
      business_id: 'business-1',
      status: 'onboarding',
      notes: 'Start onboarding',
    }), { onConflict: 'partner_id,business_id', ignoreDuplicates: true });
  });

  it('clamps activity requests to the safe maximum', async () => {
    const { client, builder } = makeClient({ data: [], error: null });
    const repository = new PartnerPortalRepository(client);

    await repository.getClientActivity('partner-1', 500);

    expect(builder.limit).toHaveBeenCalledWith(100);
  });

  it('propagates repository errors to the caller', async () => {
    const { client } = makeClient({ data: null, error: { message: 'permission denied' } });
    const repository = new PartnerPortalRepository(client);

    await expect(repository.getPartnerClients('partner-1')).rejects.toThrow('permission denied');
  });
});
