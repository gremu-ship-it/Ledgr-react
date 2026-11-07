import { describe, expect, it, vi } from 'vitest';
import { seedDemoCompanyData, TARGET_DEMO_BUSINESS_ID } from '../demoSeederService';

vi.mock('@/lib/repositories', () => ({
  repos: new Proxy({}, {
    get() {
      throw new Error('A repository must not be accessed for a non-demo business.');
    },
  }),
}));

describe('seedDemoCompanyData tenant guard', () => {
  it('rejects any business other than the immutable demo target before repository access', async () => {
    await expect(seedDemoCompanyData('00000000-0000-0000-0000-000000000000'))
      .rejects.toThrow('Seeding is strictly prohibited on non-demo accounts.');
  });

  it('exports the dedicated Demo company Ltd business ID', () => {
    expect(TARGET_DEMO_BUSINESS_ID).toBe('d38e4ce8-324b-4d27-b42d-74c25c5288a7');
  });
});
