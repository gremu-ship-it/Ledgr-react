// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const taxMocks = vi.hoisted(() => ({
  vat: { isLoading: false, isError: false, data: undefined as unknown, refetch: vi.fn() },
  paye: { isLoading: false, isError: false, data: undefined as unknown, refetch: vi.fn() },
}));

vi.mock('@/hooks/useTaxData', () => ({
  getMraDueDates: () => [],
  useVatSummary: () => taxMocks.vat,
  usePayeSummary: () => taxMocks.paye,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import { TaxRemittancePanel } from '@/components/dashboard/TaxRemittancePanel';

function setSuccessfulZeroSummaries() {
  taxMocks.vat.isLoading = false;
  taxMocks.vat.isError = false;
  taxMocks.vat.data = { outputVat: 0, inputVat: 0, vatPayable: 0, period: 'October 2026' };
  taxMocks.paye.isLoading = false;
  taxMocks.paye.isError = false;
  taxMocks.paye.data = { totalPaye: 0, period: 'October 2026' };
}

afterEach(() => {
  cleanup();
  taxMocks.vat.refetch.mockReset();
  taxMocks.paye.refetch.mockReset();
  setSuccessfulZeroSummaries();
});

describe('TaxRemittancePanel query errors', () => {
  it('shows an error and retry instead of substituting zero for a failed VAT query', () => {
    taxMocks.vat.isError = true;
    taxMocks.vat.data = undefined;
    taxMocks.vat.refetch = vi.fn().mockResolvedValue(undefined);
    render(<TaxRemittancePanel businessId="business-1" />);

    expect(screen.getByRole('alert').textContent).toContain('dashboard.vatSummaryLoadError');
    expect(screen.getByRole('alert').textContent).not.toMatch(/0\.00/);
    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }));
    expect(taxMocks.vat.refetch).toHaveBeenCalledOnce();
  });

  it('shows an error and retry instead of substituting zero for a failed PAYE query', () => {
    taxMocks.paye.isError = true;
    taxMocks.paye.data = undefined;
    taxMocks.paye.refetch = vi.fn().mockResolvedValue(undefined);
    render(<TaxRemittancePanel businessId="business-1" />);

    expect(screen.getByRole('alert').textContent).toContain('dashboard.payeSummaryLoadError');
    expect(screen.getByRole('alert').textContent).not.toMatch(/0\.00/);
    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }));
    expect(taxMocks.paye.refetch).toHaveBeenCalledOnce();
  });

  it('shows zero amounts only when the summary queries succeed with zero balances', () => {
    setSuccessfulZeroSummaries();
    render(<TaxRemittancePanel businessId="business-1" />);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getAllByText(/0\.00/).length).toBeGreaterThan(0);
  });
});
