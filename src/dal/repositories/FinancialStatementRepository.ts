import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row, AccountSubtype } from '../types/database';
import { BaseRepository } from './BaseRepository';
import { toRepositoryError } from '../errors/RepositoryError';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AccountBalance {
  account: Row<'accounts'>;
  balance: number; // signed per normal_balance convention (positive = natural side)
}

export interface StatementLineItem {
  code: string;
  name: string;
  amount: number;
  comparativeAmount: number | null;
}

export interface StatementSection {
  label: string;
  lines: StatementLineItem[];
  subtotal: number;
  comparativeSubtotal: number | null;
}

export interface StatementOfFinancialPosition {
  asOfDate: string;
  comparativeDate: string | null;
  currentAssets: StatementSection;
  nonCurrentAssets: StatementSection;
  totalAssets: number;
  comparativeTotalAssets: number | null;
  currentLiabilities: StatementSection;
  nonCurrentLiabilities: StatementSection;
  totalLiabilities: number;
  comparativeTotalLiabilities: number | null;
  netAssets: number;
  comparativeNetAssets: number | null;
  equity: StatementSection;
  totalEquity: number;
  comparativeTotalEquity: number | null;
  isBalanced: boolean; // totalAssets === totalLiabilities + totalEquity (within tolerance)
}

export interface StatementOfProfitOrLoss {
  periodStart: string;
  periodEnd: string;
  comparativePeriodStart: string | null;
  comparativePeriodEnd: string | null;
  revenue: StatementSection;
  totalRevenue: number;
  comparativeTotalRevenue: number | null;
  costOfSales: StatementSection;
  totalCostOfSales: number;
  comparativeTotalCostOfSales: number | null;
  grossProfit: number;
  comparativeGrossProfit: number | null;
  otherIncome: StatementSection;
  totalOtherIncome: number;
  comparativeTotalOtherIncome: number | null;
  operatingExpenses: StatementSection;
  totalOperatingExpenses: number;
  comparativeTotalOperatingExpenses: number | null;
  depreciationAmortisation: StatementSection;
  totalDepreciationAmortisation: number;
  comparativeTotalDepreciationAmortisation: number | null;
  operatingProfit: number;
  comparativeOperatingProfit: number | null;
  financeCosts: StatementSection;
  totalFinanceCosts: number;
  comparativeTotalFinanceCosts: number | null;
  profitBeforeTax: number;
  comparativeProfitBeforeTax: number | null;
  taxExpense: StatementSection;
  totalTaxExpense: number;
  comparativeTotalTaxExpense: number | null;
  netProfit: number;
  comparativeNetProfit: number | null;
}

export interface CashFlowStatement {
  periodStart: string;
  periodEnd: string;
  comparativePeriodStart: string | null;
  comparativePeriodEnd: string | null;

  netProfit: number;
  comparativeNetProfit: number | null;
  depreciationAmortisationAddBack: number;
  comparativeDepreciationAmortisationAddBack: number | null;
  otherOperatingMovements: number;
  comparativeOtherOperatingMovements: number | null;
  netCashFromOperating: number;
  comparativeNetCashFromOperating: number | null;

  assetPurchases: number;
  comparativeAssetPurchases: number | null;
  assetDisposalProceeds: number;
  comparativeAssetDisposalProceeds: number | null;
  netCashFromInvesting: number;
  comparativeNetCashFromInvesting: number | null;

  loanDrawdowns: number;
  comparativeLoanDrawdowns: number | null;
  loanRepayments: number;
  comparativeLoanRepayments: number | null;
  shareCapitalContributions: number;
  comparativeShareCapitalContributions: number | null;
  drawingsAndDividendsPaid: number;
  comparativeDrawingsAndDividendsPaid: number | null;
  netCashFromFinancing: number;
  comparativeNetCashFromFinancing: number | null;

  netMovementInCash: number;
  comparativeNetMovementInCash: number | null;
  openingCashBalance: number;
  comparativeOpeningCashBalance: number | null;
  closingCashBalance: number;
  comparativeClosingCashBalance: number | null;
  reconciles: boolean;
}

export interface EquityRollForwardLine {
  label: string;
  openingBalance: number;
  netProfitAllocation: number;
  contributions: number;
  drawingsOrDividends: number;
  otherMovements: number;
  closingBalance: number;
}

export interface StatementOfChangesInEquity {
  periodStart: string;
  periodEnd: string;
  shareCapital: EquityRollForwardLine;
  retainedEarnings: EquityRollForwardLine;
  reserves: EquityRollForwardLine;
  totalOpeningEquity: number;
  totalClosingEquity: number;
  reconciles: boolean;
}

const TOLERANCE = 0.01; // MWK rounding tolerance for balance checks
const LOAN_ACCOUNT_CODES = new Set(['2140', '2145', '2510', '2511', '2512', '2515']);
const DRAWINGS_DIVIDENDS_CODE = '3140';

// ── Repository ────────────────────────────────────────────────────────────────

