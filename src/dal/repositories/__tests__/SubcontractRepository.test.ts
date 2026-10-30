import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/database';
import { SubcontractRepository } from '../SubcontractRepository';

function resultBuilder(result: { data?: unknown; error?: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'insert', 'update']) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn().mockResolvedValue(result);
  builder.maybeSingle = vi.fn().mockResolvedValue(result);
  builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function repositoryWith(client: object) {
  return new SubcontractRepository(client as SupabaseClient<Database>);
}

const PROFILE = {
  id: 'profile-1',
  business_id: 'business-1',
  contact_id: 'contact-1',
  trade: 'Electrical',
  license_number: 'EL-100',
  license_expiry: null,
  insurance_provider: 'ACME Insurance',
  insurance_policy_number: null,
  insurance_expiry: '2027-01-01',
  compliance_notes: null,
  safety_rating: 'A',
  preferred: false,
  is_active: true,
  created_at: '2026-10-28T10:00:00Z',
  updated_at: '2026-10-28T10:00:00Z',
  contact: {
    id: 'contact-1',
    name: 'Bright Wire Ltd',
    contact_type: 'supplier',
    email: 'work@example.com',
    phone: null,
    address_line1: null,
    address_line2: null,
    city: null,
    country: null,
    tpin: null,
    vat_number: null,
  },
};

const AGREEMENT = {
  id: 'agreement-1',
  business_id: 'business-1',
  project_id: 'project-1',
  subcontractor_profile_id: 'profile-1',
  reference: 'SUB-001',
  title: 'Electrical installation',
  description: null,
  scope_of_work: 'Install wiring',
  contract_value: 250000,
  currency: 'MWK',
  retention_percentage: 5,
  status: 'draft',
  start_date: null,
  end_date: null,
  defects_liability_months: 12,
  payment_terms: null,
  notes: null,
  created_at: '2026-10-28T10:00:00Z',
  updated_at: '2026-10-28T10:00:00Z',
  created_by: null,
};

describe('SubcontractRepository', () => {
  it('lists profiles within the selected business, applying trade and text filters to the joined contact', async () => {
    const builder = resultBuilder({ data: [PROFILE], error: null });
    const from = vi.fn(() => builder);
    const repository = repositoryWith({ from });

    await expect(repository.listSubcontractorProfiles('business-1', {
      trade: 'Electrical',
      search: 'BRIGHT',
    })).resolves.toEqual([PROFILE]);
    expect(from).toHaveBeenCalledWith('subcontractor_profiles');
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'business-1');
    expect(builder.eq).toHaveBeenCalledWith('trade', 'Electrical');
    expect(builder.select).toHaveBeenCalledWith('*, contact:contacts!inner(*)');
  });

  it('creates construction profiles without duplicating contact identity', async () => {
    const builder = resultBuilder({ data: { id: 'profile-1' }, error: null });
    const from = vi.fn(() => builder);
    const repository = repositoryWith({ from });

    await expect(repository.createSubcontractorProfile('business-1', {
      contact_id: 'contact-1',
      trade: 'Electrical',
      preferred: true,
    })).resolves.toBe('profile-1');
    expect(from).toHaveBeenCalledWith('subcontractor_profiles');
    expect(builder.insert).toHaveBeenCalledWith({
      business_id: 'business-1', contact_id: 'contact-1', trade: 'Electrical', preferred: true,
    });
  });

  it('lists project agreements with typed contact and project joins and tenant filters', async () => {
    const builder = resultBuilder({ data: [{
      ...AGREEMENT,
      subcontractor_profile: { id: 'profile-1', trade: 'Electrical', is_active: true, contact: PROFILE.contact },
      project: { id: 'project-1', name: 'Clinic extension', status: 'active' },
    }], error: null });
    const from = vi.fn(() => builder);
    const repository = repositoryWith({ from });

    await expect(repository.listSubcontracts('business-1', 'project-1')).resolves.toMatchObject([{
      id: 'agreement-1',
      subcontractor_profile: { contact: { name: 'Bright Wire Ltd' } },
      project: { name: 'Clinic extension' },
    }]);
    expect(from).toHaveBeenCalledWith('subcontracts');
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'business-1');
    expect(builder.eq).toHaveBeenCalledWith('project_id', 'project-1');
    expect(builder.select).toHaveBeenCalledWith(expect.stringContaining('project:construction_projects'));
  });

  it('creates agreements in the explicit business/project scope', async () => {
    const builder = resultBuilder({ data: { id: 'agreement-1' }, error: null });
    const from = vi.fn(() => builder);
    const repository = repositoryWith({ from });

    await expect(repository.createSubcontract('business-1', {
      project_id: 'project-1',
      subcontractor_profile_id: 'profile-1',
      reference: 'SUB-001',
      title: 'Electrical installation',
      contract_value: 250000,
    })).resolves.toBe('agreement-1');
    expect(from).toHaveBeenCalledWith('subcontracts');
    expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({
      business_id: 'business-1', project_id: 'project-1', subcontractor_profile_id: 'profile-1',
    }));
  });

  it('updates only the selected agreement in its business and leaves lifecycle checks to the database', async () => {
    const builder = resultBuilder({ data: { id: 'agreement-1' }, error: null });
    const from = vi.fn(() => builder);
    const repository = repositoryWith({ from });

    await expect(repository.updateSubcontractStatus('business-1', 'agreement-1', 'active')).resolves.toBeUndefined();
    expect(builder.update).toHaveBeenCalledWith({ status: 'active' });
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'business-1');
    expect(builder.eq).toHaveBeenCalledWith('id', 'agreement-1');
  });
});
