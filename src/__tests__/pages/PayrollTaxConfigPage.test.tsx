// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { TaxConfigPage } from '@/pages/payroll/TaxConfigPage';

const mocks = vi.hoisted(() => ({
  getTaxBands: vi.fn(),
  updateTaxBands: vi.fn(),
}));

vi.mock('@/lib/repositories', () => ({
  repos: { payrollFullCycle: { getTaxBands: mocks.getTaxBands, updateTaxBands: mocks.updateTaxBands } },
}));
vi.mock('@/store/useAppStore', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    currentBusiness: { business: { id: 'business-1', base_currency: 'MWK' }, role: 'owner' },
  }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));

const taxBands = [
  { id: 'band-1', band_number: 1, lower_bound: 0, upper_bound: 170_000, rate: 0, currency: 'MWK' },
  { id: 'band-2', band_number: 2, lower_bound: 170_000, upper_bound: 1_570_000, rate: 0.3, currency: 'MWK' },
  { id: 'band-3', band_number: 3, lower_bound: 1_570_000, upper_bound: 10_000_000, rate: 0.35, currency: 'MWK' },
  { id: 'band-4', band_number: 4, lower_bound: 10_000_000, upper_bound: null, rate: 0.4, currency: 'MWK' },
];

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={queryClient}><MemoryRouter><TaxConfigPage /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  mocks.getTaxBands.mockReset().mockResolvedValue(taxBands);
  mocks.updateTaxBands.mockReset().mockResolvedValue(taxBands);
});
afterEach(() => cleanup());

describe('TaxConfigPage', () => {
  it('renders fiscal-year PAYE bands and the Malawi 2,000,000 monthly gross estimate', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'payroll.taxConfig' })).toBeTruthy();
    expect(await screen.findByLabelText('payroll.rate 2')).toBeTruthy();
    expect(await screen.findByText(/570,500/)).toBeTruthy();
    const now = new Date();
    expect(mocks.getTaxBands).toHaveBeenCalledWith('business-1', now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1);
  });

  it('saves updated progressive bands through the payroll repository', async () => {
    renderPage();
    const firstRate = await screen.findByLabelText('payroll.rate 2') as HTMLInputElement;
    fireEvent.change(firstRate, { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'payroll.saveBands' }));
    await waitFor(() => expect(mocks.updateTaxBands).toHaveBeenCalledWith(
      'business-1', (new Date().getMonth() >= 6 ? new Date().getFullYear() : new Date().getFullYear() - 1), expect.arrayContaining([
        expect.objectContaining({ band_number: 2, rate: 0.25, currency: 'MWK' }),
      ]),
    ));
  });
});
