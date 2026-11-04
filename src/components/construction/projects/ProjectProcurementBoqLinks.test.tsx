// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { i18n } from '@/i18n';

const construction = vi.hoisted(() => ({
  findPurchaseOrders: vi.fn(),
  findPurchaseOrderLines: vi.fn(),
  findProjectPurchaseOrderBoqLinks: vi.fn(),
  setProjectPurchaseOrderBoqLink: vi.fn(),
}));
const projects = vi.hoisted(() => ({
  listBoqVersions: vi.fn(),
  getBoqVersion: vi.fn(),
}));
const inventory = vi.hoisted(() => ({ findAllProducts: vi.fn() }));

vi.mock('@/lib/repositories', () => ({ repos: { construction, projects, inventory } }));

import { ProjectProcurementBoqLinks } from './ProjectProcurementBoqLinks';

const businessId = 'business-1';
const projectId = 'project-1';

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return render(<ProjectProcurementBoqLinks businessId={businessId} projectId={projectId} capabilities={['procurement.po.manage']} />, { wrapper: Wrapper });
}

beforeEach(() => {
  void i18n.changeLanguage('en');
  Object.values(construction).forEach((mock) => mock.mockReset());
  Object.values(projects).forEach((mock) => mock.mockReset());
  inventory.findAllProducts.mockReset();
  construction.findPurchaseOrders.mockResolvedValue([{
    id: 'po-1', po_number: 'PO-1', status: 'draft',
  }]);
  construction.findPurchaseOrderLines.mockResolvedValue([{
    id: 'line-1', po_id: 'po-1', line_number: 1, product_id: 'product-1',
    line_note: 'Portland cement', quantity_ordered: 10, uom: 'BAG',
  }]);
  construction.findProjectPurchaseOrderBoqLinks.mockResolvedValue([]);
  construction.setProjectPurchaseOrderBoqLink.mockResolvedValue({ id: 'link-1' });
  projects.listBoqVersions.mockResolvedValue([{ id: 'boq-1', status: 'active' }]);
  projects.getBoqVersion.mockResolvedValue({
    id: 'boq-1',
    status: 'active',
    sections: [{
      id: 'section-1',
      items: [{
        id: 'item-1', item_number: 'A.01', description: 'Concrete works',
        quantity: 10, unit_of_measure: 'm3', product_id: 'product-1',
      }],
      children: [],
    }],
  });
  inventory.findAllProducts.mockResolvedValue([{ id: 'product-1', name: 'Portland cement' }]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('project purchase-order BOQ links', () => {
  it('shows existing project PO lines and saves a BOQ mapping via the existing repository command', async () => {
    renderPanel();
    const select = await screen.findByRole('combobox', { name: 'BOQ item for purchase-order line 1' }) as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    expect(screen.getByText('PO-1 · Line 1')).toBeTruthy();
    expect(screen.getByRole('option', { name: /A\.01 · Concrete works/ })).toBeTruthy();

    fireEvent.change(select, { target: { value: 'item-1' } });
    await waitFor(() => expect(construction.setProjectPurchaseOrderBoqLink).toHaveBeenCalledWith({
      businessId,
      projectId,
      purchaseOrderLineId: 'line-1',
      boqItemId: 'item-1',
    }));
  });
});
