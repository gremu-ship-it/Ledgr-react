// @vitest-environment jsdom
import '@/i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { BomVersionTree } from '@/dal/repositories/BomRepository';
import type { Row } from '@/dal/types/database';
import { BomEditorPage } from '../BomEditorPage';

const uiState = vi.hoisted(() => ({ role: 'owner' }));
const api = vi.hoisted(() => ({
  listBoms: vi.fn(),
  listVersions: vi.fn(),
  getVersionTree: vi.fn(),
  saveVersion: vi.fn(),
  activateVersion: vi.fn(),
  findAllProducts: vi.fn(),
}));

vi.mock('@/lib/repositories', () => ({
  repos: {
    bom: {
      listBoms: api.listBoms,
      listVersions: api.listVersions,
      getVersionTree: api.getVersionTree,
      saveVersion: api.saveVersion,
      activateVersion: api.activateVersion,
    },
    inventory: { findAllProducts: api.findAllProducts },
  },
}));
vi.mock('@/store/useAppStore', () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector({ currentBusiness: { business: { id: 'business-1' }, role: uiState.role } }),
}));

const product = {
  id: 'product-1', business_id: 'business-1', name: 'Steel sheet', sku: 'MAT-1',
  unit_of_measure: 'kg', product_type: 'product', is_active: true,
} as Row<'products'>;
const productOutput = {
  id: 'product-fg', business_id: 'business-1', name: 'Finished pack', sku: 'FG-1',
  unit_of_measure: 'ea', product_type: 'product', is_active: true,
} as Row<'products'>;
const header = (id: string, code: string, name: string, productId: string): Row<'boms'> => ({
  id, business_id: 'business-1', code, name, product_id: productId, description: null,
  unit_of_measure: 'ea', is_active: true, created_by: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
});
const version = (id: string, bomId: string, status: string, number = 1): Row<'bom_versions'> => ({
  id, business_id: 'business-1', bom_id: bomId, version_number: number, version_label: null,
  status, effective_from: status === 'active' ? '2026-01-01' : null, effective_to: null,
  notes: null, created_by: null, created_at: '2026-01-01T00:00:00Z',
});
const component = (
  id: string,
  versionId: string,
  productId: string | null,
  subassemblyId: string | null,
  quantity: number,
): Row<'bom_components'> => ({
  id, business_id: 'business-1', bom_version_id: versionId,
  component_product_id: productId, component_bom_version_id: subassemblyId,
  quantity, unit_of_measure: productId ? 'kg' : 'ea', scrap_percentage: 0,
  sort_order: 0, notes: null, created_at: '2026-01-01T00:00:00Z',
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><MemoryRouter><BomEditorPage /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  uiState.role = 'owner';
  api.listBoms.mockResolvedValue([]);
  api.listVersions.mockResolvedValue([]);
  api.getVersionTree.mockReset();
  api.saveVersion.mockResolvedValue('version-saved');
  api.activateVersion.mockResolvedValue(version('version-1', 'bom-1', 'active'));
  api.findAllProducts.mockResolvedValue([product, productOutput]);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); uiState.role = 'owner'; });