export class FinancialStatementRepository extends BaseRepository<'accounts'> {
  constructor(client: SupabaseClient<Database>) {
    super(client, 'accounts');
  }

  // ── Core balance computation ────────────────────────────────────────────────

  /**
   * Computes the balance of every posting (non-group) account for a business,
   * as of a point in time (for SOFP) or across a date range (for P&L).
   *
   * Uses `amount_base` exclusively (MWK functional currency) — matches the
   * convention established in JournalRepository's double-entry balance check.
   * `journal_lines.amount` (original transaction currency) is intentionally
   * not used here; multi-currency entries would otherwise misstate balances.
   *
   * Balance sign convention: positive = natural balance side for the account
   * (e.g. a debit-normal asset account with balance 500 means MWK 500 debit
   * balance). Callers flip sign as needed for presentation.
   */
  private async computeBalances(
    businessId: string,
    options: { asOfDate?: string; dateFrom?: string; dateTo?: string; includeOpeningBalances: boolean },
  ): Promise<AccountBalance[]> {
    const accounts = await this.client
      .from('accounts')
      .select('*')
      .eq('business_id', businessId)
      .eq('is_group', false)
      .is('deleted_at', null);

    if (accounts.error) throw toRepositoryError('accounts', accounts.error);
    const accountRows = (accounts.data ?? []) as Row<'accounts'>[];
    const accountMap = new Map(accountRows.map((a) => [a.id, a]));

    let query = this.client
      .from('journal_lines')
      .select('account_id, is_debit, amount_base, journal_entries!inner(entry_date, status, business_id)')
      .eq('business_id', businessId)
      .eq('journal_entries.business_id', businessId)
      .in('journal_entries.status', ['posted', 'reversed']);

    if (options.asOfDate) {
      query = query.lte('journal_entries.entry_date', options.asOfDate);
    }
    if (options.dateFrom) {
      query = query.gte('journal_entries.entry_date', options.dateFrom);
    }
    if (options.dateTo) {
      query = query.lte('journal_entries.entry_date', options.dateTo);
    }

    const { data: lines, error: linesError } = await query;
    if (linesError) throw toRepositoryError('journal_lines', linesError);

    const rawBalances = new Map<string, number>();
    for (const line of (lines ?? []) as { account_id: string; is_debit: boolean; amount_base: number }[]) {
      const acc = accountMap.get(line.account_id);
      if (!acc) continue;
      const signedAmount = line.is_debit ? Number(line.amount_base) : -Number(line.amount_base);
      // Normalize to the account's natural balance side.
      const natural = acc.normal_balance === 'debit' ? signedAmount : -signedAmount;
      rawBalances.set(acc.id, (rawBalances.get(acc.id) ?? 0) + natural);
    }

    // Opening balances only apply to point-in-time (SOFP) balances, not
    // period-flow (P&L) balances — an opening balance on a revenue/expense
    // account would double count prior-period activity already closed to
    // retained earnings.
    if (options.includeOpeningBalances) {
      for (const acc of accountRows) {
        const ob = Number(acc.opening_balance ?? 0);
        if (ob === 0) continue;
        // opening_balance is stored as a natural-side amount already.
        rawBalances.set(acc.id, (rawBalances.get(acc.id) ?? 0) + ob);
      }
    }

    return accountRows.map((account) => ({
      account,
      balance: rawBalances.get(account.id) ?? 0,
    }));
  }

  private buildSection(
    balances: AccountBalance[],
    comparativeBalances: AccountBalance[] | null,
    subtypes: Exclude<AccountSubtype, null>[],
    label: string,
  ): StatementSection {
    const relevant = balances
      .filter((b) => b.account.account_subtype !== null
        && subtypes.includes(b.account.account_subtype)
        && Math.abs(b.balance) > TOLERANCE)
      .sort((a, b) => a.account.code.localeCompare(b.account.code));

    const comparativeMap = comparativeBalances
      ? new Map(comparativeBalances.map((b) => [b.account.id, b.balance]))
      : null;

    const lines: StatementLineItem[] = relevant.map((b) => ({
      code: b.account.code,
      name: b.account.name,
      amount: b.balance,
      comparativeAmount: comparativeMap ? (comparativeMap.get(b.account.id) ?? 0) : null,
    }));

    const subtotal = lines.reduce((s, l) => s + l.amount, 0);
    const comparativeSubtotal = comparativeMap
      ? lines.reduce((s, l) => s + (l.comparativeAmount ?? 0), 0)
      : null;

    return { label, lines, subtotal, comparativeSubtotal };
  }

  // ── Statement of Financial Position (IAS 1) ─────────────────────────────────

