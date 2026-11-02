// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ChangesInEquityPage } from '../ChangesInEquityPage';
import { RevenueBreakdownPage } from '../RevenueBreakdownPage';
import { BranchPerformancePage } from '../BranchPerformancePage';

const mocks = vi.hoisted(() => ({
  equityProps: vi.fn(),
  revenueProps: vi.fn(),
  branchProps: vi.fn(),
}));

vi.mock('@/components/SectionErrorBoundary', () => ({
  SectionErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/reports/PeriodPicker', () => ({
  PeriodPicker: () => <div data-testid="period-picker" />,
}));
vi.mock('@/components/reports/StatementOfChangesInEquity', () => ({
  StatementOfChangesInEquity: (props: unknown) => {
    mocks.equityProps(props);
    return <div data-testid="equity-report" />;
  },
}));
vi.mock('@/components/reports/RevenueBreakdownReport', () => ({
  RevenueBreakdownReport: (props: unknown) => {
    mocks.revenueProps(props);
    return <div data-testid="revenue-report" />;
  },
}));
vi.mock('@/components/reports/BranchPerformanceReport', () => ({
  BranchPerformanceReport: (props: unknown) => {
    mocks.branchProps(props);
    return <div data-testid="branch-report" />;
  },
}));
vi.mock('@/store/useAppStore', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    currentBusiness: { business: { id: 'business-1', name: 'Test Co' }, role: 'owner' },
  }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

afterEach(() => {
  cleanup();
  mocks.equityProps.mockClear();
  mocks.revenueProps.mockClear();
  mocks.branchProps.mockClear();
});

describe('Growth report standalone pages', () => {
  it('renders the Changes in Equity page with a period selector and standalone export mode', () => {
    render(<ChangesInEquityPage />);
    expect(screen.getByRole('heading', { name: 'reports.statementOfChangesInEquity' })).toBeTruthy();
    expect(screen.getByTestId('period-picker')).toBeTruthy();
    expect(mocks.equityProps).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1',
      standalone: true,
      periodStart: expect.stringMatching(/^\d{4}-\d{2}-01$/),
      periodEnd: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    }));
  });

  it('renders the Revenue Breakdown page with a period selector and standalone export mode', () => {
    render(<RevenueBreakdownPage />);
    expect(screen.getByRole('heading', { name: 'reports.revenueBreakdown.title' })).toBeTruthy();
    expect(screen.getByTestId('period-picker')).toBeTruthy();
    expect(mocks.revenueProps).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1',
      standalone: true,
      periodStart: expect.stringMatching(/^\d{4}-\d{2}-01$/),
      periodEnd: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    }));
  });

  it('renders the Branch Performance page with a period selector and standalone export mode', () => {
    render(<BranchPerformancePage />);
    expect(screen.getByRole('heading', { name: 'reports.branchPerformance' })).toBeTruthy();
    expect(screen.getByTestId('period-picker')).toBeTruthy();
    expect(mocks.branchProps).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'business-1',
      standalone: true,
      periodStart: expect.stringMatching(/^\d{4}-\d{2}-01$/),
      periodEnd: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    }));
  });
});