describe('BOM editor', () => {
  it('creates a BOM with a raw component using quantity per one output unit', async () => {
    const savedBom = header('bom-saved', 'FG-NEW', 'New finished pack', productOutput.id);
    const savedVersion = version('version-saved', savedBom.id, 'draft');
    api.getVersionTree.mockResolvedValue({
      ...savedVersion, bom: savedBom,
      components: [{
        ...component('component-saved', savedVersion.id, product.id, null, 2.5),
        product: { id: product.id, name: product.name, sku: product.sku, unit_of_measure: product.unit_of_measure },
        subassembly: null,
      }],
    } satisfies BomVersionTree);

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'New BOM' }));
    fireEvent.change(screen.getByLabelText('BOM code'), { target: { value: 'FG-NEW' } });
    fireEvent.change(screen.getByLabelText('BOM name'), { target: { value: 'New finished pack' } });
    fireEvent.change(screen.getByLabelText('Output product'), { target: { value: productOutput.id } });
    fireEvent.click(screen.getByRole('button', { name: 'Add component' }));
    fireEvent.change(await screen.findByLabelText('Select a product'), { target: { value: product.id } });
    fireEvent.change(screen.getByLabelText('Quantity per output unit'), { target: { value: '2.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to BOM' }));

    expect(await screen.findByText('Steel sheet', { selector: 'p' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft version' }));
    await waitFor(() => expect(api.saveVersion).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1', bomId: null, code: 'FG-NEW',
      components: [expect.objectContaining({
        component_product_id: product.id, component_bom_version_id: null, quantity: 2.5, unit_of_measure: 'kg',
      })],
    })));
    expect((await screen.findByRole('status')).textContent).toContain('Draft version saved.');
  });

  it('expands a saved multi-level assembly to show nested components', async () => {
    const root = header('bom-root', 'FG-ROOT', 'Root pack', productOutput.id);
    const child = header('bom-child', 'SUB-1', 'Inner assembly', productOutput.id);
    const active = version('version-root', root.id, 'active');
    const nested = version('version-child', child.id, 'active');
    api.listBoms.mockResolvedValue([{ ...root, versions: [active] }]);
    api.listVersions.mockImplementation(async (_businessId: string, bomId: string) => bomId === root.id ? [active] : [nested]);
    api.getVersionTree.mockResolvedValue({
      ...active,
      bom: root,
      components: [{
        ...component('component-root', active.id, null, nested.id, 1),
        product: null,
        subassembly: {
          ...nested,
          bom: child,
          components: [{
            ...component('component-leaf', nested.id, product.id, null, 3),
            product: { id: product.id, name: product.name, sku: product.sku, unit_of_measure: product.unit_of_measure },
            subassembly: null,
          }],
        },
      }],
    } satisfies BomVersionTree);

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /FG-ROOT/ }));
    const expand = await screen.findByRole('button', { name: 'Expand sub-assembly' });
    fireEvent.click(expand);
    expect(await screen.findByText('Steel sheet', { selector: 'p' })).toBeTruthy();
    expect(screen.getByLabelText('Quantity per output unit: Steel sheet')).toHaveProperty('disabled', true);
  });

  it('keeps read-only roles from creating or changing BOM versions', async () => {
    uiState.role = 'viewer';
    const root = header('bom-root', 'FG-ROOT', 'Root pack', productOutput.id);
    const active = version('version-root', root.id, 'active');
    api.listBoms.mockResolvedValue([{ ...root, versions: [active] }]);
    api.listVersions.mockResolvedValue([active]);
    api.getVersionTree.mockResolvedValue({ ...active, bom: root, components: [] } satisfies BomVersionTree);

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /FG-ROOT/ }));
    expect(await screen.findByLabelText('BOM code')).toHaveProperty('disabled', true);
    expect(screen.queryByRole('button', { name: 'New BOM' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New version' })).toBeNull();
  });

  it('shows a localized cycle message when the save RPC rejects a circular sub-assembly', async () => {
    const child = header('bom-child', 'SUB-1', 'Nested pack', productOutput.id);
    const childVersion = version('version-child', child.id, 'active');
    api.listBoms.mockResolvedValue([{ ...child, versions: [childVersion] }]);
    api.listVersions.mockResolvedValue([childVersion]);
    api.saveVersion.mockRejectedValue({ code: '23514', message: 'BOM cycle detected: version references itself' });

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'New BOM' }));
    fireEvent.change(screen.getByLabelText('BOM code'), { target: { value: 'FG-CYCLE' } });
    fireEvent.change(screen.getByLabelText('BOM name'), { target: { value: 'Cycle test' } });
    fireEvent.change(screen.getByLabelText('Output product'), { target: { value: productOutput.id } });
    fireEvent.click(screen.getByRole('button', { name: 'Add sub-assembly' }));
    fireEvent.change(await screen.findByLabelText('Select a sub-assembly BOM'), { target: { value: child.id } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to BOM' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft version' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Cannot add Nested pack as a sub-assembly: it would create a circular reference.',
    );
  });
});
