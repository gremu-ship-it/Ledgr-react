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

const TOLERANCE = 0.01; // MWK rounding tolerance for balance checks

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
}