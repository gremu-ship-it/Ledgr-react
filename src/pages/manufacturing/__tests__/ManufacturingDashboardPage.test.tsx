// @vitest-environment jsdom
/**
 * Manufacturing Phase A placeholder — the workspace surface.
 *
 * `react-i18next` is mocked with a translator that reads the real en.json, so
 * these assertions check the exact string the app publishes rather than a key
 * that could drift.
 *
 * The route-level capability gate (a business that never selected MANUFACTURING
 * cannot reach /manufacturing by URL) is asserted against App.tsx below, since
 * the gate lives in the router rather than in the page.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { useAppStore } from '@/store/useAppStore';
import { ManufacturingDashboardPage } from '@/pages/manufacturing/ManufacturingDashboardPage';

vi.mock('react-i18next', async () => {
  const translations = (await import('@/i18n/locales/en.json')).default as unknown as Record<string, unknown>;
  const lookup = (key: string): unknown =>
    key.split('.').reduce<unknown>(
      (value, part) => (value as Record<string, unknown> | undefined)?.[part],
      translations,
    );
  const t = (key: string) => {
    const value = lookup(key);
    return typeof value === 'string' ? value : key;
  };
  return { useTranslation: () => ({ t }) };
});

const MANUFACTURING_BUSINESS = {
  role: 'owner',
  business: {
    id: '30000000-0000-4000-8000-000000000001',
    name: 'Chirwa Engineering',
    organisation_type: 'FOR_PROFIT',
    operating_models: ['MANUFACTURING'],
  },
};

afterEach(() => cleanup());

function renderPage() {
  return render(
    <MemoryRouter>
      <ManufacturingDashboardPage />
    </MemoryRouter>,
  );
}

describe('ManufacturingDashboardPage', () => {
  it('renders the translated coming-soon message, not a hardcoded string', () => {
    useAppStore.setState({ currentBusiness: MANUFACTURING_BUSINESS as never });
    renderPage();

    const en = JSON.parse(
      readFileSync('src/i18n/locales/en.json', 'utf8'),
    ) as { manufacturing: { comingSoon: string; title: string } };

    expect(screen.getByText(en.manufacturing.comingSoon)).toBeTruthy();
    expect(en.manufacturing.comingSoon).toBe('Manufacturing features coming soon');
    expect(screen.getByText(en.manufacturing.title)).toBeTruthy();
  });

  it('shows the selected business name', () => {
    useAppStore.setState({ currentBusiness: MANUFACTURING_BUSINESS as never });
    renderPage();
    expect(screen.getByText('Chirwa Engineering')).toBeTruthy();
  });

  it('makes no data request — this is a foundation surface with no repository call', () => {
    // The page imports no repository and issues no query; the placeholder must
    // not imply production data that does not exist yet.
    const source = readFileSync('src/pages/manufacturing/ManufacturingDashboardPage.tsx', 'utf8');
    expect(source).not.toMatch(/repos\./);
    expect(source).not.toMatch(/useQuery/);
    expect(source).not.toMatch(/supabase/);
  });
});

describe('the /manufacturing route is capability gated', () => {
  it('wraps the page in the same organisation capability gate as /construction', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    const route = app.match(
      /<Route\s+path="\/manufacturing"[\s\S]*?<\/CapabilityGate>\s*\}\s*\/>/,
    );
    expect(route?.[0]).toBeTruthy();
    expect(route?.[0]).toContain('<CapabilityGate capability="manufacturing">');
    expect(route?.[0]).toContain('<ManufacturingDashboardPage />');
  });

  it('does not change any existing URL — /construction and /pos keep their paths', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).toContain('path="/construction/*"');
    expect(app).toContain('path="/pos"');
    expect(app).toContain('path="/products"');
  });
});
