// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StatementOfChangesInEquity } from './StatementOfChangesInEquity';
import { RevenueBreakdownReport } from './RevenueBreakdownReport';
import { BranchPerformanceReport } from './BranchPerformanceReport';

const mocks = vi.hoisted(() => ({
  queryResult: { data: undefined as unknown, isLoading: false, isError: false, error: null as unknown },
  downloadFile: vi.fn(),
  printReport: vi.fn(),
  revenueRows: [{ key: 'service-a', name: 'Consulting', invoiceCount: 2, amount: 120 }],
}));

vi.mock('@tanstack/react-query', () => ({ useQuery: () => mocks.queryResult }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/hooks/useBrandTheme', () => ({
  useBrandTheme: () => ({ business: undefined, businessName: 'Test Co', logoUrl: null, brandColor: null }),
}));
vi.mock('@/i18n', () => ({
  useLocaleFormat: () => ({ currency: (amount: number) => amount.toFixed(2), date: (value: string) => value }),
}));
vi.mock('@/lib/repositories', () => ({
  repos: { account: { db: {} }, branch: { findByBusiness: vi.fn() }, journal: { db: {} } },
}));
vi.mock('@/dal/repositories/FinancialStatementRepository', () => ({
  FinancialStatementRepository: class {
    getChangesInEquity = vi.fn();
  },
}));
vi.mock('@/lib/reportExports', () => ({ exportReportAsPDF: vi.fn(), exportReportAsXBRL: vi.fn() }));
vi.mock('@/lib/revenueBreakdown', () => ({ buildRevenueBreakdown: () => mocks.revenueRows }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/paginateQuery', () => ({ fetchAllRows: vi.fn() }));
vi.mock('@/lib/branchPerformance', () => ({
  buildBranchPerformance: vi.fn(),
  UNASSIGNED_BRANCH_ID: '__unassigned__',
}));
vi.mock('@/lib/reports/export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reports/export')>();
  return { ...actual, downloadFile: mocks.downloadFile, printReport: mocks.printReport };
});

afterEach(() => {
  cleanup();
  mocks.downloadFile.mockClear();
  mocks.printReport.mockClear();
});

const equityData = {
  periodStart: '2026-01-01',
  periodEnd: '2026-01-31',
  shareCapital: { label: 'Share capital', openingBalance: 100, netProfitAllocation: 0, contributions: 20, drawingsOrDividends: 0, otherMovements: 0, closingBalance: 120 },
  retainedEarnings: { label: 'Retained earnings', openingBalance: 40, netProfitAllocation: 10, contributions: 0, drawingsOrDividends: 0, otherMovements: 0, closingBalance: 50 },
  reserves: { label: 'Reserves', openingBalance: 0, netProfitAllocation: 0, contributions: 0, drawingsOrDividends: 0, otherMovements: 0, closingBalance: 0 },
  totalOpeningEquity: 140,
  totalClosingEquity: 170,
  reconciles: true,
};

const branchRow = {
  branchId: 'branch-1', branchName: 'Blantyre', branchCode: 'BT', location: 'Blantyre', isActive: true,
  revenue: 0, otherIncome: 0, costOfSales: 0, operatingExpenses: 0, depreciationAmortisation: 0,
  financeCosts: 0, taxExpense: 0, grossProfit: 0, operatingProfit: 0, netProfit: 0,
  grossMargin: null, netMargin: null, accountBreakdown: [],
};

describe('standalone Growth report exports', () => {
  it('exports Changes in Equity data to CSV and prints the report to PDF', () => {
    mocks.queryResult = { data: equityData, isLoading: false, isError: false, error: null };
    render(<StatementOfChangesInEquity businessId="business-1" periodStart="2026-01-01" periodEnd="2026-01-31" standalone />);

    fireEvent.click(screen.getByRole('button', { name: 'reports.shared.exportCSV' }));
    const csv = mocks.downloadFile.mock.calls[0][0] as string;
    expect(csv).toContain('reports.shared.accountName,reports.opening,reports.netProfit,reports.contributions,reports.drawingsDividends,reports.other,reports.closing');
    expect(csv).toContain('Share capital,100.00,0.00,20.00,0.00,0.00,120.00');
    expect(csv).toContain('reports.totalEquity,140.00,,,,,170.00');

    fireEvent.click(screen.getByRole('button', { name: 'reports.shared.exportPDF' }));
    expect(mocks.printReport).toHaveBeenCalledOnce();
  });

  it('exports invoice-based Revenue Breakdown data to CSV and prints the report to PDF', () => {
    mocks.queryResult = {
      data: { invoices: [], lines: [], productNames: new Map(), accountTypes: new Map() },
      isLoading: false,
      isError: false,
      error: null,
    };
    render(<RevenueBreakdownReport businessId="business-1" periodStart="2026-01-01" periodEnd="2026-01-31" standalone />);

    fireEvent.click(screen.getByRole('button', { name: 'reports.shared.exportCSV' }));
    const csv = mocks.downloadFile.mock.calls[0][0] as string;
    expect(csv).toContain('reports.revenueBreakdown.productService,reports.revenueBreakdown.invoices,reports.revenueBreakdown.netRevenue,reports.revenueBreakdown.sharePercent');
    expect(csv).toContain('Consulting,2.00,120.00,100.00');
    expect(csv).toContain('reports.revenueBreakdown.totalNetRevenue,,120.00,100.00');

    fireEvent.click(screen.getByRole('button', { name: 'reports.shared.exportPDF' }));
    expect(mocks.printReport).toHaveBeenCalledOnce();
  });

  it('exports Branch Performance rows to CSV and prints the report to PDF', () => {
    mocks.queryResult = {
      data: { branches: [{ id: 'branch-1', name: 'Blantyre' }], rows: [branchRow] },
      isLoading: false,
      isError: false,
      error: null,
    };
    render(<BranchPerformanceReport businessId="business-1" periodStart="2026-01-01" periodEnd="2026-01-31" standalone />);

    fireEvent.click(screen.getByRole('button', { name: 'reports.shared.exportCSV' }));
    const csv = mocks.downloadFile.mock.calls[0][0] as string;
    expect(csv).toContain('reports.branchPerformanceCsv.branch,reports.branchPerformanceCsv.location');
    expect(csv).toContain('Blantyre,Blantyre,0.00,0.00,0.00');
    expect(csv).toContain('reports.shared.total,,0.00,0.00,0.00');

    fireEvent.click(screen.getByRole('button', { name: 'reports.shared.exportPDF' }));
    expect(mocks.printReport).toHaveBeenCalledOnce();
  });
});
