// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { DepreciationRunPage } from '@/pages/reports/DepreciationRunPage';

const mocks = vi.hoisted(() => ({
  getDepreciationPreview: vi.fn(),
  getDepreciationHistory: vi.fn(),
  getDepreciationSummary: vi.fn(),
  runDepreciation: vi.fn(),
}));

vi.mock('@/lib/repositories', () => ({
  repos: {
    depreciation: {
      getDepreciationPreview: mocks.getDepreciationPreview,
      getDepreciationHistory: mocks.getDepreciationHistory,
      getDepreciationSummary: mocks.getDepreciationSummary,
      runDepreciation: mocks.runDepreciation,
    },
  },
}));
vi.mock('@/store/useAppStore', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    currentBusiness: { business: { id: 'biz-1', name: 'Business', base_currency: 'MWK' }, role: 'owner' },
    currentUser: { id: 'user-1' },
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

const assetPreview = {
  asset: {
    id: 'asset-1', name: 'Generator', asset_number: 'FA-001', acquisition_cost: 1_200_000,
    accumulated_depreciation: 200_000, net_book_value: 1_000_000, depreciation_method: 'straight_line',
  },
  category: { id: 'category-1', name: 'Equipment' },
  netBookValue: 1_000_000,
  accumulatedDepreciation: 200_000,
  usefulLifeMonths: 120,
  annualRatePercent: 24,
  periodDepreciation: 8_333.33,
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/reports/depreciation']}>
        <Routes><Route path="/reports/depreciation" element={<DepreciationRunPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.getDepreciationPreview.mockReset().mockResolvedValue([assetPreview]);
  mocks.getDepreciationHistory.mockReset().mockResolvedValue([{
    id: 'schedule-1', businessId: 'biz-1', assetId: 'asset-1', assetName: 'Generator',
    periodStart: '2026-01-01', periodEnd: '2026-01-31', depreciationCharge: 8_333.33,
    accumulatedToDate: 208_333.33, netBookValue: 991_666.67, journalEntryId: 'journal-1',
    journalEntryNumber: 'JNL-0001', postedAt: '2026-02-01T00:00:00Z', createdAt: '2026-02-01T00:00:00Z',
  }]);
  mocks.getDepreciationSummary.mockReset().mockResolvedValue([{
    categoryId: 'category-1', categoryName: 'Equipment', assetsCount: 1, totalDepreciation: 8_333.33,
  }]);
  mocks.runDepreciation.mockReset().mockResolvedValue({
    periodStart: '2026-01-01', periodEnd: '2026-01-31', assetsProcessed: 1, totalAmount: 8_333.33,
    entries: [{ assetId: 'asset-1', assetName: 'Generator', charge: 8_333.33, journalEntryId: 'journal-2', journalEntryNumber: 'JNL-0002' }],
    journalEntryIds: ['journal-2'], alreadyRun: false,
  });
});
afterEach(() => cleanup());

describe('DepreciationRunPage', () => {
  it('renders the period preview, depreciation history and category summary', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'depreciation.title' })).toBeTruthy();
    expect(await screen.findByText('Generator')).toBeTruthy();
    expect(screen.getAllByText('Equipment').length).toBeGreaterThan(0);
    expect(screen.getByText('JNL-0001')).toBeTruthy();
    expect(screen.getByText('depreciation.categorySummary')).toBeTruthy();
    expect(mocks.getDepreciationPreview).toHaveBeenCalledWith('biz-1', expect.any(String), expect.any(String));
  });

  it('confirms and posts the selected period, then links to the created journal entry', async () => {
    renderPage();
    const runButton = await screen.findByRole('button', { name: 'depreciation.runDepreciation' });
    await waitFor(() => expect((runButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(runButton);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'depreciation.confirmAction' }));
    await waitFor(() => expect(mocks.runDepreciation).toHaveBeenCalledWith(
      'biz-1', expect.any(String), expect.any(String), 'user-1',
    ));
    expect(await screen.findByText('depreciation.runSuccess')).toBeTruthy();
    const journalLink = await screen.findByRole('link', { name: 'depreciation.journalEntryLink' });
    expect(journalLink.getAttribute('href')).toBe('/journals?entry=journal-2');
  });
});
