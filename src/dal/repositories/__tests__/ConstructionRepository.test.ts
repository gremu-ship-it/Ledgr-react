import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/database';
import { ConstructionRepository } from '../ConstructionRepository';

function resultBuilder(result: { data?: unknown; error?: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'insert', 'update', 'delete']) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn().mockResolvedValue(result);
  builder.maybeSingle = vi.fn().mockResolvedValue(result);
  builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function repositoryWith(client: object) {
  return new ConstructionRepository(client as SupabaseClient<Database>);
}

const PROJECT = {
  id: 'project-1',
  business_id: 'business-1',
  name: 'School block',
  client_name: 'District Council',
  contract_sum: 500000,
  retention_pct: 5,
  budget: 420000,
  status: 'draft',
  start_date: null,
  end_date: null,
  created_by: 'user-1',
  created_at: '2026-10-20T10:00:00Z',
  updated_at: '2026-10-20T10:00:00Z',
  boq_locked_at: null,
  client_id: null,
};

describe('ConstructionRepository', () => {
  it('reads project records within the selected business', async () => {
    const builder = resultBuilder({ data: [PROJECT], error: null });
    const from = vi.fn(() => builder);
    const repository = repositoryWith({ from });

    await expect(repository.listProjects('business-1')).resolves.toEqual([PROJECT]);
    expect(from).toHaveBeenCalledWith('construction_projects');
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'business-1');
    expect(builder.order).toHaveBeenCalledWith('updated_at', { ascending: false });
  });

  it('creates a persisted project through the existing capability-checked command', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: PROJECT, error: null });
    const repository = repositoryWith({ rpc });
    const input = {
      name: ' School block ',
      client_name: ' District Council ',
      contract_sum: 500000,
      retention_pct: 5,
      budget: 420000,
      start_date: null,
      end_date: null,
    };

    await expect(repository.createProject('business-1', input)).resolves.toEqual(PROJECT);
    expect(rpc).toHaveBeenCalledWith('create_project', expect.objectContaining({
      p_business_id: 'business-1',
      p_name: 'School block',
      p_client_name: 'District Council',
      p_client_id: null,
    }));
  });

  it('keeps a site location optional and scopes the new site to its project and business', async () => {
    const site = {
      id: 'site-1',
      business_id: 'business-1',
      project_id: 'project-1',
      name: 'North campus',
      location_id: null,
      address: 'Chirimba',
      created_at: '2026-10-20T10:00:00Z',
      updated_at: '2026-10-20T10:00:00Z',
    };
    const builder = resultBuilder({ data: site, error: null });
    const from = vi.fn(() => builder);
    const repository = repositoryWith({ from });

    await expect(repository.createSite('business-1', 'project-1', {
      name: ' North campus ',
      location_id: null,
      address: ' Chirimba ',
    })).resolves.toEqual(site);
    expect(from).toHaveBeenCalledWith('construction_sites');
    expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({
      business_id: 'business-1',
      project_id: 'project-1',
      name: 'North campus',
      location_id: null,
      address: 'Chirimba',
    }));
  });

  it('uses the status command for lifecycle changes rather than a direct status update', async () => {
    const updated = { ...PROJECT, status: 'active' };
    const rpc = vi.fn().mockResolvedValue({ data: updated, error: null });
    const repository = repositoryWith({ rpc });

    await expect(repository.transitionProjectStatus('project-1', 'active', 'approved')).resolves.toEqual(updated);
    expect(rpc).toHaveBeenCalledWith('set_construction_project_status', {
      p_project_id: 'project-1',
      p_new_status: 'active',
      p_reason: 'approved',
    });
  });
});
