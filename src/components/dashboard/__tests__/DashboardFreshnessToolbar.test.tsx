// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardFreshnessToolbar } from '@/components/dashboard/DashboardFreshnessToolbar';
import { formatCurrency, formatDateRange } from '@/lib/formatters';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => options?.count ? `${options.count} min ago` : options?.time ? `Last updated: ${options.time}` : key,
    i18n: { language: 'en' },
  }),
}));

afterEach(() => cleanup());

describe('dashboard presentation formatting', () => {
  it('formats business currency codes and explicit date ranges', () => {
    expect(formatCurrency(1234.5, 'USD', 'en-US')).toContain('USD');
    expect(formatCurrency(1234, 'ZAR', 'en-ZA')).toContain('ZAR');
    expect(formatDateRange('2026-11-01', '2026-11-30', 'en-US')).toBe('Nov 1, 2026 – Nov 30, 2026');
  });
});

describe('DashboardFreshnessToolbar', () => {
  it('shows latest dashboard success time and refreshes finance plus active vertical queries', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryKey = ['dashboard', 'inventory-summary', 'business-1'];
    queryClient.setQueryData(queryKey, { stockValue: 100 }, { updatedAt: Date.now() - 180_000 });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(async (filters) => {
      if (filters?.queryKey?.[0] === 'dashboard') queryClient.setQueryData(queryKey, { stockValue: 125 });
      return undefined;
    });
    render(<QueryClientProvider client={queryClient}><DashboardFreshnessToolbar businessId="business-1" /></QueryClientProvider>);

    expect(await screen.findByText('Last updated: 3 min ago')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'dashboard.freshness.refresh' }));

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['dashboard'], refetchType: 'active' }));
    expect(await screen.findByText('Last updated: dashboard.freshness.justNow')).toBeTruthy();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['income', 'monthly', 'business-1', expect.any(String)], refetchType: 'active' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['pos', 'owner-analytics', 'business-1'], refetchType: 'active' });
  });
});
