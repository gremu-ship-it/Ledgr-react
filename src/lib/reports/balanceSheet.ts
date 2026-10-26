import type { TrialBalanceRow } from '@/dal/repositories/ReportRepository';
import { computePnl } from '@/lib/reports/pnl';

export type BsSectionKey =
  | 'currentAssets'
  | 'nonCurrentAssets'
  | 'currentLiabilities'
  | 'nonCurrentLiabilities'
  | 'equity';

export interface BsAccountLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  /** Signed display amount; normal balances are positive, contra balances stay negative. */
  amount: number;
  level: number;
}

export interface BsSection {
  key: BsSectionKey;
  labelKey: string;
  accounts: BsAccountLine[];
  total: number;
}

export interface BsReport {
  assets: BsSection[];
  liabilities: BsSection[];
  equity: BsSection[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  retainedEarnings: number;
  isBalanced: boolean;
  discrepancy: number;
}

const SECTION_LABELS: Record<BsSectionKey, string> = {
  currentAssets: 'reports.balanceSheet.currentAssets',
  nonCurrentAssets: 'reports.balanceSheet.nonCurrentAssets',
  currentLiabilities: 'reports.balanceSheet.currentLiabilities',
  nonCurrentLiabilities: 'reports.balanceSheet.nonCurrentLiabilities',
  equity: 'reports.balanceSheet.equity',
};

const RETAINED_EARNINGS_CODES = new Set(['3120', '3130', '3200', '3300']);
const RETAINED_EARNINGS_NAME = /\bretained earnings\b|\bcurrent year profit\s*\/\s*loss\b/i;
const BALANCE_TOLERANCE = 0.01;

function finiteAmount(value: unknown): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function accountBalance(row: TrialBalanceRow): number {
  return finiteAmount(row.balance ?? finiteAmount(row.total_debit) - finiteAmount(row.total_credit));
}

function isExplicitRetainedEarningsAccount(row: TrialBalanceRow): boolean {
  const code = String(row.account_code ?? '').trim();
  const name = String(row.account_name ?? '').trim();
  return RETAINED_EARNINGS_CODES.has(code) || RETAINED_EARNINGS_NAME.test(name);
}

/** True only when an explicit earnings/equity account actually carries a balance. */
export function hasActiveRetainedEarningsBalance(tbRows: TrialBalanceRow[]): boolean {
  return tbRows.some((row) =>
    String(row.account_type ?? '').trim().toLowerCase() === 'equity'
    && isExplicitRetainedEarningsAccount(row)
    && Math.abs(accountBalance(row)) > BALANCE_TOLERANCE,
  );
}

function sectionKeyForAccount(row: TrialBalanceRow): BsSectionKey | null {
  const type = String(row.account_type ?? '').trim().toLowerCase();
  const code = String(row.account_code ?? '').trim();
  if (type === 'asset') return code.startsWith('11') ? 'currentAssets' : 'nonCurrentAssets';
  if (type === 'liability') return code.startsWith('21') ? 'currentLiabilities' : 'nonCurrentLiabilities';
  if (type === 'equity') return 'equity';

  // Keep the fallback narrow: known income statement and balance-sheet types
  // must not be reclassified just because their account code is unusual.
  if (type && type !== 'unknown') return null;
  if (code.startsWith('1')) return code.startsWith('11') ? 'currentAssets' : 'nonCurrentAssets';
  if (code.startsWith('2')) return code.startsWith('21') ? 'currentLiabilities' : 'nonCurrentLiabilities';
  if (code.startsWith('3')) return 'equity';
  return null;
}

function newSection(key: BsSectionKey): BsSection {
  return { key, labelKey: SECTION_LABELS[key], accounts: [], total: 0 };
}

function addAccount(section: BsSection, row: TrialBalanceRow, amount: number): void {
  section.accounts.push({
    accountId: row.account_id,
    accountCode: row.account_code,
    accountName: row.account_name,
    amount,
    level: Number.isFinite(row.level) ? Math.max(0, row.level) : 0,
  });
  section.total += amount;
}

export function computeBalanceSheet(
  tbRows: TrialBalanceRow[],
  hasRetainedEarningsAccount: boolean,
): BsReport {
  const assets = [newSection('currentAssets'), newSection('nonCurrentAssets')];
  const liabilities = [newSection('currentLiabilities'), newSection('nonCurrentLiabilities')];
  const equity = [newSection('equity')];
  const sections = new Map([...assets, ...liabilities, ...equity].map((section) => [section.key, section]));
  let explicitRetainedEarnings = 0;

  for (const row of tbRows) {
    const key = sectionKeyForAccount(row);
    if (!key) continue;

    const balance = accountBalance(row);
    const displayAmount = key === 'currentAssets' || key === 'nonCurrentAssets' ? balance : -balance;
    if (key === 'equity' && isExplicitRetainedEarningsAccount(row)) {
      explicitRetainedEarnings += displayAmount;
      continue;
    }
    addAccount(sections.get(key)!, row, displayAmount);
  }

  for (const section of [...assets, ...liabilities, ...equity]) {
    section.accounts.sort((a, b) => a.accountCode.localeCompare(b.accountCode, undefined, { numeric: true }));
  }

  // A chart may define retained-earnings accounts before it has posted any
  // closing balance to them. In that case carry cumulative P&L forward; if an
  // explicit earnings account is active, use its balance and avoid double count.
  const retainedEarnings = hasRetainedEarningsAccount
    ? explicitRetainedEarnings
    : computePnl(tbRows).netIncome;
  const totalAssets = assets.reduce((sum, section) => sum + section.total, 0);
  const totalLiabilities = liabilities.reduce((sum, section) => sum + section.total, 0);
  const totalEquity = equity.reduce((sum, section) => sum + section.total, 0) + retainedEarnings;
  const discrepancy = totalAssets - (totalLiabilities + totalEquity);

  return {
    assets,
    liabilities,
    equity,
    totalAssets,
    totalLiabilities,
    totalEquity,
    retainedEarnings,
    isBalanced: Math.abs(discrepancy) <= BALANCE_TOLERANCE,
    discrepancy,
  };
}

export function balanceSheetDateForPreset(
  preset: 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'lastYear',
  now = new Date(),
): string {
  const year = now.getFullYear();
  const month = now.getMonth();
  let endOfMonth: Date;
  switch (preset) {
    case 'thisMonth':
      endOfMonth = new Date(year, month + 1, 0);
      break;
    case 'lastMonth':
      endOfMonth = new Date(year, month, 0);
      break;
    case 'thisQuarter': {
      const quarterStartMonth = Math.floor(month / 3) * 3;
      endOfMonth = new Date(year, quarterStartMonth + 3, 0);
      break;
    }
    case 'lastYear':
      endOfMonth = new Date(year - 1, 11, 31);
      break;
  }
  const dateYear = endOfMonth.getFullYear();
  const dateMonth = String(endOfMonth.getMonth() + 1).padStart(2, '0');
  const dateDay = String(endOfMonth.getDate()).padStart(2, '0');
  return `${dateYear}-${dateMonth}-${dateDay}`;
}

export function isValidAsOfDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}
