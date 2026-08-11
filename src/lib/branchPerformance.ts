import type { AccountSubtype, Row } from '@/dal/types/database';
import { asNormalBalance, toStatementSide } from './statementPresentation';

export const UNASSIGNED_BRANCH_ID = '__unassigned__';
const TOLERANCE = 0.01;

export type AccountRef = Pick<Row<'accounts'>, 'id' | 'code' | 'name' | 'account_subtype' | 'normal_balance'>;
export type BranchRef = Pick<Row<'branches'>, 'id' | 'name' | 'code' | 'location' | 'is_active'>;

export type JournalLineForBranchReport = {
  branch_id: string | null;
  is_debit: boolean;
  amount_base: number;
  accounts: AccountRef | null;
  journal_entries: {
    branch_id: string | null;
    entry_date: string;
    status: string;
  } | null;
};

export type AccountBreakdown = {
  key: string;
  code: string;
  name: string;
  subtype: AccountSubtype;
  amount: number;
};

export type BranchPerformanceRow = {
  branchId: string;
  branchName: string;
  branchCode: string | null;
  location: string | null;
  isActive: boolean;
  revenue: number;
  otherIncome: number;
  costOfSales: number;
  operatingExpenses: number;
  depreciationAmortisation: number;
  financeCosts: number;
  taxExpense: number;
  grossProfit: number;
  operatingProfit: number;
  netProfit: number;
  grossMargin: number | null;
  netMargin: number | null;
  accountBreakdown: AccountBreakdown[];
};

const P_AND_L_SUBTYPES = new Set<AccountSubtype>([
  'revenue',
  'other_income',
  'cost_of_sales',
  'operating_expense',
  'depreciation_amortisation',
  'finance_cost',
  'tax_expense',
]);

function emptyBranchRow(branch: BranchRef): BranchPerformanceRow {
  return {
    branchId: branch.id,
    branchName: branch.name,
    branchCode: branch.code,
    location: branch.location,
    isActive: branch.is_active,
    revenue: 0,
    otherIncome: 0,
    costOfSales: 0,
    operatingExpenses: 0,
    depreciationAmortisation: 0,
    financeCosts: 0,
    taxExpense: 0,
    grossProfit: 0,
    operatingProfit: 0,
    netProfit: 0,
    grossMargin: null,
    netMargin: null,
    accountBreakdown: [],
  };
}

function finalizeBranchRow(row: BranchPerformanceRow): BranchPerformanceRow {
  const grossProfit = row.revenue - row.costOfSales;
  const operatingProfit = grossProfit + row.otherIncome - row.operatingExpenses - row.depreciationAmortisation;
  const netProfit = operatingProfit - row.financeCosts - row.taxExpense;
  const totalIncome = row.revenue + row.otherIncome;

  return {
    ...row,
    grossProfit,
    operatingProfit,
    netProfit,
    grossMargin: Math.abs(row.revenue) > TOLERANCE ? (grossProfit / row.revenue) * 100 : null,
    netMargin: Math.abs(totalIncome) > TOLERANCE ? (netProfit / totalIncome) * 100 : null,
    accountBreakdown: row.accountBreakdown
      .filter((line) => Math.abs(line.amount) > TOLERANCE)
      .sort((a, b) => a.code.localeCompare(b.code)),
  };
}

function addAmountToRow(row: BranchPerformanceRow, subtype: AccountSubtype, amount: number): void {
  switch (subtype) {
    case 'revenue':
      row.revenue += amount;
      break;
    case 'other_income':
      row.otherIncome += amount;
      break;
    case 'cost_of_sales':
      row.costOfSales += amount;
      break;
    case 'operating_expense':
      row.operatingExpenses += amount;
      break;
    case 'depreciation_amortisation':
      row.depreciationAmortisation += amount;
      break;
    case 'finance_cost':
      row.financeCosts += amount;
      break;
    case 'tax_expense':
      row.taxExpense += amount;
      break;
    default:
      break;
  }
}

/**
 * Builds branch P&L rows on each statement section's presentation side.
 * Contra accounts therefore reduce their section: Sales Discounts reduce
 * Revenue and Purchase Discounts reduce Cost of Sales.
 */
export function buildBranchPerformance(
  branches: BranchRef[],
  lines: JournalLineForBranchReport[],
): BranchPerformanceRow[] {
  const rowMap = new Map<string, BranchPerformanceRow>();

  for (const branch of branches) {
    rowMap.set(branch.id, emptyBranchRow(branch));
  }

  const unassignedBranch: BranchRef = {
    id: UNASSIGNED_BRANCH_ID,
    name: 'Unassigned transactions',
    code: null,
    location: 'No branch selected on journal entry',
    is_active: true,
  };

  const ensureRow = (branchId: string): BranchPerformanceRow => {
    const existing = rowMap.get(branchId);
    if (existing) return existing;

    const branch = branchId === UNASSIGNED_BRANCH_ID
      ? unassignedBranch
      : { id: branchId, name: 'Unknown branch', code: null, location: null, is_active: false };
    const row = emptyBranchRow(branch);
    rowMap.set(branchId, row);
    return row;
  };

  for (const line of lines) {
    const account = line.accounts;
    const subtype = account?.account_subtype;
    if (!account || !subtype || !P_AND_L_SUBTYPES.has(subtype)) continue;

    const branchId = line.branch_id ?? line.journal_entries?.branch_id ?? UNASSIGNED_BRANCH_ID;
    const row = ensureRow(branchId);
    const signedAmount = line.is_debit ? Number(line.amount_base) : -Number(line.amount_base);
    const accountNormalBalance = asNormalBalance(account.normal_balance);
    const naturalAmount = accountNormalBalance === 'debit' ? signedAmount : -signedAmount;
    const sectionNormalBalance = subtype === 'revenue' || subtype === 'other_income' ? 'credit' : 'debit';
    const statementAmount = toStatementSide(
      naturalAmount,
      accountNormalBalance,
      sectionNormalBalance,
    );

    addAmountToRow(row, subtype, statementAmount);

    const breakdownKey = `${account.id}:${subtype}`;
    const existing = row.accountBreakdown.find((item) => item.key === breakdownKey);
    if (existing) {
      existing.amount += statementAmount;
    } else {
      row.accountBreakdown.push({
        key: breakdownKey,
        code: account.code,
        name: account.name,
        subtype,
        amount: statementAmount,
      });
    }
  }

  return Array.from(rowMap.values())
    .map(finalizeBranchRow)
    .filter((row) => row.branchId !== UNASSIGNED_BRANCH_ID || row.accountBreakdown.length > 0)
    .sort((a, b) => {
      if (a.branchId === UNASSIGNED_BRANCH_ID) return 1;
      if (b.branchId === UNASSIGNED_BRANCH_ID) return -1;
      return b.netProfit - a.netProfit;
    });
}
