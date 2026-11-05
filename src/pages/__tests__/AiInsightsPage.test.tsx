// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

const mockAi = vi.hoisted(() => ({
  planTier: 'free' as string,
  getAnomalies: vi.fn(),
  runDiagnosticScan: vi.fn(),
  resolveAnomaly: vi.fn(),
}));

vi.mock('@/hooks/useUsage', () => ({ useUsage: () => ({ planTier: mockAi.planTier }) }));
vi.mock('@/lib/repositories/aiRepository', () => ({ aiRepository: mockAi }));
vi.mock('@/components/ai/Assistant', () => ({ Assistant: () => <div data-testid="assistant-panel" /> }));

import '@/i18n';
import { AiInsightsPage } from '@/pages/AiInsightsPage';
import { useAppStore } from '@/store/useAppStore';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><AiInsightsPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockAi.planTier = 'free';
  mockAi.getAnomalies.mockResolvedValue([]);
  mockAi.runDiagnosticScan.mockResolvedValue({ scanned: 3, created: 2, skippedExisting: 1 });
  mockAi.resolveAnomaly.mockResolvedValue({});
  useAppStore.setState({
    currentBusiness: { role: 'owner', business: { id: 'business-1', name: 'Ledger Ltd', base_currency: 'MWK' } },
    currentUser: { id: 'user-1', email: 'user@example.test' },
  } as never);
});

describe('/ai Enterprise diagnostics gate and dashboard', () => {
  it('shows the Enterprise preview and upgrade action for a non-Enterprise plan', () => {
    mockAi.planTier = 'pro';
    renderPage();

    expect(screen.getByRole('heading', { name: 'AI Financial Intelligence is an Enterprise Feature' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Upgrade to Enterprise for AI Insights/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Run Diagnostic Scan' })).toBeNull();
  });

  it('renders the Enterprise dashboard and runs a scan which refreshes the anomaly query', async () => {
    mockAi.planTier = 'enterprise';
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Ledgr AI & Anomaly Diagnostics' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Run Diagnostic Scan' }));

    await waitFor(() => expect(mockAi.runDiagnosticScan).toHaveBeenCalledWith('business-1'));
    expect((await screen.findByRole('status')).textContent).toContain('2 new finding');
    expect(mockAi.getAnomalies).toHaveBeenCalledWith('business-1');
  });
});
