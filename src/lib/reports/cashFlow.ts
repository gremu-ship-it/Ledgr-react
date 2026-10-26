import type { TrialBalanceRow } from '@/dal/repositories/ReportRepository';
import type { BsAccountLine, BsReport } from '@/lib/reports/balanceSheet';
import type { PnlReport, PnlSectionKey } from '@/lib/reports/pnl';

export type CashFlowSectionKey = 'operating' | 'investing' | 'financing';

export interface CashFlowLine {
  key: string;
  labelKey: string;
  amount: number;
  isSubtotal?: boolean;
}

export interface CashFlowSection {
  key: CashFlowSectionKey;
  labelKey: string;
  lines: CashFlowLine[];
  total: number;
}

export interface CashFlowReport {
  sections: CashFlowSection[];
  netCashChange: number;
  cashBeginning: number;
  cashEnd: number;
  isReconciled: boolean;
  discrepancy: number;
}

export const CASH_FLOW_BALANCE_START_DATE = '2020-01-01';
const CASH_RECONCILIATION_TOLERANCE = 0.01;
const DISPOSAL_NAME = /dispos(?:al|ed)|sale of (?:fixed )?(?:assets?|property|equipment)/i;
const DEPRECIATION_NAME = /depreciat|amortis/i;
const IMPAIRMENT_NAME = /impairment/i;
const ACCUMULATED_DEPRECIATION_NAME = /\baccum(?:ulated)?(?:\.|\b)/i;
const INTANGIBLE_NAME = /intangib|software|licen[cs]e|goodwill/i;
const PPE_NAME = /property|building|land|plant|machinery|motor vehicle|equipment|furniture|right.of.use/i;