  async getSOFP(
    businessId: string,
    asOfDate: string,
    comparativeDate: string | null = null,
  ): Promise<StatementOfFinancialPosition> {
    const balances = await this.computeBalances(businessId, {
      asOfDate,
      includeOpeningBalances: true,
    });

    const comparativeBalances = comparativeDate
      ? await this.computeBalances(businessId, { asOfDate: comparativeDate, includeOpeningBalances: true })
      : null;

    const currentAssets = this.buildSection(balances, comparativeBalances, ['current_asset'], 'Current Assets');
    const nonCurrentAssets = this.buildSection(
      balances, comparativeBalances,
      ['non_current_asset', 'fixed_asset'],
      'Non-Current Assets',
    );
    const currentLiabilities = this.buildSection(balances, comparativeBalances, ['current_liability'], 'Current Liabilities');
    const nonCurrentLiabilities = this.buildSection(balances, comparativeBalances, ['non_current_liability'], 'Non-Current Liabilities');
    const equity = this.buildSection(
      balances, comparativeBalances,
      ['share_capital', 'retained_earnings', 'reserves'],
      'Equity',
    );

    const totalAssets = currentAssets.subtotal + nonCurrentAssets.subtotal;
    const comparativeTotalAssets = comparativeBalances
      ? (currentAssets.comparativeSubtotal ?? 0) + (nonCurrentAssets.comparativeSubtotal ?? 0)
      : null;

    const totalLiabilities = currentLiabilities.subtotal + nonCurrentLiabilities.subtotal;
    const comparativeTotalLiabilities = comparativeBalances
      ? (currentLiabilities.comparativeSubtotal ?? 0) + (nonCurrentLiabilities.comparativeSubtotal ?? 0)
      : null;

    const netAssets = totalAssets - totalLiabilities;
    const comparativeNetAssets = comparativeBalances
      ? (comparativeTotalAssets ?? 0) - (comparativeTotalLiabilities ?? 0)
      : null;

    const totalEquity = equity.subtotal;
    const comparativeTotalEquity = comparativeBalances ? equity.comparativeSubtotal : null;

    // Equity accounts (share_capital, retained_earnings, reserves) do not
    // include current-year P&L until closed to retained earnings via
    // account 3130 ("Current Year Profit / Loss"). If the business hasn't
    // run a period-close routine, netAssets and totalEquity will diverge
    // by exactly the current year's unclosed net profit. This is surfaced
    // via isBalanced rather than silently reconciled, since forcing them
    // to match would hide a real bookkeeping gap the user should know about.
    const isBalanced = Math.abs(netAssets - totalEquity) < TOLERANCE;

    return {
      asOfDate,
      comparativeDate,
      currentAssets,
      nonCurrentAssets,
      totalAssets,
      comparativeTotalAssets,
      currentLiabilities,
      nonCurrentLiabilities,
      totalLiabilities,
      comparativeTotalLiabilities,
      netAssets,
      comparativeNetAssets,
      equity,
      totalEquity,
      comparativeTotalEquity,
      isBalanced,
    };
  }

  // ── Statement of Profit or Loss (IAS 1) ─────────────────────────────────────

