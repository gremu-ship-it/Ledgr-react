import type { TrialBalanceRow } from '@/dal/repositories/ReportRepository';

export type PnlSectionKey =
  | 'revenue'
  | 'costOfSales'
  | 'otherIncome'
  | 'operatingExpenses'
  | 'depreciationAmortisation'
  | 'financeCosts'
  | 'taxExpense';
export type PnlComputedLineKey = 'grossProfit' | 'operatingProfit' | 'profitBeforeTax' | 'netProfit';

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
  revenue: 'reports.pnl.revenue',
  costOfSales: 'reports.pnl.costOfSales',
  otherIncome: 'reports.pnl.otherIncome',
  operatingExpenses: 'reports.pnl.operatingExpenses',
  depreciationAmortisation: 'reports.pnl.depreciationAmortisation',
  financeCosts: 'reports.pnl.financeCosts',
  taxExpense: 'reports.pnl.taxExpense',
};

const SECTION_ORDER: PnlSectionKey[] = [
  'revenue',
  'costOfSales',
  'otherIncome',
  'operatingExpenses',
  'depreciationAmortisation',
  'financeCosts',
  'taxExpense',
];

const DEPRECIATION_CODE_PREFIX = '68';
const TAX_CODE_PREFIX = '75';
const FINANCE_CODE_PREFIXES = ['70', '71', '72', '73', '74'];
const DEPRECIATION_NAME = /\b(depreciation|amorti[sz]ation)\b/i;
const TAX_NAME = /\b(income tax|corporate tax|corporation tax|tax expense|taxation)\b/i;
const FINANCE_NAME = /\b(finance costs?|interest expense|interest on|bank charges?|fx losses?|foreign exchange losses?|loss on disposal)\b/i;
const OTHER_INCOME_NAME = /\b(other income|interest income|fx gain|foreign exchange gain|gain on disposal|discount received|miscellaneous income)\b/i;
const COST_OF_SALES_NAME = /\b(cost of sales|cost of goods sold|direct (materials|labour|labor|costs?)|purchases|inventory adjustment)\b/i;

function startsWithAny(code: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => code.startsWith(prefix));
}

/**
 * IFRS statement classification for the current Ledgr chart, whose standard
 * ranges are 4xxx revenue/other income, 5xxx cost of sales, 6xxx operating
 * expenses, 68xx depreciation/amortisation, 70xx–74xx finance costs and 75xx
 * income tax. Specific account types and name/code matches intentionally win
 * before broad account-type and range fallbacks so custom charts are handled
 * without letting a generic "expense" type swallow more specific categories.
 */
function sectionForAccount(row: TrialBalanceRow): PnlSectionKey | null {
  const type = String(row.account_type ?? '').trim().toLowerCase();
  const code = String(row.account_code ?? '').trim();
  const name = String(row.account_name ?? '').trim();
  const hasPrefix = (prefix: string) => code.startsWith(prefix);

  // Specific account name/range heuristics precede broad type fallback.
  if (hasPrefix(TAX_CODE_PREFIX) || TAX_NAME.test(name) || type === 'tax_expense') return 'taxExpense';
  if (hasPrefix(DEPRECIATION_CODE_PREFIX) || DEPRECIATION_NAME.test(name) || type === 'depreciation_amortisation') {
    return 'depreciationAmortisation';
  }
  if (startsWithAny(code, FINANCE_CODE_PREFIXES) || FINANCE_NAME.test(name)
    || type === 'finance_cost' || type === 'other_expense') return 'financeCosts';
  if (hasPrefix('5') || COST_OF_SALES_NAME.test(name) || type === 'cogs' || type === 'cost_of_sales') {
    return 'costOfSales';
  }
  if (hasPrefix('42') || OTHER_INCOME_NAME.test(name) || type === 'other_income') return 'otherIncome';

  if (type === 'revenue' || type === 'income') {
    // Code 42 and specific income names were captured above. Legacy 7xxx
    // income accounts are also non-operating income; remaining 4xxx is revenue.
    return hasPrefix('7') ? 'otherIncome' : 'revenue';
  }
  if (type === 'expense' || type === 'operating_expense') return 'operatingExpenses';

  // Narrow fallback is reserved for legacy/untyped rows; never include BS codes.
  if (type && type !== 'unknown') return null;
  if (hasPrefix('4')) return 'revenue';
  if (hasPrefix('5')) return 'costOfSales';
  if (hasPrefix('6')) return 'operatingExpenses';
  if (hasPrefix('7')) return 'financeCosts';
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
    // Trial-balance balance is debit minus credit. Income is credit-positive;
    // expense accounts are debit-positive; contra balances retain their sign.
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

  const total = (key: PnlSectionKey) => sectionsByKey.get(key)!.total;
  const grossProfit = total('revenue') - total('costOfSales');
  const operatingProfit = grossProfit + total('otherIncome')
    - total('operatingExpenses') - total('depreciationAmortisation');
  const profitBeforeTax = operatingProfit - total('financeCosts');
  const netIncome = profitBeforeTax - total('taxExpense');

  return {
    sections,
    computedLines: [
      { key: 'grossProfit', labelKey: 'reports.pnl.grossProfit', amount: grossProfit, isSubtotal: true },
      { key: 'operatingProfit', labelKey: 'reports.pnl.operatingProfit', amount: operatingProfit, isSubtotal: true },
      { key: 'profitBeforeTax', labelKey: 'reports.pnl.profitBeforeTax', amount: profitBeforeTax, isSubtotal: true },
      { key: 'netProfit', labelKey: 'reports.pnl.netProfit', amount: netIncome, isSubtotal: true },
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
