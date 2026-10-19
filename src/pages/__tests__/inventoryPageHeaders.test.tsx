// @vitest-environment jsdom
//
// Bug A regression tests: the three Supply Chain page headers were hardcoded
// English, so a construction business that clicked "Materials" in the sidebar
// landed on a page titled "Products & Inventory". The pages now resolve their
// headers through useInventoryPageLabels, the same organisation predicate the
// sidebar override uses.
//
// `react-i18next` is mocked with a translator that reads the real en.json, so
// every assertion below checks the exact string the app publishes — key
// drift fails here, not in production.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { useAppStore } from '@/store/useAppStore';
import en from '@/i18n/locales/en.json';

vi.mock('@tanstack/react-query', () => ({
  // The transfer detail drawer is rendered whenever `selectedDetail` is
  // truthy and destructures `{ transfer, lines }` from it, so the detail
  // query stays undefined (drawer closed) while list queries get [].
  useQuery: (options?: { queryKey?: unknown[] }) =>
    options?.queryKey?.[0] === 'transfer_detail'
      ? { data: undefined, isLoading: false }
      : { data: [], isLoading: false },
  useMutation: () => ({ mutate: () => {}, mutateAsync: async () => {}, isPending: false }),
  useQueryClient: () => ({ invalidateQueries: () => {} }),
}));

vi.mock('react-i18next', async () => {
  const translations = (await import('@/i18n/locales/en.json')).default as unknown as Record<string, unknown>;
  const lookup = (key: string): unknown =>
    key.split('.').reduce<unknown>(
      (value, part) => (value as Record<string, unknown> | undefined)?.[part],
      translations,
    );
  const t = (key: string, opts?: Record<string, unknown>) => {
    const value = lookup(key);
    if (typeof value !== 'string') return key;
    if (!opts) return value;
    return value.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
      opts[name] !== undefined ? String(opts[name]) : `{{${name}}}`);
  };
  return { useTranslation: () => ({ t }) };
});

import { ProductsPage } from '@/pages/ProductsPage';
import { WarehousePage } from '@/pages/WarehousePage';
import { TransfersPage } from '@/pages/TransfersPage';
import { InventoryPage } from '@/pages/InventoryPage';
import { inventoryPageLabelKeys } from '@/hooks/useInventoryPageLabels';

const RETAIL = { organisation_type: 'FOR_PROFIT', operating_models: ['RETAIL'] };
const CONSTRUCTION = { organisation_type: 'FOR_PROFIT', operating_models: ['CONSTRUCTION'] };
const MANUFACTURING = { organisation_type: 'FOR_PROFIT', operating_models: ['MANUFACTURING'] };

const BUSINESS_NAME = 'Chirwa Build';

function selectBusiness(profile: Record<string, unknown> | undefined) {
  useAppStore.setState({
    currentBusiness: {
      role: 'owner',
      business: {
        id: '10000000-0000-0000-0000-000000000001',
        name: BUSINESS_NAME,
        base_currency: 'MWK',
        ...(profile ?? {}),
      },
    } as never,
  });
}

