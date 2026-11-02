// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { CashDepositsPage } from '../CashDepositsPages';

const mocks = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock('@/dal/repositories/CashDepositRepository', () => ({
  CashDepositRepository: class {
    list = mocks.list;
  },
}));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/store/useAppStore', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    currentBusiness: { business: { id: 'business-1' }, role: 'owner' },
    currentUser: { id: 'user-1' },
  }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><CashDepositsPage /></MemoryRouter></QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  mocks.list.mockReset();
});

describe('CashDepositsPage', () => {
  it('shows fetched deposits, their aggregate amount, status, and the create route', async () => {
    mocks.list.mockResolvedValue([{
      id: 'deposit-1',
      business_id: 'business-1',
      deposit_date: '2026-12-01',
      bank_account_id: 'bank-1',
      bank_account_name: 'National Bank',
      reference: 'DEP-001',
      notes: null,
      status: 'posted',
      journal_entry_id: 'journal-1',
      created_by: 'user-1',
      posted_by: 'user-1',
      posted_at: '2026-12-01T10:00:00Z',
      voided_at: null,
      void_reason: null,
      created_at: '2026-12-01T09:00:00Z',
      updated_at: '2026-12-01T10:00:00Z',
      total_amount: 1234.5,
    }]);
    renderPage();

    expect(await screen.findByText('DEP-001')).toBeTruthy();
    expect(screen.getByText('National Bank')).toBeTruthy();
    expect(screen.getAllByText('cashDeposits.statuses.posted')).toHaveLength(2);
    expect(screen.getByRole('link', { name: /cashDeposits.newDeposit/ }).getAttribute('href')).toBe('/cash-deposits/new');
    expect(mocks.list).toHaveBeenCalledWith('business-1', { status: 'all', search: '', fromDate: undefined, toDate: undefined });
  });
});
