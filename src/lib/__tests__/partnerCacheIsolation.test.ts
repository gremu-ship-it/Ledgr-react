import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');

describe('partner cache minimisation', () => {
  it('persists branding only, not the full commercial partner row', () => {
    const provider = readFileSync(resolve(root, 'src/partner/PartnerProvider.tsx'), 'utf8');
    const persistedBlock = provider.slice(
      provider.indexOf('const value: BrandingCache'),
      provider.indexOf("window.localStorage.setItem(CACHE_KEY"),
    );
    expect(persistedBlock).toContain('branding: brandingFor(partner)');
    expect(persistedBlock).not.toContain('billing_email');
    expect(persistedBlock).not.toContain('price_per_client');
  });

  it('uses a public-field projection for host-based partner resolution', () => {
    const repository = readFileSync(resolve(root, 'src/dal/repositories/PartnerRepository.ts'), 'utf8');
    const columns = repository.slice(
      repository.indexOf('const PUBLIC_PARTNER_COLUMNS'),
      repository.indexOf('type PartnerRowInput'),
    );
    expect(columns).not.toContain('billing_email');
    expect(columns).not.toContain('billing_contact_name');
    expect(columns).not.toContain('price_per_client');
  });
});