function renderPage(node: React.ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

beforeEach(() => {
  // The organisation layer decides pos/inventory defaults; the construction
  // vocabulary itself is ALWAYS_PROFILE_GATED and ignores the switch.
  vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  useAppStore.setState({ currentBusiness: null as never });
});

describe('supply chain page headers for a construction business', () => {
  it('titles the products page "Materials" and uses the site subtitle', () => {
    selectBusiness(CONSTRUCTION);
    renderPage(<ProductsPage />);
    expect(screen.getByRole('heading', { name: 'Materials' })).toBeTruthy();
    expect(screen.getByText('Materials and supplies across all sites')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Products & Inventory' })).toBeNull();
  });

  it('titles the warehouse page "Site Stores"', () => {
    selectBusiness(CONSTRUCTION);
    renderPage(<WarehousePage />);
    expect(screen.getByRole('heading', { name: 'Site Stores' })).toBeTruthy();
    expect(screen.getByText('Stock levels across all sites')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Warehouse' })).toBeNull();
  });

  it('titles the transfers page "Material Transfers"', () => {
    selectBusiness(CONSTRUCTION);
    renderPage(<TransfersPage />);
    expect(screen.getByRole('heading', { name: 'Material Transfers' })).toBeTruthy();
    expect(screen.getByText('Material movements between sites')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Stock Transfers' })).toBeNull();
  });

  it('does not leak the business name into the construction subtitle', () => {
    // The {{businessName}} interpolation belongs to the retail products
    // subtitle only; the site-language subtitles are static strings.
    selectBusiness(CONSTRUCTION);
    renderPage(<ProductsPage />);
    expect(screen.queryByText(new RegExp(BUSINESS_NAME))).toBeNull();
  });
});

describe('supply chain page headers for a manufacturing business', () => {
  it('uses the same Materials, Site Stores and Material Transfers vocabulary as the sidebar', () => {
    selectBusiness(MANUFACTURING);
    const products = renderPage(<ProductsPage />);
    expect(screen.getByRole('heading', { name: 'Materials' })).toBeTruthy();
    products.unmount();

    renderPage(<WarehousePage />);
    expect(screen.getByRole('heading', { name: 'Site Stores' })).toBeTruthy();
    cleanup();

    renderPage(<TransfersPage />);
    expect(screen.getByRole('heading', { name: 'Material Transfers' })).toBeTruthy();
  });
});

describe('supply chain page headers for a non-construction business', () => {
  it('keeps the products page exactly as before, business name included', () => {
    selectBusiness(RETAIL);
    renderPage(<ProductsPage />);
    expect(screen.getByRole('heading', { name: 'Products & Inventory' })).toBeTruthy();
    expect(
      screen.getByText(`Manage products, stock levels, and movements for ${BUSINESS_NAME}`),
    ).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Materials' })).toBeNull();
  });

  it('keeps the warehouse page exactly as before', () => {
    selectBusiness(RETAIL);
    renderPage(<WarehousePage />);
    expect(screen.getByRole('heading', { name: 'Warehouse' })).toBeTruthy();
    expect(screen.getByText('Stock levels across all locations')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Site Stores' })).toBeNull();
  });

  it('keeps the transfers page exactly as before', () => {
    selectBusiness(RETAIL);
    renderPage(<TransfersPage />);
    expect(screen.getByRole('heading', { name: 'Stock Transfers' })).toBeTruthy();
    expect(screen.getByText('Dispatch stock between warehouse and branches')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Material Transfers' })).toBeNull();
  });

  it('keeps the default vocabulary even with the organisation layer off', () => {
    // The kill switch must never change vocabulary: construction resolves
    // from the profile regardless, and a retail business keeps the defaults.
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', '');
    selectBusiness(RETAIL);
    renderPage(<ProductsPage />);
    expect(screen.getByRole('heading', { name: 'Products & Inventory' })).toBeTruthy();
  });

  it('still swaps to site language for construction with the layer off', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', '');
    selectBusiness(CONSTRUCTION);
    renderPage(<ProductsPage />);
    expect(screen.getByRole('heading', { name: 'Materials' })).toBeTruthy();
  });
});

describe('the /inventory alias route', () => {
  it('renders its own placeholder page, not ProductsPage — so no override applies', () => {
    // The spec's alias fix was conditional on the alias rendering
    // ProductsPage; it renders the legacy "Coming soon" placeholder instead,
    // so the vocabulary swap belongs to the three real pages only.
    selectBusiness(CONSTRUCTION);
    renderPage(<InventoryPage />);
    expect(screen.getByRole('heading', { name: 'Inventory' })).toBeTruthy();
    expect(screen.getByText('Coming soon.')).toBeTruthy();
  });
});

describe('inventory page label key resolution', () => {
  it('maps every page to its default and construction key pairs', () => {
    expect(inventoryPageLabelKeys('products', false)).toEqual({
      titleKey: 'pages.inventory.products.title',
      subtitleKey: 'pages.inventory.products.subtitle',
    });
    expect(inventoryPageLabelKeys('products', true)).toEqual({
      titleKey: 'pages.inventory.materials.title',
      subtitleKey: 'pages.inventory.materials.subtitle',
    });
    expect(inventoryPageLabelKeys('warehouse', true)).toEqual({
      titleKey: 'pages.inventory.siteStores.title',
      subtitleKey: 'pages.inventory.siteStores.subtitle',
    });
    expect(inventoryPageLabelKeys('transfers', true)).toEqual({
      titleKey: 'pages.inventory.materialTransfers.title',
      subtitleKey: 'pages.inventory.materialTransfers.subtitle',
    });
  });

  it('publishes every header string in en.json — no hardcoded English left behind', () => {
    const pages = en.pages.inventory;
    expect(pages.products.title).toBe('Products & Inventory');
    expect(pages.products.subtitle)
      .toBe('Manage products, stock levels, and movements for {{businessName}}');
    expect(pages.warehouse.title).toBe('Warehouse');
    expect(pages.warehouse.subtitle).toBe('Stock levels across all locations');
    expect(pages.transfers.title).toBe('Stock Transfers');
    expect(pages.transfers.subtitle).toBe('Dispatch stock between warehouse and branches');
    expect(pages.materials.title).toBe('Materials');
    expect(pages.materials.subtitle).toBe('Materials and supplies across all sites');
    expect(pages.siteStores.title).toBe('Site Stores');
    expect(pages.siteStores.subtitle).toBe('Stock levels across all sites');
    expect(pages.materialTransfers.title).toBe('Material Transfers');
    expect(pages.materialTransfers.subtitle).toBe('Material movements between sites');
    expect(en.navigation.fab.stockMovement).toBe('Stock movement');
    expect(en.navigation.fab.materialMovement).toBe('Material movement');
  });

  it('keeps the construction subtitles in step with the sidebar vocabulary', () => {
    // The page subtitles reuse the sidebar's own words so the two surfaces
    // can never disagree about what a business calls its stock locations.
    expect(en.pages.inventory.materials.title).toBe(en.navigation.items.materials);
    expect(en.pages.inventory.siteStores.title).toBe(en.navigation.items.siteStores);
    expect(en.pages.inventory.materialTransfers.title).toBe(en.navigation.items.materialTransfers);
  });
});
