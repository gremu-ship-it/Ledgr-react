import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { seedDemoCompanyData, stableDemoClientKey, TARGET_DEMO_BUSINESS_ID } from '../demoSeederService';
import { isUuid } from '@/lib/clientKeys';

const source = readFileSync('src/services/demoSeederService.ts', 'utf8');

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

  it('derives stable UUID client keys for every seeded command category', () => {
    const identities = [
      ['STOCK', '01'],
      ['INV', '001'],
      ['INV-PAY', '001'],
      ['EXP', '001'],
      ['EXP-PAY', '001'],
      ['POS', '001'],
      ['PO', '01'],
      ['GRN', '01'],
    ] as const;
    const keys = identities.map(([kind, id]) => stableDemoClientKey(kind, id));

    expect(keys.every(isUuid)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
    identities.forEach(([kind, id], index) => {
      expect(stableDemoClientKey(kind, id)).toBe(keys[index]);
    });
  });

  it('keeps stock references readable while passing the derived UUID as the idempotency key', () => {
    const ensureStock = source.slice(source.indexOf('async function ensureStock('), source.indexOf('async function seedInvoices('));
    expect(ensureStock).toContain("stableReference('STOCK', stockId)");
    expect(ensureStock).toContain('reference,');
    expect(ensureStock).toContain("} as InsertDto<'stock_movements'>, clientKey);");
    expect(ensureStock).not.toContain('reference: clientKey');
    expect(ensureStock).not.toContain('deriveClientKey(clientKey)');
  });
});