export interface CashFlowPeriod {
  from: string;
  to: string;
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function isValidCashFlowPeriod(period: CashFlowPeriod): boolean {
  return isValidIsoDate(period.from)
    && isValidIsoDate(period.to)
    && period.from >= CASH_FLOW_BALANCE_START_DATE
    && period.from <= period.to;
}

export function dayBefore(dateValue: string): string | null {
  if (!isValidIsoDate(dateValue)) return null;
  const [year, month, day] = dateValue.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/** Infer cash/bank/mobile-money codes from the Trial Balance's live account rows. */
export function detectCashAccountCodes(rows: TrialBalanceRow[]): string[] {
  return [...new Set(rows.flatMap((row) => {
    const type = String(row.account_type ?? '').trim().toLowerCase();
    const code = String(row.account_code ?? '').trim();
    const name = String(row.account_name ?? '').trim();
    if (type !== 'asset') return [];
    if (/^(111|112)/.test(code) || /cash|bank|current account|savings account|mobile money|mpamba|airtel money/i.test(name)) {
      return [code];
    }
    return [];
  }).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

type BalanceSheetSide = 'assets' | 'liabilities' | 'equity';
type AccountPredicate = (account: BsAccountLine) => boolean;

function accountsOnSide(report: BsReport, side: BalanceSheetSide): BsAccountLine[] {
  return report[side].flatMap((section) => section.accounts);
}

function deltasOnSide(
  current: BsReport,
  prior: BsReport,
  side: BalanceSheetSide,
  predicate: AccountPredicate,
): number[] {
  const currentAccounts = new Map(accountsOnSide(current, side).map((account) => [account.accountId, account]));
  const priorAccounts = new Map(accountsOnSide(prior, side).map((account) => [account.accountId, account]));
  const ids = new Set([...currentAccounts.keys(), ...priorAccounts.keys()]);
  const deltas: number[] = [];
  for (const id of ids) {
    const account = currentAccounts.get(id) ?? priorAccounts.get(id);
    if (!account || !predicate(account)) continue;
    deltas.push((currentAccounts.get(id)?.amount ?? 0) - (priorAccounts.get(id)?.amount ?? 0));
  }
  return deltas;
}

function sum(values: number[]): number {
  return values.reduce((total, amount) => total + (Number.isFinite(amount) ? amount : 0), 0);
}

function startsWithAny(code: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => code.startsWith(prefix));
}

function isTradeDebtor(account: BsAccountLine): boolean {
  const code = String(account.accountCode ?? '').trim();
  const name = String(account.accountName ?? '').trim();
  return code === '1130' || code === '1131' || /trade debt(?:or|ors)|trade receivable|accounts receivable/i.test(name);
}

function isWorkInProgress(account: BsAccountLine): boolean {
  const code = String(account.accountCode ?? '').trim();
  const name = String(account.accountName ?? '').trim();
  return code === '1142' || code === '1201' || /work in progress|\bwip\b/i.test(name);
}

function isInventory(account: BsAccountLine): boolean {
  const code = String(account.accountCode ?? '').trim();
  const name = String(account.accountName ?? '').trim();
  if (isWorkInProgress(account)) return false;
  return code.startsWith('114') || /inventory|inventories|raw materials|finished goods|agricultural produce/i.test(name);
}

function isTradeCreditor(account: BsAccountLine): boolean {
  const code = String(account.accountCode ?? '').trim();
  const name = String(account.accountName ?? '').trim();
  return ['2110', '2111', '2114'].includes(code)
    || /accounts payable|trade creditors|goods received not invoiced/i.test(name);
}

function isAccruedExpense(account: BsAccountLine): boolean {
  const code = String(account.accountCode ?? '').trim();
  const name = String(account.accountName ?? '').trim();
  return ['2112', '2130', '2131', '2132'].includes(code)
    || /accrued expenses|payroll liabilities|salaries.*payable|pension contributions payable/i.test(name);
}

function isVatPayable(account: BsAccountLine): boolean {
  const code = String(account.accountCode ?? '').trim();
  const name = String(account.accountName ?? '').trim();
  return code === '2121' || /vat payable/i.test(name);
}

function isRetentionPayable(account: BsAccountLine): boolean {
  return /retention.*payable|payable.*retention/i.test(String(account.accountName ?? '').trim());
}

function isBorrowing(account: BsAccountLine): boolean {
  const code = String(account.accountCode ?? '').trim();
  const name = String(account.accountName ?? '').trim();
  return /loan|borrow|long.term debt|finance lease|hire purchase payable|bank overdraft/i.test(name)
    || startsWithAny(code, ['216', '221', '222', '251']);
}

function isShareCapital(account: BsAccountLine): boolean {
  const code = String(account.accountCode ?? '').trim();
  const name = String(account.accountName ?? '').trim();
  if (/retained earnings|profit\s*\/\s*loss|drawings|dividend/i.test(name)) return false;
  return startsWithAny(code, ['300', '310', '311'])
    || /share capital|share premium|owner'?s capital|capital contribution/i.test(name);
}

function isDividendOrDrawing(account: BsAccountLine): boolean {
  const code = String(account.accountCode ?? '').trim();
  const name = String(account.accountName ?? '').trim();
  return ['3140', '3500', '3600'].includes(code) || /dividend|drawing/i.test(name);
}

function isAccumulatedDepreciation(account: BsAccountLine): boolean {
  return ACCUMULATED_DEPRECIATION_NAME.test(String(account.accountName ?? '').trim());
}

function isIntangibleAsset(account: BsAccountLine): boolean {
  const code = String(account.accountCode ?? '').trim();
  const name = String(account.accountName ?? '').trim();
  if (isAccumulatedDepreciation(account)) return false;
  return startsWithAny(code, ['135', '153']) || INTANGIBLE_NAME.test(name);
}

function isTangiblePpe(account: BsAccountLine): boolean {
  const code = String(account.accountCode ?? '').trim();
  const name = String(account.accountName ?? '').trim();
  if (isAccumulatedDepreciation(account) || isIntangibleAsset(account)) return false;
  return startsWithAny(code, ['13', '14', '151', '152', '1545']) || PPE_NAME.test(name);
}

function signedPnlLines(pnl: PnlReport, tbCurrent: TrialBalanceRow[]) {
  const rowsById = new Map(tbCurrent.map((row) => [row.account_id, row]));
  return pnl.sections.flatMap((section) => section.accounts.map((account) => ({
    account,
    sectionKey: section.key,
    sourceType: String(rowsById.get(account.accountId)?.account_type ?? '').trim().toLowerCase(),
  })));
}

function isPnlExpenseType(type: string): boolean {
  return !['asset', 'liability', 'equity'].includes(type);
}

function makeSection(
  key: CashFlowSectionKey,
  labelKey: string,
  lines: CashFlowLine[],
  subtotalKey: string,
  subtotalLabelKey: string,
): CashFlowSection {
  const total = sum(lines.map((line) => line.amount));
  return {
    key,
    labelKey,
    lines: [...lines, { key: subtotalKey, labelKey: subtotalLabelKey, amount: total, isSubtotal: true }],
    total,
  };
}

function line(key: string, amount: number): CashFlowLine {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  return { key, labelKey: `reports.cashFlow.${key}`, amount: Object.is(safeAmount, -0) ? 0 : safeAmount };
}

export function computeCashFlow(
  pnlCurrent: PnlReport,
  bsCurrent: BsReport,
  bsPrior: BsReport,
  tbCurrent: TrialBalanceRow[],
  cashAccountCodes: string[],
): CashFlowReport {
  const pnlLines = signedPnlLines(pnlCurrent, tbCurrent);
  const expenseLines = pnlLines.filter(({ sourceType, sectionKey }) =>
    isPnlExpenseType(sourceType) && ['cogs', 'operatingExpenses', 'otherExpenses'].includes(sectionKey),
  );
  const depreciation = sum(expenseLines
    .filter(({ account }) => DEPRECIATION_NAME.test(account.accountName))
    .map(({ account }) => account.amount));
  const impairment = sum(expenseLines
    .filter(({ account }) => IMPAIRMENT_NAME.test(account.accountName))
    .map(({ account }) => account.amount));
  const gainLossDisposal = sum(pnlLines
    .filter(({ account }) => DISPOSAL_NAME.test(account.accountName))
    .map(({ account, sectionKey }) =>
      isIncomeSection(sectionKey) ? -account.amount : account.amount,
    ));

  const debtorDelta = sum(deltasOnSide(bsCurrent, bsPrior, 'assets', isTradeDebtor));
  const inventoryDelta = sum(deltasOnSide(bsCurrent, bsPrior, 'assets', isInventory));
  const wipDelta = sum(deltasOnSide(bsCurrent, bsPrior, 'assets', isWorkInProgress));
  const creditorDelta = sum(deltasOnSide(bsCurrent, bsPrior, 'liabilities', isTradeCreditor));
  const accrualDelta = sum(deltasOnSide(bsCurrent, bsPrior, 'liabilities', isAccruedExpense));
  const vatDelta = sum(deltasOnSide(bsCurrent, bsPrior, 'liabilities', isVatPayable));
  const retentionDelta = sum(deltasOnSide(bsCurrent, bsPrior, 'liabilities', isRetentionPayable));

  const ppeDeltas = deltasOnSide(bsCurrent, bsPrior, 'assets', isTangiblePpe);
  const intangibleDeltas = deltasOnSide(bsCurrent, bsPrior, 'assets', isIntangibleAsset);
  const purchasePpe = -sum(ppeDeltas.map((delta) => Math.max(0, delta)));
  const proceedsDisposal = sum([
    ...ppeDeltas.map((delta) => Math.max(0, -delta)),
    ...intangibleDeltas.map((delta) => Math.max(0, -delta)),
  ]);
  const purchaseIntangibles = -sum(intangibleDeltas.map((delta) => Math.max(0, delta)));

  const borrowingDeltas = deltasOnSide(bsCurrent, bsPrior, 'liabilities', isBorrowing);
  const proceedsBorrowings = sum(borrowingDeltas.map((delta) => Math.max(0, delta)));
  const repaymentBorrowings = -sum(borrowingDeltas.map((delta) => Math.max(0, -delta)));
  const dividendsPaid = sum(deltasOnSide(bsCurrent, bsPrior, 'equity', isDividendOrDrawing));
  const capitalContributions = sum(deltasOnSide(bsCurrent, bsPrior, 'equity', isShareCapital));

  const operating = makeSection('operating', 'reports.cashFlow.operating', [
    line('netIncome', pnlCurrent.netIncome),
    line('depreciation', depreciation),
    line('impairment', impairment),
    line('gainLossDisposal', gainLossDisposal),
    line('changeInDebtors', -debtorDelta),
    line('changeInInventory', -inventoryDelta),
    line('changeInWip', -wipDelta),
    line('changeInCreditors', creditorDelta),
    line('changeInAccruals', accrualDelta),
    line('changeInVat', vatDelta),
    line('changeInRetention', retentionDelta),
  ], 'netOperating', 'reports.cashFlow.netOperating');

  const investing = makeSection('investing', 'reports.cashFlow.investing', [
    line('purchasePPE', purchasePpe),
    line('proceedsDisposal', proceedsDisposal),
    line('purchaseIntangibles', purchaseIntangibles),
  ], 'netInvesting', 'reports.cashFlow.netInvesting');

  const financing = makeSection('financing', 'reports.cashFlow.financing', [
    line('proceedsBorrowings', proceedsBorrowings),
    line('repaymentBorrowings', repaymentBorrowings),
    line('dividendsPaid', dividendsPaid),
    line('capitalContributions', capitalContributions),
  ], 'netFinancing', 'reports.cashFlow.netFinancing');

  const cashCodes = new Set(cashAccountCodes.map((code) => String(code).trim()));
  const cashBalance = (report: BsReport) => sum(accountsOnSide(report, 'assets')
    .filter((account) => cashCodes.has(account.accountCode))
    .map((account) => account.amount));
  const cashBeginning = cashBalance(bsPrior);
  const cashEnd = cashBalance(bsCurrent);
  const netCashChange = operating.total + investing.total + financing.total;
  const discrepancy = cashBeginning + netCashChange - cashEnd;

  return {
    sections: [operating, investing, financing],
    netCashChange,
    cashBeginning,
    cashEnd,
    isReconciled: Math.abs(discrepancy) <= CASH_RECONCILIATION_TOLERANCE,
    discrepancy,
  };
}

/** Prefix-based delta helper is useful for callers with a chart-specific range. */
export function bsDelta(current: BsReport, prior: BsReport, accountCodePrefix: string): number {
  const predicate = (account: BsAccountLine) => account.accountCode.startsWith(accountCodePrefix);
  return sum(deltasOnSide(current, prior, 'assets', predicate))
    + sum(deltasOnSide(current, prior, 'liabilities', predicate))
    + sum(deltasOnSide(current, prior, 'equity', predicate));
}

export function lineByKey(report: CashFlowReport, key: string): CashFlowLine | undefined {
  return report.sections.flatMap((section) => section.lines).find((entry) => entry.key === key);
}

export function cashFlowSection(report: CashFlowReport, key: CashFlowSectionKey): CashFlowSection | undefined {
  return report.sections.find((section) => section.key === key);
}

export function isIncomeSection(key: PnlSectionKey): boolean {
  return key === 'revenue' || key === 'otherIncome';
}
