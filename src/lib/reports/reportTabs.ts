import {
  ChartPie,
  GitBranch,
  Landmark,
  Scale,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export type ReportTab =
  | 'trial-balance'
  | 'pnl'
  | 'balance-sheet'
  | 'cash-flow'
  | 'revenue'
  | 'equity'
  | 'branches';

export interface ReportTabDefinition {
  id: ReportTab;
  labelKey: string;
  icon: LucideIcon;
}

/** Order mirrors the sidebar's Financial & Clinic Reports accordion. */
export const REPORT_TABS: readonly ReportTabDefinition[] = [
  { id: 'trial-balance', labelKey: 'nav.sub.trialBalance', icon: Scale },
  { id: 'pnl', labelKey: 'nav.sub.profitAndLoss', icon: TrendingUp },
  { id: 'balance-sheet', labelKey: 'nav.sub.balanceSheet', icon: Landmark },
  { id: 'cash-flow', labelKey: 'nav.sub.cashFlow', icon: Wallet },
  { id: 'revenue', labelKey: 'nav.sub.revenueBreakdown', icon: ChartPie },
  { id: 'equity', labelKey: 'nav.sub.changesInEquity', icon: Scale },
  { id: 'branches', labelKey: 'nav.sub.departmentPerformance', icon: GitBranch },
];

/**
 * Normalize the URL tab, including the aliases used by older report links and
 * external bookmarks. Anything unknown falls back to Trial Balance.
 */
export function normalizeReportTab(rawTab: string | null | undefined): ReportTab {
  switch ((rawTab ?? '').trim().toLowerCase()) {
    case 'pnl':
    case 'profit-loss':
    case 'profit-and-loss':
    case 'income-statement':
      return 'pnl';
    case 'balance-sheet':
    case 'bs':
      return 'balance-sheet';
    case 'cash-flow':
    case 'cashflow':
      return 'cash-flow';
    case 'revenue':
    case 'revenue-breakdown':
      return 'revenue';
    case 'equity':
    case 'changes-in-equity':
      return 'equity';
    case 'branches':
    case 'departments':
      return 'branches';
    case 'trial-balance':
    case 'tb':
    default:
      return 'trial-balance';
  }
}
