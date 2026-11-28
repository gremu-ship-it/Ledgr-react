import { useEffect, type ComponentType } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { TrialBalancePage } from '@/pages/reports/TrialBalancePage';
import { ProfitLossPage } from '@/pages/reports/ProfitLossPage';
import { BalanceSheetPage } from '@/pages/reports/BalanceSheetPage';
import { CashFlowPage } from '@/pages/reports/CashFlowPage';
import { RevenueBreakdownPage } from '@/pages/reports/RevenueBreakdownPage';
import { ChangesInEquityPage } from '@/pages/reports/ChangesInEquityPage';
import { BranchPerformancePage } from '@/pages/reports/BranchPerformancePage';
import {
  REPORT_TABS,
  normalizeReportTab,
  type ReportTab,
} from '@/lib/reports/reportTabs';

const REPORT_COMPONENTS: Record<ReportTab, ComponentType> = {
  'trial-balance': TrialBalancePage,
  pnl: ProfitLossPage,
  'balance-sheet': BalanceSheetPage,
  'cash-flow': CashFlowPage,
  revenue: RevenueBreakdownPage,
  equity: ChangesInEquityPage,
  branches: BranchPerformancePage,
};

/**
 * Financial reports workspace. The URL is the single source of truth: a
 * sidebar link such as `/reports?tab=pnl` renders the P&L immediately, browser
 * back/forward moves between reports, and switching a tab updates the query.
 */
export function ReportsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  const activeTab = normalizeReportTab(rawTab);

  // Canonicalize aliases and make the default explicit so the sidebar can
  // match the exact tab query rather than showing the parent inactive.
  useEffect(() => {
    if (rawTab === activeTab) return;
    const next = new URLSearchParams(searchParams);
    next.set('tab', activeTab);
    setSearchParams(next, { replace: true });
  }, [activeTab, rawTab, searchParams, setSearchParams]);

  const handleTabChange = (tab: ReportTab) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next);
  };

  const ActiveReport = REPORT_COMPONENTS[activeTab];

  return (
    <div className="min-h-full bg-gray-50">
      <div className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6 sm:pt-6 lg:px-8">
        <div
          role="tablist"
          aria-label={t('nav.clinicReports')}
          className="scrollbar-thin flex gap-1 overflow-x-auto rounded-2xl border border-gray-200 bg-white p-1.5 shadow-sm"
        >
          {REPORT_TABS.map((tab) => {
            const Icon = tab.icon;
            const selected = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`reports-tab-${tab.id}`}
                aria-selected={selected}
                aria-controls={`reports-panel-${tab.id}`}
                onClick={() => handleTabChange(tab.id)}
                className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors touch-manipulation ${
                  selected
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="whitespace-nowrap">{t(tab.labelKey)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div
        role="tabpanel"
        id={`reports-panel-${activeTab}`}
        aria-labelledby={`reports-tab-${activeTab}`}
      >
        <ActiveReport />
      </div>
    </div>
  );
}

/** Backwards-friendly alias for the route name used in the brief. */
export const Reports = ReportsPage;
