// @vitest-environment jsdom
/**
 * Business scoping in the construction workspace — switching business.
 *
 * Every construction read is member-scoped by the database, so what a screen may
 * show is ultimately decided by the server. What this suite checks is the part the
 * server cannot decide for the screen: that a screen which was showing business A's
 * purchase order stops showing it once the operator switches to business B, instead
 * of leaving the previous business's procurement documents on screen (with live
 * action controls) until something happens to refresh them.
 *
 * It is a UI-scoping check only. It says nothing about authorisation: a mocked
 * repository proves nothing about the database, and the depth of the guarantee
 * here is that the *reads* are re-issued for the business that is now selected.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';

const construction = vi.hoisted(() => ({
  findCapabilities: vi.fn(),
  findSites: vi.fn(),
  findPurchaseOrders: vi.fn(),
  findPurchaseOrderLines: vi.fn(),
  findPurchaseOrderEvents: vi.fn(),
  findDeliveryNotes: vi.fn(),
  findReceipts: vi.fn(),
  findReceiptLines: vi.fn(),
  findPostingPolicy: vi.fn(),
  findSupplierBillLines: vi.fn(),
  findSupplierInvoiceReferences: vi.fn(),
  findAllocationsForBusiness: vi.fn(),
  createPurchaseOrder: vi.fn(),
}));

vi.mock('@/lib/repositories', () => ({
  repos: {
    construction,
    contact: { findByBusiness: vi.fn(async () => []) },
    branch: { findByBusiness: vi.fn(async () => []), findLocations: vi.fn(async () => []) },
    inventory: { findAllProducts: vi.fn(async () => []), findBalancesByLocation: vi.fn(async () => []) },
    expense: { findByBusiness: vi.fn(async () => []) },
  },
}));

import { ConstructionWorkspacePage } from '@/pages/construction/ConstructionWorkspacePage';
import { useAppStore } from '@/store/useAppStore';

const BUSINESS_A = '10000000-0000-0000-0000-00000000000a';
const BUSINESS_B = '10000000-0000-0000-0000-00000000000b';

const PO_A = {
  id: 'po-a',
  business_id: BUSINESS_A,
  branch_id: 'br-1',
  site_id: 'site-1',
  project_ref: 'PRJ-A',
  supplier_contact_id: 'sup-1',
  po_number: 'PO-AAA-001',
  currency: 'MWK',
  status: 'draft',
  notes: null,
  created_by: 'u1',
  created_at: '2026-10-16T08:00:00Z',
  authorized_by: null,
  authorized_at: null,
  cancelled_by: null,
  cancelled_at: null,
  cancel_reason: null,
};

function renderWorkspace(entry: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 }, mutations: { retry: false } },
  });
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(<ConstructionWorkspacePage />, { wrapper: Wrapper });
}

function business(id: string, name: string) {
  return { role: 'owner', business: { id, name, base_currency: 'MWK' } } as never;
}

beforeEach(() => {
  Object.values(construction).forEach((mock) => mock.mockReset());
  construction.findCapabilities.mockResolvedValue(['procurement.po.manage']);
  construction.findSites.mockResolvedValue([]);
  construction.findPurchaseOrderLines.mockResolvedValue([]);
  construction.findPurchaseOrderEvents.mockResolvedValue([]);
  construction.findDeliveryNotes.mockResolvedValue([]);
  construction.findReceipts.mockResolvedValue([]);
  construction.findReceiptLines.mockResolvedValue([]);
  construction.findPostingPolicy.mockResolvedValue(null);
  construction.findSupplierBillLines.mockResolvedValue([]);
  construction.findSupplierInvoiceReferences.mockResolvedValue([]);
  construction.findAllocationsForBusiness.mockResolvedValue([]);
  // Business A holds the purchase order; business B holds none.
  construction.findPurchaseOrders.mockImplementation(async (businessId: string) => (businessId === BUSINESS_A ? [PO_A] : []));
  useAppStore.setState({ currentUser: { id: 'u1', email: 'owner@example.com' }, currentBusiness: business(BUSINESS_A, 'Business A') });
});

afterEach(cleanup);

describe('Construction workspace — business scoping', () => {
  it('stops showing the previous business purchase order, and re-reads, after a business switch', async () => {
    renderWorkspace('/construction/purchase-orders?po=po-a');
    expect(await screen.findByText('PO-AAA-001')).toBeTruthy();

    await act(async () => {
      useAppStore.setState({ currentBusiness: business(BUSINESS_B, 'Business B') });
    });

    // The previous business's document is gone rather than left on screen with
    // its action controls.
    expect(screen.queryAllByText('PO-AAA-001')).toHaveLength(0);
    // And the reads really were re-issued for the business now selected: the deep
    // link is not a way to keep reading the other business's procurement records.
    expect(construction.findPurchaseOrders).toHaveBeenCalledWith(BUSINESS_B);
    expect(await screen.findByText(/not visible to you in this business/i)).toBeTruthy();
  });

  it('does not carry a purchase order from one business into the list of another', async () => {
    renderWorkspace('/construction/purchase-orders');
    expect(await screen.findByText('PO-AAA-001')).toBeTruthy();

    await act(async () => {
      useAppStore.setState({ currentBusiness: business(BUSINESS_B, 'Business B') });
    });

    expect(screen.queryAllByText('PO-AAA-001')).toHaveLength(0);
    // Business B genuinely has no purchase order, so the list is empty — not stale.
    expect(await screen.findByText(/no purchase orders/i)).toBeTruthy();
  });

  it('names the business the workspace is currently operating in', async () => {
    renderWorkspace('/construction/purchase-orders');
    expect(await screen.findByText(/Business A ·/)).toBeTruthy();

    // The header follows the selection, so an operator can see which business an
    // action would be recorded against.
    fireEvent.click(screen.getByRole('link', { name: /Overview/i }));
    expect(await screen.findByText(/Business A ·/)).toBeTruthy();
  });
});