  async getProfitOrLoss(
    businessId: string,
    periodStart: string,
    periodEnd: string,
    comparativePeriodStart: string | null = null,
    comparativePeriodEnd: string | null = null,
  ): Promise<StatementOfProfitOrLoss> {
    const balances = await this.computeBalances(businessId, {
      dateFrom: periodStart,
      dateTo: periodEnd,
      includeOpeningBalances: false,
    });

    const comparativeBalances = (comparativePeriodStart && comparativePeriodEnd)
      ? await this.computeBalances(businessId, {
          dateFrom: comparativePeriodStart,
          dateTo: comparativePeriodEnd,
          includeOpeningBalances: false,
        })
      : null;

    // Revenue/other_income accounts are normal_balance='credit', so their
    // natural-side balance from computeBalances is already positive for a
    // credit (income) position — no sign flip needed for presentation.
    const revenue = this.buildSection(balances, comparativeBalances, ['revenue'], 'Revenue');
    const otherIncome = this.buildSection(balances, comparativeBalances, ['other_income'], 'Other Income');
    const costOfSales = this.buildSection(balances, comparativeBalances, ['cost_of_sales'], 'Cost of Sales');
    const operatingExpenses = this.buildSection(balances, comparativeBalances, ['operating_expense'], 'Operating Expenses');
    const depreciationAmortisation = this.buildSection(
      balances, comparativeBalances,
      ['depreciation_amortisation'],
      'Depreciation & Amortisation',
    );
    const financeCosts = this.buildSection(balances, comparativeBalances, ['finance_cost'], 'Finance Costs');
    const taxExpense = this.buildSection(balances, comparativeBalances, ['tax_expense'], 'Tax Expense');

    const totalRevenue = revenue.subtotal;
    const comparativeTotalRevenue = comparativeBalances ? revenue.comparativeSubtotal : null;

    const totalCostOfSales = costOfSales.subtotal;
    const comparativeTotalCostOfSales = comparativeBalances ? costOfSales.comparativeSubtotal : null;

    const grossProfit = totalRevenue - totalCostOfSales;
    const comparativeGrossProfit = comparativeBalances
      ? (comparativeTotalRevenue ?? 0) - (comparativeTotalCostOfSales ?? 0)
      : null;

    const totalOtherIncome = otherIncome.subtotal;
    const comparativeTotalOtherIncome = comparativeBalances ? otherIncome.comparativeSubtotal : null;

    const totalOperatingExpenses = operatingExpenses.subtotal;
    const comparativeTotalOperatingExpenses = comparativeBalances ? operatingExpenses.comparativeSubtotal : null;

    const totalDepreciationAmortisation = depreciationAmortisation.subtotal;
    const comparativeTotalDepreciationAmortisation = comparativeBalances
      ? depreciationAmortisation.comparativeSubtotal
      : null;

    const operatingProfit = grossProfit + totalOtherIncome - totalOperatingExpenses - totalDepreciationAmortisation;
    const comparativeOperatingProfit = comparativeBalances
      ? (comparativeGrossProfit ?? 0) + (comparativeTotalOtherIncome ?? 0)
        - (comparativeTotalOperatingExpenses ?? 0) - (comparativeTotalDepreciationAmortisation ?? 0)
      : null;

    const totalFinanceCosts = financeCosts.subtotal;
    const comparativeTotalFinanceCosts = comparativeBalances ? financeCosts.comparativeSubtotal : null;

    const profitBeforeTax = operatingProfit - totalFinanceCosts;
    const comparativeProfitBeforeTax = comparativeBalances
      ? (comparativeOperatingProfit ?? 0) - (comparativeTotalFinanceCosts ?? 0)
      : null;

    const totalTaxExpense = taxExpense.subtotal;
    const comparativeTotalTaxExpense = comparativeBalances ? taxExpense.comparativeSubtotal : null;

    const netProfit = profitBeforeTax - totalTaxExpense;
    const comparativeNetProfit = comparativeBalances
      ? (comparativeProfitBeforeTax ?? 0) - (comparativeTotalTaxExpense ?? 0)
      : null;

    return {
      periodStart,
      periodEnd,
      comparativePeriodStart,
      comparativePeriodEnd,
      revenue,
      totalRevenue,
      comparativeTotalRevenue,
      costOfSales,
      totalCostOfSales,
      comparativeTotalCostOfSales,
      grossProfit,
      comparativeGrossProfit,
      otherIncome,
      totalOtherIncome,
      comparativeTotalOtherIncome,
      operatingExpenses,
      totalOperatingExpenses,
      comparativeTotalOperatingExpenses,
      depreciationAmortisation,
      totalDepreciationAmortisation,
      comparativeTotalDepreciationAmortisation,
      operatingProfit,
      comparativeOperatingProfit,
      financeCosts,
      totalFinanceCosts,
      comparativeTotalFinanceCosts,
      profitBeforeTax,
      comparativeProfitBeforeTax,
      taxExpense,
      totalTaxExpense,
      comparativeTotalTaxExpense,
      netProfit,
      comparativeNetProfit,
    };
  }

  // ── Comparative period helper ────────────────────────────────────────────────

  /**
   * Finds the prior comparative period for a given "current" period, using
   * accounting_periods. Returns null if no closed period precedes it —
   * callers should render statements without a comparative column in that case
   * rather than guessing a date range.
   */
  async findComparativePeriod(
    _businessId: string,
    currentPeriodStart: string,
    periods: Row<'accounting_periods'>[],
  ): Promise<Row<'accounting_periods'> | null> {
    const priorClosed = periods
      .filter((p) => p.is_closed && p.period_end < currentPeriodStart)
      .sort((a, b) => b.period_end.localeCompare(a.period_end));
    return priorClosed[0] ?? null;
  }

  // ── Statement of Cash Flows (IAS 7, indirect method) ─────────────────────
  //
  // Classification hierarchy per bank-account journal line:
  //   1. journal_entries.source_type where it exists:
  //        invoice / expense / payroll / stock_transfer -> Operating
  //        fixed_asset_disposal                          -> Investing
  //        fixed_asset_revaluation                        -> excluded (no cash impact)
  //        reversal                                       -> inherits original entry's classification
  //   2. source_type null (manual entries — UNTESTED against real data as of
  //      writing; no capex/loan transactions existed in the live DB when this
  //      was built. Verify against your first real asset purchase / loan
  //      drawdown):
  //        counterpart account_subtype === 'fixed_asset'       -> Investing
  //        counterpart account code in LOAN_ACCOUNT_CODES      -> Financing
  //        counterpart account code === '3140' (Drawings/Div.) -> Financing
  //        counterpart account_subtype === 'share_capital'     -> Financing
  //        anything else                                        -> Operating (IAS 7 residual default)
  //   3. fixed_asset_depreciation never touches a bank line by nature, so
  //      it's pulled from the P&L's depreciationAmortisation total instead
  //      and added back to Net Profit as a non-cash item.

