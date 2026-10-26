import type { TrialBalanceRow } from '@/dal/repositories/ReportRepository';

export type PnlSectionKey = 'revenue' | 'cogs' | 'operatingExpenses' | 'otherIncome' | 'otherExpenses';
export type PnlComputedLineKey = 'grossProfit' | 'operatingIncome' | 'netIncome';

export interface PnlAccountLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  /** Signed P&L impact; contra balances remain negative so totals reconcile to the trial balance. */
  amount: number;
  level: number;
}

export interface PnlSection {
  key: PnlSectionKey;
  labelKey: string;
  accounts: PnlAccountLine[];
  total: number;
}

export interface PnlComputedLine {
  key: PnlComputedLineKey;
  labelKey: string;
  amount: number;
  isSubtotal: boolean;
}

export interface PnlReport {
  sections: PnlSection[];
  computedLines: PnlComputedLine[];
  netIncome: number;
}

const SECTION_LABELS: Record<PnlSectionKey, string> = {
  revenue: 'reports.profitLoss.revenue',
  cogs: 'reports.profitLoss.lessCogs',
  operatingExpenses: 'reports.profitLoss.lessOperatingExpenses',
  otherIncome: 'reports.profitLoss.otherIncome',
  otherExpenses: 'reports.profitLoss.lessOtherExpenses',
};

const SECTION_ORDER: PnlSectionKey[] = [
  'revenue',
  'cogs',
  'operatingExpenses',
  'otherIncome',
  'otherExpenses',
];

// The active chart contains operating accounts in both the 6xxx and 7xxx
// ranges. These account codes are the chart's finance costs; other 7xxx
// accounts (rent, utilities, depreciation, etc.) remain operating expenses.
const FINANCE_COST_CODES = new Set(['7101', '7102', '7103', '7190', '7191', '7192', '7193']);

function sectionForAccount(row: TrialBalanceRow): PnlSectionKey | null {
  const type = String(row.account_type ?? '').trim().toLowerCase();
  const code = String(row.account_code ?? '').trim();
  const hasPrefix = (prefix: string) => code.startsWith(prefix);

  if (type === 'other_income') return 'otherIncome';
  if (type === 'other_expense' || type === 'finance_cost') return 'otherExpenses';
  if (type === 'cogs' || type === 'cost_of_sales') return 'cogs';
  if (type === 'revenue' || type === 'income') {
    return hasPrefix('42') || hasPrefix('7') ? 'otherIncome' : 'revenue';
  }
  if (type === 'expense' || type === 'operating_expense') {
    if (hasPrefix('5')) return 'cogs';
    if (hasPrefix('8') || FINANCE_COST_CODES.has(code) || hasPrefix('73') || hasPrefix('75')) {
      return 'otherExpenses';
    }
    return 'operatingExpenses';
  }
  if (type && type !== 'unknown') return null;

  // Prefix fallback supports legacy/untyped accounts while never pulling
  // balance-sheet accounts (1xxx–3xxx) into the income statement.
  if (hasPrefix('4')) return hasPrefix('42') ? 'otherIncome' : 'revenue';
  if (hasPrefix('5')) return 'cogs';
  if (hasPrefix('6')) return 'operatingExpenses';
  if (hasPrefix('7')) return 'otherIncome';
  if (hasPrefix('8')) return 'otherExpenses';
  return null;
}

function finiteAmount(value: unknown): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

export function computePnl(tbRows: TrialBalanceRow[]): PnlReport {
  const sections = SECTION_ORDER.map((key): PnlSection => ({
    key,
    labelKey: SECTION_LABELS[key],
    accounts: [],
    total: 0,
  }));
  const sectionsByKey = new Map(sections.map((section) => [section.key, section]));

  for (const row of tbRows) {
    const key = sectionForAccount(row);
    if (!key) continue;

    const balance = finiteAmount(row.balance ?? finiteAmount(row.total_debit) - finiteAmount(row.total_credit));
    const isIncome = key === 'revenue' || key === 'otherIncome';
    // Trial-balance balance is debit minus credit. Income is presented as
    // credit-positive; expense accounts are debit-positive. Preserve the
    // opposite-side sign for contra accounts (returns, credits, adjustments).
    const amount = isIncome ? -balance : balance;
    const section = sectionsByKey.get(key)!;
    section.accounts.push({
      accountId: row.account_id,
      accountCode: row.account_code,
      accountName: row.account_name,
      amount,
      level: row.level,
    });
    section.total += amount;
  }

  for (const section of sections) {
    section.accounts.sort((a, b) => a.accountCode.localeCompare(b.accountCode, undefined, { numeric: true }));
  }

  const totalRevenue = sectionsByKey.get('revenue')!.total;
  const totalCogs = sectionsByKey.get('cogs')!.total;
  const totalOperatingExpenses = sectionsByKey.get('operatingExpenses')!.total;
  const totalOtherIncome = sectionsByKey.get('otherIncome')!.total;
  const totalOtherExpenses = sectionsByKey.get('otherExpenses')!.total;
  const grossProfit = totalRevenue - totalCogs;
  const operatingIncome = grossProfit - totalOperatingExpenses;
  const netIncome = operatingIncome + totalOtherIncome - totalOtherExpenses;

  return {
    sections,
    computedLines: [
      { key: 'grossProfit', labelKey: 'reports.profitLoss.grossProfit', amount: grossProfit, isSubtotal: true },
      { key: 'operatingIncome', labelKey: 'reports.profitLoss.operatingIncome', amount: operatingIncome, isSubtotal: true },
      { key: 'netIncome', labelKey: 'reports.profitLoss.netIncome', amount: netIncome, isSubtotal: true },
    ],
    netIncome,
  };
}

export function computeVariance(current: number, prior: number): { absolute: number; percentage: number | null } {
  const safeCurrent = Number.isFinite(current) ? current : 0;
  const safePrior = Number.isFinite(prior) ? prior : 0;
  const absolute = safeCurrent - safePrior;
  const percentage = safePrior !== 0 ? (absolute / Math.abs(safePrior)) * 100 : null;
  return { absolute, percentage };
}
