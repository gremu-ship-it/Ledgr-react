import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@/dal/repositories/ProjectRepository';

const transitionStatus = vi.fn();

vi.mock('@/lib/repositories', () => ({
  repos: { projects: { transitionStatus: (...args: unknown[]) => transitionStatus(...args) } },
}));

const { ensureSeededProjectActive } = await import('../demoSeederService');

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
    business_id: 'business-1',
    name: 'Capital Commercial Tower',
    client_name: 'Demo Test Customer',
    client_id: 'contact-1',
    contract_sum: 150_000_000,
    retention_pct: 10,
    budget: 150_000_000,
    start_date: '2026-01-01',
    end_date: '2027-01-01',
    status: 'tender',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Project;
}

describe('ensureSeededProjectActive', () => {
  beforeEach(() => {
    transitionStatus.mockReset();
  });

  it('advances a newly created (tender) project to active before valuations attach', async () => {
    const active = project({ status: 'active' });
    transitionStatus.mockResolvedValue(active);

    await expect(ensureSeededProjectActive(project())).resolves.toBe(active);
    expect(transitionStatus).toHaveBeenCalledWith(
      'project-1',
      'active',
      expect.any(String),
    );
  });

  it('leaves an already active project untouched so re-runs stay idempotent', async () => {
    const active = project({ status: 'active' });

    await expect(ensureSeededProjectActive(active)).resolves.toBe(active);
    expect(transitionStatus).not.toHaveBeenCalled();
  });

  it('refuses to seed progress data onto a project past active', async () => {
    await expect(
      ensureSeededProjectActive(project({ status: 'practical_completion' })),
    ).rejects.toThrow(/requires an active project/i);
    expect(transitionStatus).not.toHaveBeenCalled();
  });
});