  // ── Statement of Cash Flows (IAS 7, indirect method) ─────────────────────
  //
  // CORRECTED DESIGN (v2) — the first version double-counted operating cash
  // flow by adding accrual Net Profit AND a raw bank-scan of operating-tagged
  // movements together. Net Profit already includes revenue/expenses that
  // haven't yet turned into cash (e.g. unpaid invoices), so adding actual
  // cash movements on top overstated Operating Activities and broke the
  // opening+movement=closing reconciliation.
  //
  // Correct approach (proper indirect method):
  //   Net Cash from Operating = Net Profit
  //     + Depreciation & Amortisation (non-cash add-back)
  //     − Increase in non-cash current assets (AR, inventory, prepayments...)
  //     + Increase in operating current liabilities (AP, tax payables...)
  //   This is computed entirely from balance-sheet movements, independent of
  //   scanning bank-account journal lines.
  //
  // Investing and Financing activities, by contrast, ARE derived from a
  // direct bank-line scan, since asset purchases/disposals and loan/equity
  // movements are capital transactions that don't flow through the P&L or
  // ordinary current asset/liability accounts the way operating activity
  // does.
  //
  // "Cash and cash equivalents" definition: broadened beyond the
  // `is_bank_account` flag (which per the seed file only covers 4 named bank
  // accounts, 1121–1124) to also include Cash on Hand (1110), Petty Cash
  // (1115), and both Mobile Money accounts (1125, 1126). Missing this
  // originally meant a transfer from Airtel Money into a bank account would
  // have been misread as a real external cash movement rather than an
  // internal transfer with zero net effect.
  //
  // Bank-line scan classification (Investing/Financing only):
  //   1. journal_entries.source_type where it exists:
  //        fixed_asset_disposal    -> Investing
  //        fixed_asset_revaluation -> excluded (no cash impact)
  //        reversal                -> inherits original entry's classification
  //   2. source_type null (manual entries — UNTESTED against real data; no
  //      capex/loan transactions existed in the live DB when this was
  //      built. Verify against your first real asset purchase / loan
  //      drawdown):
  //        counterpart account_subtype === 'fixed_asset'       -> Investing
  //        counterpart account code in LOAN_ACCOUNT_CODES      -> Financing
  //        counterpart account code === '3140' (Drawings/Div.) -> Financing
  //        counterpart account_subtype === 'share_capital'     -> Financing
  //   3. If BOTH sides of an entry are cash-equivalent accounts (e.g.
  //      Mobile Money -> Bank), the entry is an internal transfer and is
  //      excluded entirely — it has no effect on total cash and equivalents.
  //   4. Anything else touching a cash-equivalent account without a clear
  //      Investing/Financing signal is left to fall through into the
  //      Operating reconciliation naturally (it will already be reflected
  //      via Net Profit or working-capital changes if it was a genuine
  //      operating transaction; if not, the `reconciles` flag will catch it).

  private readonly NON_BANK_CASH_CODES = new Set(['1110', '1115', '1125', '1126']);

  private isCashEquivalent(account: Row<'accounts'>): boolean {
    return account.is_bank_account || this.NON_BANK_CASH_CODES.has(account.code);
  }

