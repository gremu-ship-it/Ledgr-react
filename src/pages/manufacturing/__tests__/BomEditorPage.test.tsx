// @vitest-environment jsdom
import '@/i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { BomEditorPage } from '../BomEditorPage';

const api = vi.hoisted(() => ({
  saveVersion: vi.fn(),
  activateVersion: vi.fn(),
  newVersion: vi.fn(),
  getVersionTree: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/repositories', () => ({
  repos: { bom: {
    saveVersion: api.saveVersion,
    activateVersion: api.activateVersion,
    newVersion: api.newVersion,
    getVersionTree: api.getVersionTree,
  } },
}));
vi.mock('@/lib/supabase', () => ({ supabase: { from: api.from, rpc: api.rpc } }));
vi.mock('@/components/billing/PlanGate', () => ({ PlanGate: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/billing/CapabilityGate', () => ({ CapabilityGate: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/hooks/useCapability', () => ({ useCapability: () => true }));
vi.mock('@/store/useAppStore', () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector({ currentBusiness: { business: { id: 'business-1' } } }),
}));

const products = [
  { id: 'finished-1', business_id: 'business-1', name: 'Finished pack', product_type: 'finished_good', unit_of_measure: 'ea', purchase_price: 0, cost_price: 0 },
  { id: 'material-1', business_id: 'business-1', name: 'Steel sheet', product_type: 'raw_material', unit_of_measure: 'kg', purchase_price: 10, cost_price: 10 },
  { id: 'wip-1', business_id: 'business-1', name: 'Inner assembly', product_type: 'wip', unit_of_measure: 'ea', purchase_price: 0, cost_price: 0 },
];
const boms = [
  { id: 'bom-wip-v1', business_id: 'business-1', product_id: 'wip-1', version: 1, status: 'active', bom_locked_at: null, notes: null },
];

function configureQueries() {
  api.from.mockImplementation((table: string) => {
    const filters: Array<(row: Record<string, unknown>) => boolean> = [];
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = (column: string, value: unknown) => { filters.push((row) => row[column] === value); return builder; };
    builder.neq = (column: string, value: unknown) => { filters.push((row) => row[column] !== value); return builder; };
    builder.order = () => builder;
    const rows = () => (table === 'products' ? products : table === 'manufacturing_boms' ? boms : [])
      .filter((row) => filters.every((filter) => filter(row as unknown as Record<string, unknown>)));
    builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
    return builder;
  });
}

function renderNewBom() {
  return render(
    <MemoryRouter initialEntries={['/manufacturing/bom/new']}>
      <Routes><Route path="/manufacturing/bom/new" element={<BomEditorPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  configureQueries();
  api.rpc.mockResolvedValue({ data: 25, error: null });
  api.getVersionTree.mockReset();
  api.saveVersion.mockResolvedValue('bom-saved');
  api.activateVersion.mockResolvedValue({ id: 'bom-saved' });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('multi-level BOM editor', () => {
  it('saves raw materials and a nested BOM with per-output-unit quantities through the repository', async () => {
    renderNewBom();
    fireEvent.change(await screen.findByTestId('output-product-select'), { target: { value: 'finished-1' } });

    fireEvent.click(screen.getByTestId('add-component-button'));
    fireEvent.change(await screen.findByTestId('line-0-component'), { target: { value: 'material-1' } });
    fireEvent.change(screen.getByTestId('line-0-quantity'), { target: { value: '2.5' } });

    fireEvent.click(screen.getByTestId('add-subassembly-button'));
    fireEvent.change(screen.getByTestId('line-1-component'), { target: { value: 'bom-wip-v1' } });
    fireEvent.change(screen.getByTestId('line-1-quantity'), { target: { value: '3' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save draft version' }));
    await waitFor(() => expect(api.saveVersion).toHaveBeenCalledWith({
      businessId: 'business-1', bomId: null, productId: 'finished-1', notes: null,
      components: [
        expect.objectContaining({ component_product_id: 'material-1', component_bom_id: null, quantity: 2.5, unit_of_measure: 'kg' }),
        expect.objectContaining({ component_product_id: null, component_bom_id: 'bom-wip-v1', quantity: 3 }),
      ],
    }));
  });

  it('localizes cycle errors returned by the database save command', async () => {
    api.saveVersion.mockRejectedValue({ code: '23514', message: 'BOM cycle detected: sub-assembly would create a circular reference' });
    renderNewBom();
    fireEvent.change(await screen.findByTestId('output-product-select'), { target: { value: 'finished-1' } });
    fireEvent.click(screen.getByTestId('add-subassembly-button'));
    fireEvent.change(screen.getByTestId('line-0-component'), { target: { value: 'bom-wip-v1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft version' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Adding this sub-assembly would create a circular BOM reference.');
  });
});
