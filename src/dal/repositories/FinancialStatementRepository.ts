import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row, AccountSubtype } from '../types/database';
import { BaseRepository } from './BaseRepository';
import { toRepositoryError } from '../errors/RepositoryError';
import { asNormalBalance, toStatementSide, type NormalBalance } from '@/lib/statementPresentation';
import { postedCapitalisedAssetIds } from '@/lib/fixedAssetCapitalisation';
import {
  buildBankReconciliationCheck,
  buildFixedAssetCheck,
  buildFxIntegrityCheck,
  INTEGRITY_TOLERANCE,
  type BankAccountVariance,
  type FxLineSample,
  type IntegrityCheck,
} from '@/lib/statementIntegrity';

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
   * Computes the balance of every account for a business as of a point in time
   * (for SOFP) or across a date range (for P&L). Group accounts are retained:
   * although new journal postings must use a leaf account, older data and the
   * account setup screen can contain an opening balance on a group account.
   * Excluding those accounts made a recorded Current Asset disappear from the
   * Statement of Financial Position.
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

  /**
   * Builds one statement section on its presentation side.
   *
   * `sectionNormalBalance` is the normal balance of the section itself —
   * 'debit' for asset and expense sections, 'credit' for liability, equity
   * and income sections. Accounts whose own normal_balance matches it keep
   * their sign; CONTRA accounts (normal_balance opposite to the section) are
   * negated so they NET against the section total:
   *   - Accumulated Depreciation / Amortisation (credit-normal) net against
   *     Non-Current Assets — previously they were ADDED, overstating Total
   *     Assets by 2× accumulated depreciation and tripping isBalanced;
   *   - Provision for Bad Debts (credit-normal) nets against Current Assets;
   *   - Drawings / Dividends (debit-normal) reduces Equity;
   *   - Sales / Purchase Returns & Discounts net against Revenue / Cost of
   *     Sales in the P&L.
   */
  private buildSection(
    balances: AccountBalance[],
    comparativeBalances: AccountBalance[] | null,
    subtypes: Exclude<AccountSubtype, null>[],
    label: string,
    sectionNormalBalance: NormalBalance,
    explicitlyIncludedAccountIds: ReadonlySet<string> = new Set(),
  ): StatementSection {
    const comparativeMap = comparativeBalances
      ? new Map(comparativeBalances.map((b) => [b.account.id, b.balance]))
      : null;

    // FIX [comparative column dropped closed accounts]:
    // The filter previously tested the CURRENT balance only, so an account
    // that held a balance last year and nil this year vanished from the
    // report entirely — taking its prior-year figure with it. The
    // comparative column then silently disagreed with the statement
    // published last year (e.g. stock sold down to zero would erase last
    // year's inventory line and understate prior-year Total Assets).
    // An account is now shown when EITHER period has a balance.
    const relevant = balances
      .filter((b) => {
        // Primary filter: subtype must be in the requested list.
        // Fallback: for Non-Current Assets section (which requests
        // non_current_asset + fixed_asset), also include asset accounts
        // whose code starts with 15 (the PPE / non-current range) even if
        // subtype is NULL/misclassified. This handles legacy rows and
        // custom accounts that were created without a subtype, which
        // previously disappeared from every SOFP section and made fixed
        // assets appear missing.
        const subtype = b.account.account_subtype;
        // An asset register can deliberately point at a custom GL account.
        // That account is still PPE even when an old/custom chart assigned it
        // `other_asset` (or a non-15xx code), so honour the explicit link.
        let subtypeMatches = explicitlyIncludedAccountIds.has(b.account.id);
        if (!subtypeMatches) {
          if (subtype !== null) {
            subtypeMatches = subtypes.includes(subtype);
          } else {
            // NULL subtype fallback — only for non-current asset grouping
            // (code 1500-1599). Without this, a NULL-subtype fixed asset
            // account is dropped from all sections, breaking Total Assets.
            if ((subtypes.includes('fixed_asset' as never) || subtypes.includes('non_current_asset' as never))
              && b.account.account_type === 'asset'
              && b.account.code.startsWith('15')) {
              subtypeMatches = true;
            }
          }
        }
        if (!subtypeMatches) return false;

        const current = Math.abs(b.balance);
        const comparative = comparativeMap ? Math.abs(comparativeMap.get(b.account.id) ?? 0) : 0;
        return current > TOLERANCE || comparative > TOLERANCE;
      })
      .sort((a, b) => a.account.code.localeCompare(b.account.code));

    const lines: StatementLineItem[] = relevant.map((b) => ({
      code: b.account.code,
      name: b.account.name,
      amount: toStatementSide(b.balance, asNormalBalance(b.account.normal_balance), sectionNormalBalance),
      comparativeAmount: comparativeMap
        ? toStatementSide(comparativeMap.get(b.account.id) ?? 0, asNormalBalance(b.account.normal_balance), sectionNormalBalance)
        : null,
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

    // Capitalisation/depreciation journals use the asset's GL overrides and
    // fall back to its category defaults. Those accounts can be custom rows
    // whose subtype/code is outside the standard fixed-asset classifications.
    // The old report only inspected fixed_assets.asset_account_id, so an asset
    // inheriting a custom category account could have a valid POSTED journal
    // and still disappear from Non-Current Assets. Resolve both levels and
    // include cost plus accumulated-depreciation accounts explicitly.
    const fixedAssetRelatedAccountIds = new Set<string>();
    try {
      const { data, error } = await this.client
        .from('fixed_assets')
        .select('asset_account_id, accumulated_dep_account_id, category_id')
        .eq('business_id', businessId)
        .is('deleted_at', null);
      if (!error) {
        const assetLinks = (data ?? []) as Array<{
          asset_account_id: string | null;
          accumulated_dep_account_id: string | null;
          category_id: string | null;
        }>;
        for (const asset of assetLinks) {
          if (asset.asset_account_id) fixedAssetRelatedAccountIds.add(asset.asset_account_id);
          if (asset.accumulated_dep_account_id) fixedAssetRelatedAccountIds.add(asset.accumulated_dep_account_id);
        }

        const categoryIds = [...new Set(
          assetLinks.map((asset) => asset.category_id).filter((id): id is string => Boolean(id)),
        )];
        if (categoryIds.length > 0) {
          const categories = await this.client
            .from('asset_categories')
            .select('asset_account_id, accumulated_dep_account_id')
            .eq('business_id', businessId)
            .in('id', categoryIds);
          if (!categories.error) {
            for (const category of categories.data ?? []) {
              if (category.asset_account_id) fixedAssetRelatedAccountIds.add(category.asset_account_id);
              if (category.accumulated_dep_account_id) fixedAssetRelatedAccountIds.add(category.accumulated_dep_account_id);
            }
          }
        }
      }
    } catch {
      // The standard subtype-based path remains available if this optional
      // register/category lookup fails (for example in an older deployment).
    }

    const currentAssets = this.buildSection(balances, comparativeBalances, ['current_asset'], 'Current Assets', 'debit');
    const nonCurrentAssets = this.buildSection(
      balances, comparativeBalances,
      ['non_current_asset', 'fixed_asset'],
      'Non-Current Assets',
      'debit',
      fixedAssetRelatedAccountIds,
    );
    const currentLiabilities = this.buildSection(balances, comparativeBalances, ['current_liability'], 'Current Liabilities', 'credit');
    const nonCurrentLiabilities = this.buildSection(balances, comparativeBalances, ['non_current_liability'], 'Non-Current Liabilities', 'credit');
    const equity = this.buildSection(
      balances, comparativeBalances,
      ['share_capital', 'retained_earnings', 'reserves'],
      'Equity',
      'credit',
    );

    // ── Fixed-assets register fallback ─────────────────────────────────────
    // The SOFP is a GL report, but register-era assets (created in the Assets
    // register or via CSV import without a capitalisation journal) have NO GL
    // leg at all — GL fixed_asset balances stay zero and Non-Current Assets
    // appears empty even though the register lists assets. That is the bug
    // reported as "fixed assets are not reflecting under non current assets".
    //
    // Integrity audit (auditStatementIntegrity) already flags the variance,
    // but the SOFP itself should still reflect the register's net book value
    // for assets that lack a capitalisation entry, so the statement is not
    // silently understated. GL remains the source of truth for capitalised
    // assets; register values are only added for UNCAPITALISED assets.
    //
    // This is intentionally best-effort and wrapped in try/catch so unit tests
    // that stub the Supabase client (and any transient query failure) do not
    // break the core GL path.
    try {
      // Assets that count as at asOfDate: acquired on/before asOfDate,
      // not disposed on/before asOfDate, not soft-deleted.
      const assetsRes = await this.client
        .from('fixed_assets')
        .select('id, asset_number, name, acquisition_date, acquisition_cost, accumulated_depreciation, net_book_value, status, disposal_date')
        .eq('business_id', businessId)
        .is('deleted_at', null)
        .neq('status', 'disposed')
        .lte('acquisition_date', asOfDate);

      if (!assetsRes.error) {
        const registerAssets = (assetsRes.data ?? []) as Array<{
          id: string;
          asset_number: string;
          name: string;
          acquisition_date: string;
          acquisition_cost: number | string;
          accumulated_depreciation: number | string;
          net_book_value: number | string | null;
          status: string;
          disposal_date: string | null;
        }>;

        // Filter out assets already disposed as of asOfDate
        const activeAsOfDate = registerAssets.filter((a) => {
          if (!a.disposal_date) return true;
          return a.disposal_date > asOfDate;
        });

        if (activeAsOfDate.length > 0) {
          const capRes = await this.client
            .from('journal_entries')
            .select('source_id, status, entry_date')
            .eq('business_id', businessId)
            .eq('source_type', 'fixed_asset_acquisition')
            .eq('status', 'posted')
            .lte('entry_date', asOfDate);

          // Do not assume every asset is uncapitalised when this lookup fails:
          // adding the whole register on top of existing GL balances would
          // double-count assets. The outer best-effort guard retains GL-only
          // reporting in that case.
          if (capRes.error) throw toRepositoryError('journal_entries', capRes.error);
          const capitalisationRefs = capRes.data ?? [];
          const capitalisedIds = postedCapitalisedAssetIds(capitalisationRefs, asOfDate);
          const uncapitalised = activeAsOfDate.filter((a) => !capitalisedIds.has(a.id));

          // For a comparative date, evaluate journal effectiveness at that
          // date too. A later posting must not make an earlier statement omit
          // the register fallback.
          let comparativeUncapitalised: typeof activeAsOfDate = [];
          if (comparativeDate) {
            const comparativeCapitalisedIds = postedCapitalisedAssetIds(capitalisationRefs, comparativeDate);
            comparativeUncapitalised = registerAssets.filter((a) => {
              if (a.acquisition_date > comparativeDate) return false;
              if (a.disposal_date && a.disposal_date <= comparativeDate) return false;
              return !comparativeCapitalisedIds.has(a.id);
            });
          }

          const toNbv = (a: typeof activeAsOfDate[number]) => {
            const nbvRaw = a.net_book_value;
            if (nbvRaw !== null && nbvRaw !== undefined) {
              const nbvNum = Number(nbvRaw);
              if (Number.isFinite(nbvNum) && nbvNum !== 0) return nbvNum;
            }
            const cost = Number(a.acquisition_cost ?? 0);
            const acc = Number(a.accumulated_depreciation ?? 0);
            return cost - acc;
          };

          // Merge uncapitalised register lines into the GL-built section so
          // they appear under Non-Current Assets. Existing GL lines (capitalised
          // assets) are kept as-is — no double counting.
          if (uncapitalised.length > 0) {
            const existingCodes = new Set(nonCurrentAssets.lines.map((l) => l.code));
            for (const asset of uncapitalised) {
              const nbv = toNbv(asset);
              if (Math.abs(nbv) <= TOLERANCE) continue;
              // Use asset_number as code; avoid collision with GL account codes
              const code = asset.asset_number || `FA-${asset.id.slice(0, 8)}`;
              if (existingCodes.has(code)) continue;
              const comparativeAsset = comparativeDate
                ? comparativeUncapitalised.find((ca) => ca.id === asset.id)
                : null;
              const comparativeNbv = comparativeAsset ? toNbv(comparativeAsset) : null;

              nonCurrentAssets.lines.push({
                code,
                name: `${asset.name} (register — pending capitalisation)`,
                amount: nbv,
                comparativeAmount: comparativeNbv,
              });
              nonCurrentAssets.subtotal += nbv;
              if (comparativeNbv !== null && nonCurrentAssets.comparativeSubtotal !== null) {
                nonCurrentAssets.comparativeSubtotal += comparativeNbv;
              } else if (comparativeNbv !== null && nonCurrentAssets.comparativeSubtotal === null) {
                // If GL comparative was null but register has value, initialise
                nonCurrentAssets.comparativeSubtotal = (nonCurrentAssets.comparativeSubtotal ?? 0) + comparativeNbv;
              }
            }
            // Keep lines sorted by code for stable rendering
            nonCurrentAssets.lines.sort((a, b) => a.code.localeCompare(b.code));
          } else if (comparativeDate && comparativeUncapitalised.length > 0 && nonCurrentAssets.comparativeSubtotal === null) {
            // Edge: GL had no comparative, but register does — initialise comparative
            const compTotal = comparativeUncapitalised.reduce((s, a) => s + toNbv(a), 0);
            if (Math.abs(compTotal) > TOLERANCE) {
              nonCurrentAssets.comparativeSubtotal = (nonCurrentAssets.comparativeSubtotal ?? 0) + compTotal;
            }
          }
        }
      }
    } catch {
      // Best-effort fallback — if anything fails (e.g. test stubs returning
      // journal lines for the fixed_assets table), keep the GL-only section.
    }

    const totalAssets = currentAssets.subtotal + nonCurrentAssets.subtotal;
    const comparativeTotalAssets = comparativeBalances || nonCurrentAssets.comparativeSubtotal !== null
      ? (currentAssets.comparativeSubtotal ?? 0) + (nonCurrentAssets.comparativeSubtotal ?? 0)
      : null;

    const totalLiabilities = currentLiabilities.subtotal + nonCurrentLiabilities.subtotal;
    const comparativeTotalLiabilities = comparativeBalances
      ? (currentLiabilities.comparativeSubtotal ?? 0) + (nonCurrentLiabilities.comparativeSubtotal ?? 0)
      : null;

    const netAssets = totalAssets - totalLiabilities;
    const comparativeNetAssets = comparativeBalances || comparativeTotalAssets !== null
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

    // Sections are built on their presentation side (revenue/other_income on
    // the credit side, expense sections on the debit side). Contra accounts —
    // e.g. Sales Returns & Discounts (debit-normal) against Revenue, Purchase
    // Returns (credit-normal) against Cost of Sales — are negated by
    // buildSection so they NET against the section instead of inflating it.
    const revenue = this.buildSection(balances, comparativeBalances, ['revenue'], 'Revenue', 'credit');
    const otherIncome = this.buildSection(balances, comparativeBalances, ['other_income'], 'Other Income', 'credit');
    const costOfSales = this.buildSection(balances, comparativeBalances, ['cost_of_sales'], 'Cost of Sales', 'debit');
    const operatingExpenses = this.buildSection(balances, comparativeBalances, ['operating_expense'], 'Operating Expenses', 'debit');
    const depreciationAmortisation = this.buildSection(
      balances, comparativeBalances,
      ['depreciation_amortisation'],
      'Depreciation & Amortisation',
      'debit',
    );
    const financeCosts = this.buildSection(balances, comparativeBalances, ['finance_cost'], 'Finance Costs', 'debit');
    const taxExpense = this.buildSection(balances, comparativeBalances, ['tax_expense'], 'Tax Expense', 'debit');

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
   * Live cash and cash-equivalents balance as at a date: opening balances plus
   * all posted movement, across bank accounts and non-bank cash accounts
   * (petty cash, mobile money).
   *
   * Public wrapper over getCashAndEquivalentsBalance for callers outside the
   * statement builders. Prefer this over summing `accounts.opening_balance`,
   * which is a period-opening figure and ignores every transaction since.
   */
  async getCashPosition(businessId: string, asOfDate: string): Promise<number> {
    return this.getCashAndEquivalentsBalance(businessId, asOfDate);
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

    // Contra-aware sums: balances are converted to the section's presentation
    // side so contra accounts net correctly. Without this, building up the
    // Provision for Bad Debts (credit-normal current asset) read as an
    // INCREASE in current assets and wrongly reduced operating cash — the
    // provision is a non-cash charge and must net the asset side down.
    const sumNonCashCurrentAssets = (balances: AccountBalance[]) => balances
      .filter((b) => b.account.account_subtype === 'current_asset' && !this.isCashEquivalent(b.account))
      .reduce((s, b) => s + toStatementSide(b.balance, asNormalBalance(b.account.normal_balance), 'debit'), 0);

    const sumOperatingCurrentLiabilities = (balances: AccountBalance[]) => balances
      .filter((b) => b.account.account_subtype === 'current_liability' && !LOAN_ACCOUNT_CODES.has(b.account.code))
      .reduce((s, b) => s + toStatementSide(b.balance, asNormalBalance(b.account.normal_balance), 'credit'), 0);

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
    const accountMap = new Map(
      ((accountsRes.data ?? []) as Row<'accounts'>[]).map((a) => [a.id, a]),
    );

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
      originalSourceTypes = new Map(
        ((originalsRes.data ?? []) as Array<{ id: string; source_type: string | null }>)
          .map((e) => [e.id, e.source_type]),
      );
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

  // ── Statement integrity audit ────────────────────────────────────────────

  /**
   * Read-only integrity audit over the data the SOFP is built from.
   *
   * Replaces the old `auditFixedAssetsAndReconciliation() { return true; }`
   * stub, which claimed fixed-asset, bank-reconciliation and FX gap checks
   * existed but verified nothing. Runs three real checks as at `asOfDate`:
   *
   *   1. fixed-assets        — asset register Σ accumulated depreciation vs
   *      the GL contra-asset (credit-normal fixed_asset) accounts;
   *   2. bank-reconciliation — each bank account's GL balance vs the closing
   *      balance on its latest locked imported bank statement (the "bank
   *      variance" the old comment claimed was included);
   *   3. fx                  — every posted/reversed foreign-currency journal
   *      line must carry an exchange-rate snapshot; stale cached rates are
   *      reported as findings.
   *
   * Pure evaluation logic lives in @/lib/statementIntegrity so it can be
   * unit-tested without a database; this method only fetches the rows.
   */
  async auditStatementIntegrity(
    businessId: string,
    asOfDate: string,
  ): Promise<StatementIntegrityReport> {
    const balances = await this.computeBalances(businessId, {
      asOfDate,
      includeOpeningBalances: true,
    });

    // Fixed-asset register (non-disposed assets only — disposal removes the
    // accumulated depreciation from both the register tie-out and the GL).
    const assetsRes = await this.client
      .from('fixed_assets')
      .select('acquisition_cost, accumulated_depreciation, status')
      .eq('business_id', businessId)
      .is('deleted_at', null)
      .neq('status', 'disposed');
    if (assetsRes.error) throw toRepositoryError('fixed_assets', assetsRes.error);
    const registerRows = (assetsRes.data ?? []) as Array<{
      acquisition_cost: number; accumulated_depreciation: number; status: string;
    }>;

    // Latest LOCKED bank statement per bank account (only a locked statement
    // represents a completed reconciliation — saved-and-locked in
    // BankReconciliation.finalize). is_locked arrives via the
    // bank_reconciliation migration, which post-dates the generated types;
    // the column exists at runtime and the filter is passed through.
    const statementsRes = await this.client
      .from('bank_statements')
      .select('account_id, closing_balance, statement_date, is_locked')
      .eq('business_id', businessId)
      .order('statement_date', { ascending: false });
    if (statementsRes.error) throw toRepositoryError('bank_statements', statementsRes.error);
    const latestStatementByAccount = new Map<string, { statement_date: string; closing_balance: number }>();
    for (const s of (statementsRes.data ?? []) as unknown as Array<{
      account_id: string; statement_date: string; closing_balance: number; is_locked?: boolean;
    }>) {
      if (s.is_locked === false) continue; // skip statements still being saved
      if (!latestStatementByAccount.has(s.account_id)) {
        latestStatementByAccount.set(s.account_id, s);
      }
    }

    // Functional currency for the FX check.
    const businessRes = await this.client
      .from('businesses')
      .select('base_currency')
      .eq('id', businessId)
      .single();
    if (businessRes.error) throw toRepositoryError('businesses', businessRes.error);
    const functionalCurrency = ((businessRes.data as { base_currency?: string } | null)?.base_currency) || 'MWK';

    // Foreign-currency journal lines touching posted/reversed entries.
    const fxLinesRes = await this.client
      .from('journal_lines')
      .select('currency, amount_base, exchange_rate, rate_is_stale, journal_entries!inner(status, entry_number, business_id)')
      .eq('business_id', businessId)
      .eq('journal_entries.business_id', businessId)
      .in('journal_entries.status', ['posted', 'reversed']);
    if (fxLinesRes.error) throw toRepositoryError('journal_lines', fxLinesRes.error);
    const foreignLines: FxLineSample[] = [];
    let staleRateCount = 0;
    for (const l of (fxLinesRes.data ?? []) as unknown as Array<{
      currency: string | null; amount_base: number; exchange_rate: number | null;
      rate_is_stale: boolean | null; journal_entries: { entry_number: string };
    }>) {
      if (!l.currency || l.currency.toUpperCase() === functionalCurrency.toUpperCase()) continue;
      foreignLines.push({
        entryNumber: l.journal_entries?.entry_number ?? null,
        currency: l.currency,
        amountBase: Number(l.amount_base),
        exchangeRate: l.exchange_rate === null ? null : Number(l.exchange_rate),
      });
      if (l.rate_is_stale) staleRateCount += 1;
    }

    // GL vs register (contra-aware, asset side).
    const glAssetCost = balances
      .filter((b) => b.account.account_subtype === 'fixed_asset' && b.account.normal_balance === 'debit')
      .reduce((s, b) => s + toStatementSide(b.balance, asNormalBalance(b.account.normal_balance), 'debit'), 0);
    const glAccumulatedDepreciation = -balances
      .filter((b) => b.account.account_subtype === 'fixed_asset' && b.account.normal_balance === 'credit')
      .reduce((s, b) => s + toStatementSide(b.balance, asNormalBalance(b.account.normal_balance), 'debit'), 0);

    const fixedAssets = buildFixedAssetCheck({
      glAssetCost,
      glAccumulatedDepreciation,
      registerAssetCost: registerRows.reduce((s, r) => s + Number(r.acquisition_cost), 0),
      registerAccumulatedDepreciation: registerRows.reduce((s, r) => s + Number(r.accumulated_depreciation), 0),
      registerAssetCount: registerRows.length,
    });

    // Bank variance per bank account. The GL balance must be measured AS AT
    // the statement's own date — comparing the asOfDate GL with an older
    // statement's closing balance would report every subsequent transaction
    // as a phantom "variance". Balances are cached per distinct date.
    const balancesByDate = new Map<string, Map<string, number>>([
      [asOfDate, new Map(balances.map((b) => [b.account.id, toStatementSide(b.balance, asNormalBalance(b.account.normal_balance), 'debit')]))],
    ]);
    for (const statement of latestStatementByAccount.values()) {
      if (!balancesByDate.has(statement.statement_date)) {
        const historical = await this.computeBalances(businessId, {
          asOfDate: statement.statement_date,
          includeOpeningBalances: true,
        });
        balancesByDate.set(
          statement.statement_date,
          new Map(historical.map((b) => [b.account.id, toStatementSide(b.balance, asNormalBalance(b.account.normal_balance), 'debit')])),
        );
      }
    }

    const asOfBalances = balancesByDate.get(asOfDate)!;
    const bankRows: BankAccountVariance[] = balances
      .filter((b) => b.account.is_bank_account)
      .map((b) => {
        const statement = latestStatementByAccount.get(b.account.id);
        return {
          accountCode: b.account.code,
          accountName: b.account.name,
          glBalance: statement
            ? (balancesByDate.get(statement.statement_date)?.get(b.account.id) ?? 0)
            : (asOfBalances.get(b.account.id) ?? 0),
          statementDate: statement?.statement_date ?? null,
          statementClosing: statement ? Number(statement.closing_balance) : null,
        };
      });
    const bankReconciliation = buildBankReconciliationCheck(bankRows);

    const fx = buildFxIntegrityCheck({ functionalCurrency, foreignLines, staleRateCount });

    const checks = [fixedAssets, bankReconciliation, fx];
    return {
      asOfDate,
      functionalCurrency,
      ok: checks.every((c) => c.ok),
      checks,
    };
  }
}

export interface StatementIntegrityReport {
  asOfDate: string;
  functionalCurrency: string;
  ok: boolean;
  checks: IntegrityCheck[];
}

export { INTEGRITY_TOLERANCE };