  async getCashFlow(
    businessId: string,
    periodStart: string,
    periodEnd: string,
    comparativePeriodStart: string | null = null,
    comparativePeriodEnd: string | null = null,
  ): Promise<CashFlowStatement> {
    const pl = await this.getProfitOrLoss(businessId, periodStart, periodEnd);
    const comparativePl = (comparativePeriodStart && comparativePeriodEnd)
      ? await this.getProfitOrLoss(businessId, comparativePeriodStart, comparativePeriodEnd)
      : null;

    const workingCapitalChange = await this.computeWorkingCapitalChange(businessId, periodStart, periodEnd);
    const comparativeWorkingCapitalChange = (comparativePeriodStart && comparativePeriodEnd)
      ? await this.computeWorkingCapitalChange(businessId, comparativePeriodStart, comparativePeriodEnd)
      : null;

    const investingFinancing = await this.computeInvestingFinancingMovements(businessId, periodStart, periodEnd);
    const comparativeInvestingFinancing = (comparativePeriodStart && comparativePeriodEnd)
      ? await this.computeInvestingFinancingMovements(businessId, comparativePeriodStart, comparativePeriodEnd)
      : null;

    const netCashFromOperating = pl.netProfit + pl.totalDepreciationAmortisation + workingCapitalChange;
    const comparativeNetCashFromOperating = (comparativePl && comparativeWorkingCapitalChange !== null)
      ? comparativePl.netProfit + comparativePl.totalDepreciationAmortisation + comparativeWorkingCapitalChange
      : null;

    const netCashFromInvesting = investingFinancing.assetPurchases + investingFinancing.assetDisposalProceeds;
    const comparativeNetCashFromInvesting = comparativeInvestingFinancing
      ? comparativeInvestingFinancing.assetPurchases + comparativeInvestingFinancing.assetDisposalProceeds
      : null;

    const netCashFromFinancing = investingFinancing.loanDrawdowns + investingFinancing.loanRepayments
      + investingFinancing.shareCapitalContributions + investingFinancing.drawingsAndDividendsPaid;
    const comparativeNetCashFromFinancing = comparativeInvestingFinancing
      ? comparativeInvestingFinancing.loanDrawdowns + comparativeInvestingFinancing.loanRepayments
        + comparativeInvestingFinancing.shareCapitalContributions + comparativeInvestingFinancing.drawingsAndDividendsPaid
      : null;

    const netMovementInCash = netCashFromOperating + netCashFromInvesting + netCashFromFinancing;
    const comparativeNetMovementInCash = (comparativeNetCashFromOperating !== null
      && comparativeNetCashFromInvesting !== null && comparativeNetCashFromFinancing !== null)
      ? comparativeNetCashFromOperating + comparativeNetCashFromInvesting + comparativeNetCashFromFinancing
      : null;

    const openingCashBalance = await this.getCashAndEquivalentsBalance(businessId, this.dayBefore(periodStart));
    const closingCashBalance = await this.getCashAndEquivalentsBalance(businessId, periodEnd);
    const comparativeOpeningCashBalance = comparativePeriodStart
      ? await this.getCashAndEquivalentsBalance(businessId, this.dayBefore(comparativePeriodStart))
      : null;
    const comparativeClosingCashBalance = comparativePeriodEnd
      ? await this.getCashAndEquivalentsBalance(businessId, comparativePeriodEnd)
      : null;

    const reconciles = Math.abs((openingCashBalance + netMovementInCash) - closingCashBalance) < TOLERANCE;

    return {
      periodStart, periodEnd, comparativePeriodStart, comparativePeriodEnd,
      netProfit: pl.netProfit,
      comparativeNetProfit: comparativePl?.netProfit ?? null,
      depreciationAmortisationAddBack: pl.totalDepreciationAmortisation,
      comparativeDepreciationAmortisationAddBack: comparativePl?.totalDepreciationAmortisation ?? null,
      otherOperatingMovements: workingCapitalChange,
      comparativeOtherOperatingMovements: comparativeWorkingCapitalChange,
      netCashFromOperating,
      comparativeNetCashFromOperating,
      assetPurchases: investingFinancing.assetPurchases,
      comparativeAssetPurchases: comparativeInvestingFinancing?.assetPurchases ?? null,
      assetDisposalProceeds: investingFinancing.assetDisposalProceeds,
      comparativeAssetDisposalProceeds: comparativeInvestingFinancing?.assetDisposalProceeds ?? null,
      netCashFromInvesting,
      comparativeNetCashFromInvesting,
      loanDrawdowns: investingFinancing.loanDrawdowns,
      comparativeLoanDrawdowns: comparativeInvestingFinancing?.loanDrawdowns ?? null,
      loanRepayments: investingFinancing.loanRepayments,
      comparativeLoanRepayments: comparativeInvestingFinancing?.loanRepayments ?? null,
      shareCapitalContributions: investingFinancing.shareCapitalContributions,
      comparativeShareCapitalContributions: comparativeInvestingFinancing?.shareCapitalContributions ?? null,
      drawingsAndDividendsPaid: investingFinancing.drawingsAndDividendsPaid,
      comparativeDrawingsAndDividendsPaid: comparativeInvestingFinancing?.drawingsAndDividendsPaid ?? null,
      netCashFromFinancing,
      comparativeNetCashFromFinancing,
      netMovementInCash,
      comparativeNetMovementInCash,
      openingCashBalance,
      comparativeOpeningCashBalance,
      closingCashBalance,
      comparativeClosingCashBalance,
      reconciles,
    };
  }

