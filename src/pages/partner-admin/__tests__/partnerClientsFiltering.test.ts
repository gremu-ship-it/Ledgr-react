import { describe, expect, it } from 'vitest';
import { filterPartnerClients } from '@/lib/partner/filterPartnerClients';
import type { PartnerClientUsage } from '@/types/partners';

const clients: PartnerClientUsage[] = [
  {
    partner_id: 'p-1', business_id: 'b-1', business_name: 'Acme Retail', plan_tier: 'growth', is_active: true,
    status: 'active', notes: null, onboarded_at: '2026-12-01', journal_entry_count: 10, invoice_count: 2,
    pay_run_count: 0, total_activity_count: 12, user_count: 3, last_activity_at: null,
  },
  {
    partner_id: 'p-1', business_id: 'b-2', business_name: 'North Manufacturing', plan_tier: 'starter', is_active: true,
    status: 'onboarding', notes: null, onboarded_at: '2026-12-02', journal_entry_count: 0, invoice_count: 0,
    pay_run_count: 0, total_activity_count: 0, user_count: 1, last_activity_at: null,
  },
];

describe('filterPartnerClients', () => {
  it('combines case-insensitive name search with status and plan filters', () => {
    expect(filterPartnerClients(clients, 'ACME', 'active', 'growth').map((client) => client.business_id)).toEqual(['b-1']);
    expect(filterPartnerClients(clients, 'north', 'onboarding', 'starter').map((client) => client.business_id)).toEqual(['b-2']);
  });

  it('matches business identifiers and treats missing plans as free', () => {
    const noPlan = { ...clients[0], business_id: 'business-token', plan_tier: null };
    expect(filterPartnerClients([noPlan], 'token', 'all', 'free')).toEqual([noPlan]);
  });
});
