// @vitest-environment jsdom
//
// The tax reports (VAT return, WHT schedule) render figures that users file and
// hand to an auditor, so they must be printable the same way every other report
// is: through the isolated-iframe print engine, with the report body — not the
// filter card or the action buttons — as the source document.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { VatReturnPage } from '../VatReturnPage';
import { WhtSchedulePage } from '../WhtSchedulePage';

const mocks = vi.hoisted(() => ({
  printElementRef: vi.fn(),
  downloadFile: vi.fn(),
  business: { id: 'biz-1', name: 'Test Co' },
}));

const taxAccounts = [
  { id: 'acc-vat-out', code: '2121', name: 'VAT Payable', account_type: 'liability' },
  { id: 'acc-vat-in', code: '1135', name: 'VAT Receivable', account_type: 'asset' },
  { id: 'acc-wht', code: '2122', name: 'PAYE Payable', account_type: 'liability' },
];

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = String(queryKey[0]);
    if (key === 'vat-return-trial-balance') {
      return {
        data: [
          { account_id: 'acc-vat-out', total_debit: 0, total_credit: 500 },
          { account_id: 'acc-vat-in', total_debit: 200, total_credit: 0 },
        ],
        isFetching: false,
        isError: false,
        refetch: vi.fn(),
      };
    }
    if (key === 'wht-schedule-lines') {
      return {
        data: [{
          id: 'line-1',
          date: '2026-12-05',
          reference: 'JNL-1',
          description: 'Consulting fee',
          accountCode: '2122',
          accountName: 'PAYE Payable',
          taxCode: 'wht_20',
          amount: 250,
        }],
        isFetching: false,
        isError: false,
        refetch: vi.fn(),
      };
    }
    return { data: taxAccounts, isFetching: false, isError: false, refetch: vi.fn() };
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('@/store/useAppStore', () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector({ currentBusiness: { business: mocks.business } }),
}));

vi.mock('@/hooks/useAccessibleReportBranches', () => ({
  useAccessibleReportBranches: () => ({ data: [{ id: 'br-1', name: 'Main' }] }),
}));

vi.mock('@/components/reports/BranchFilter', () => ({ BranchFilter: () => null }));

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() } }));

vi.mock('@/dal/repositories/ReportRepository', () => ({
  ReportRepository: { getTrialBalance: vi.fn(async () => []) },
}));

vi.mock('@/lib/tax-accounts', () => ({
  classifyTaxAccounts: () => ({
    outputVat: [taxAccounts[0]],
    inputVat: [taxAccounts[1]],
    whtPayable: [taxAccounts[2]],
  }),
}));

vi.mock('@/lib/paginateQuery', () => ({ fetchAllRows: vi.fn(async () => []) }));

vi.mock('@/lib/reports/export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reports/export')>();
  return { ...actual, downloadFile: mocks.downloadFile };
});

vi.mock('@/services/reportPrintService', () => ({ printElementRef: mocks.printElementRef }));

afterEach(() => {
  cleanup();
  mocks.printElementRef.mockClear();
  mocks.downloadFile.mockClear();
});

describe('tax report PDF export', () => {
  it('prints the VAT return body from the isolated print engine', () => {
    render(<VatReturnPage />);

    fireEvent.click(screen.getByRole('button', { name: /reports\.shared\.exportPDF/ }));

    expect(mocks.printElementRef).toHaveBeenCalledTimes(1);
    const [element, options] = mocks.printElementRef.mock.calls[0];
    expect(element).toBeInstanceOf(HTMLElement);
    expect(options).toMatchObject({
      title: 'reports.vatReturn.title',
      companyName: 'Test Co',
    });
    // The printable region is the report itself — headers and figures, no chrome.
    expect((element as HTMLElement).textContent).toContain('VAT Payable');
    expect((element as HTMLElement).querySelector('button')).toBeNull();
  });

  it('prints the WHT schedule body from the isolated print engine', () => {
    render(<WhtSchedulePage />);

    fireEvent.click(screen.getByRole('button', { name: /reports\.shared\.exportPDF/ }));

    expect(mocks.printElementRef).toHaveBeenCalledTimes(1);
    const [element, options] = mocks.printElementRef.mock.calls[0];
    expect(element).toBeInstanceOf(HTMLElement);
    expect(options).toMatchObject({ title: 'reports.whtSchedule.title', companyName: 'Test Co' });
    expect((element as HTMLElement).textContent).toContain('Consulting fee');
    expect((element as HTMLElement).querySelector('button')).toBeNull();
  });

  it('keeps CSV export working alongside PDF', () => {
    render(<VatReturnPage />);

    fireEvent.click(screen.getByRole('button', { name: /reports\.shared\.exportCSV/ }));

    expect(mocks.downloadFile).toHaveBeenCalledTimes(1);
    expect(mocks.printElementRef).not.toHaveBeenCalled();
  });
});