  private dayBefore(dateStr: string): string {
    const d = new Date(dateStr);
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  private async getCashAndEquivalentsBalance(businessId: string, asOfDate: string): Promise<number> {
    const balances = await this.computeBalances(businessId, { asOfDate, includeOpeningBalances: true });
    return balances
      .filter((b) => this.isCashEquivalent(b.account))
      .reduce((s, b) => s + b.balance, 0);
  }

  /**
   * Computes the change in non-cash working capital between period start
   * and period end: the balance-sheet-driven adjustment to Net Profit that
   * the indirect method requires.
   *
   * − Increase in non-cash current assets (AR, inventory, prepayments, etc.
   *   — everything with account_subtype 'current_asset' that isn't a cash
   *   equivalent) reduces operating cash, since it means revenue/spend was
   *   recognized but the cash hasn't moved yet.
   * + Increase in operating current liabilities (AP, tax payables, payroll
   *   payables, etc. — current_liability accounts EXCLUDING loan-type
   *   accounts, which are financing, not operating) increases operating
   *   cash, since obligations were incurred but not yet paid.
   */
  private async computeWorkingCapitalChange(
    businessId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<number> {
    const opening = await this.computeBalances(businessId, {
      asOfDate: this.dayBefore(periodStart),
      includeOpeningBalances: true,
    });
    const closing = await this.computeBalances(businessId, {
      asOfDate: periodEnd,
      includeOpeningBalances: true,
    });

    const sumNonCashCurrentAssets = (balances: AccountBalance[]) => balances
      .filter((b) => b.account.account_subtype === 'current_asset' && !this.isCashEquivalent(b.account))
      .reduce((s, b) => s + b.balance, 0);

    const sumOperatingCurrentLiabilities = (balances: AccountBalance[]) => balances
      .filter((b) => b.account.account_subtype === 'current_liability' && !LOAN_ACCOUNT_CODES.has(b.account.code))
      .reduce((s, b) => s + b.balance, 0);

    const openingAssets = sumNonCashCurrentAssets(opening);
    const closingAssets = sumNonCashCurrentAssets(closing);
    const changeInNonCashAssets = closingAssets - openingAssets;

    const openingLiabilities = sumOperatingCurrentLiabilities(opening);
    const closingLiabilities = sumOperatingCurrentLiabilities(closing);
    const changeInOperatingLiabilities = closingLiabilities - openingLiabilities;

    return changeInOperatingLiabilities - changeInNonCashAssets;
  }

  /**
   * Scans journal entries touching cash-equivalent accounts to classify
   * Investing and Financing cash movements only. Operating activity is
   * handled separately via computeWorkingCapitalChange — it does NOT scan
   * bank lines, since that would double count against Net Profit.
   */
  private async computeInvestingFinancingMovements(
    businessId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<{
    assetPurchases: number;
    assetDisposalProceeds: number;
    loanDrawdowns: number;
    loanRepayments: number;
    shareCapitalContributions: number;
    drawingsAndDividendsPaid: number;
  }> {
    const accountsRes = await this.client
      .from('accounts').select('*')
      .eq('business_id', businessId)
      .is('deleted_at', null);
    if (accountsRes.error) throw toRepositoryError('accounts', accountsRes.error);
    const accountMap = new Map((accountsRes.data ?? []).map((a: any) => [a.id, a]));

    const linesRes = await this.client
      .from('journal_lines')
      .select('journal_entry_id, account_id, is_debit, amount_base, journal_entries!inner(entry_date, status, business_id, source_type, reversal_of)')
      .eq('business_id', businessId)
      .eq('journal_entries.business_id', businessId)
      .gte('journal_entries.entry_date', periodStart)
      .lte('journal_entries.entry_date', periodEnd)
      .in('journal_entries.status', ['posted', 'reversed']);
    if (linesRes.error) throw toRepositoryError('journal_lines', linesRes.error);

    type LineRow = {
      journal_entry_id: string; account_id: string; is_debit: boolean; amount_base: number;
      journal_entries: { entry_date: string; status: string; source_type: string | null; reversal_of: string | null };
    };
    const lines = (linesRes.data ?? []) as unknown as LineRow[];

    const byEntry = new Map<string, LineRow[]>();
    for (const line of lines) {
      const arr = byEntry.get(line.journal_entry_id) ?? [];
      arr.push(line);
      byEntry.set(line.journal_entry_id, arr);
    }

    const reversalOfIds = lines
      .map((l) => l.journal_entries.reversal_of)
      .filter((id): id is string => Boolean(id));
    let originalSourceTypes = new Map<string, string | null>();
    if (reversalOfIds.length > 0) {
      const originalsRes = await this.client
        .from('journal_entries')
        .select('id, source_type')
        .in('id', reversalOfIds);
      if (originalsRes.error) throw toRepositoryError('journal_entries', originalsRes.error);
      originalSourceTypes = new Map((originalsRes.data ?? []).map((e: any) => [e.id, e.source_type]));
    }

    let assetPurchases = 0;
    let assetDisposalProceeds = 0;
    let loanDrawdowns = 0;
    let loanRepayments = 0;
    let shareCapitalContributions = 0;
    let drawingsAndDividendsPaid = 0;

    for (const [, entryLines] of byEntry) {
      const cashLines = entryLines.filter((l) => {
        const acc = accountMap.get(l.account_id);
        return acc && this.isCashEquivalent(acc);
      });
      if (cashLines.length === 0) continue;

      const nonCashLines = entryLines.filter((l) => {
        const acc = accountMap.get(l.account_id);
        return acc && !this.isCashEquivalent(acc);
      });

      // Both sides are cash-equivalent accounts (e.g. Mobile Money -> Bank):
      // an internal transfer with zero net effect on total cash — exclude.
      if (nonCashLines.length === 0) continue;

      const cashMovement = cashLines.reduce(
        (s, l) => s + (l.is_debit ? Number(l.amount_base) : -Number(l.amount_base)),
        0,
      );
      if (Math.abs(cashMovement) < TOLERANCE) continue;

      const entryMeta = entryLines[0].journal_entries;
      let effectiveSourceType = entryMeta.source_type;
      if (effectiveSourceType === 'reversal' && entryMeta.reversal_of) {
        effectiveSourceType = originalSourceTypes.get(entryMeta.reversal_of) ?? null;
      }

      if (effectiveSourceType === 'fixed_asset_revaluation') {
        continue; // no cash impact
      }
      if (effectiveSourceType === 'fixed_asset_disposal') {
        assetDisposalProceeds += cashMovement;
        continue;
      }

      // invoice / expense / payroll / stock_transfer / null / anything else
      // touching ordinary operating accounts is intentionally NOT counted
      // here — it's already reflected in Net Profit + working capital
      // changes. Only capital-transaction signals below are captured.
      const counterpart = nonCashLines[0] ? accountMap.get(nonCashLines[0].account_id) : null;

      if (counterpart?.account_subtype === 'fixed_asset') {
        assetPurchases += cashMovement;
        continue;
      }
      if (counterpart && LOAN_ACCOUNT_CODES.has(counterpart.code)) {
        if (cashMovement > 0) loanDrawdowns += cashMovement;
        else loanRepayments += cashMovement;
        continue;
      }
      if (counterpart?.code === DRAWINGS_DIVIDENDS_CODE) {
        drawingsAndDividendsPaid += cashMovement;
        continue;
      }
      if (counterpart?.account_subtype === 'share_capital') {
        shareCapitalContributions += cashMovement;
        continue;
      }
      // Otherwise: ordinary operating transaction, already covered by
      // Net Profit + working capital changes — no action needed here.
    }

    return {
      assetPurchases, assetDisposalProceeds,
      loanDrawdowns, loanRepayments, shareCapitalContributions, drawingsAndDividendsPaid,
    };
  }

  async getChangesInEquity(
    businessId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<StatementOfChangesInEquity> {
    const openingBalances = await this.computeBalances(businessId, {
      asOfDate: this.dayBefore(periodStart),
      includeOpeningBalances: true,
    });
    const closingBalances = await this.computeBalances(businessId, {
      asOfDate: periodEnd,
      includeOpeningBalances: true,
    });
    const pl = await this.getProfitOrLoss(businessId, periodStart, periodEnd);

    const sumBySubtypeAndCode = (
      balances: AccountBalance[],
      subtype: Exclude<AccountSubtype, null>,
      excludeCode?: string,
    ) => balances
      .filter((b) => b.account.account_subtype === subtype && b.account.code !== excludeCode)
      .reduce((s, b) => s + b.balance, 0);

    const drawingsMovement = closingBalances
      .filter((b) => b.account.code === DRAWINGS_DIVIDENDS_CODE)
      .reduce((s, b) => s + b.balance, 0)
      - openingBalances
        .filter((b) => b.account.code === DRAWINGS_DIVIDENDS_CODE)
        .reduce((s, b) => s + b.balance, 0);

    const shareCapitalOpening = sumBySubtypeAndCode(openingBalances, 'share_capital');
    const shareCapitalClosing = sumBySubtypeAndCode(closingBalances, 'share_capital');

    const retainedEarningsOpening = sumBySubtypeAndCode(openingBalances, 'retained_earnings', DRAWINGS_DIVIDENDS_CODE);
    const retainedEarningsClosing = sumBySubtypeAndCode(closingBalances, 'retained_earnings', DRAWINGS_DIVIDENDS_CODE);

    const reservesOpening = sumBySubtypeAndCode(openingBalances, 'reserves');
    const reservesClosing = sumBySubtypeAndCode(closingBalances, 'reserves');

    const shareCapital: EquityRollForwardLine = {
      label: 'Share Capital',
      openingBalance: shareCapitalOpening,
      netProfitAllocation: 0,
      contributions: shareCapitalClosing - shareCapitalOpening,
      drawingsOrDividends: 0,
      otherMovements: 0,
      closingBalance: shareCapitalClosing,
    };

    const retainedEarnings: EquityRollForwardLine = {
      label: 'Retained Earnings',
      openingBalance: retainedEarningsOpening,
      netProfitAllocation: pl.netProfit,
      contributions: 0,
      drawingsOrDividends: drawingsMovement,
      otherMovements: retainedEarningsClosing - retainedEarningsOpening - pl.netProfit - drawingsMovement,
      closingBalance: retainedEarningsClosing + pl.netProfit,
    };

    const reserves: EquityRollForwardLine = {
      label: 'Reserves',
      openingBalance: reservesOpening,
      netProfitAllocation: 0,
      contributions: 0,
      drawingsOrDividends: 0,
      otherMovements: reservesClosing - reservesOpening,
      closingBalance: reservesClosing,
    };

    const totalOpeningEquity = shareCapital.openingBalance + retainedEarnings.openingBalance + reserves.openingBalance;
    const totalClosingEquity = shareCapital.closingBalance + retainedEarnings.closingBalance + reserves.closingBalance;

    const sofpAtPeriodEnd = await this.getSOFP(businessId, periodEnd);
    const reconciles = Math.abs(totalClosingEquity - sofpAtPeriodEnd.totalEquity - pl.netProfit) < TOLERANCE
      || Math.abs(totalClosingEquity - sofpAtPeriodEnd.totalEquity) < TOLERANCE;

    return {
      periodStart, periodEnd,
      shareCapital, retainedEarnings, reserves,
      totalOpeningEquity, totalClosingEquity, reconciles,
    };
  }
}