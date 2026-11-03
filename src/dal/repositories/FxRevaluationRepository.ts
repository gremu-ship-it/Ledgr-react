import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json, Row } from '../types/database';
import { ExchangeRateService, type RateResult } from '@/services/exchangeRateService';
import { toRepositoryError } from '../errors/RepositoryError';

export type FxBalanceCategory = 'receivables' | 'payables' | 'bank' | 'loan';

export interface FxOpenForeignBalance {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: Row<'accounts'>['account_type'];
  category: FxBalanceCategory;
  currency: string;
  originalAmount: number;
  currentBookValue: number;
  closingRate: number;
  closingRateDate: string;
  rateSource: RateResult['source'];
  rateIsStale: boolean;
  revaluedAmount: number;
  unrealisedGainLoss: number;
}

export interface FxRevaluationResult {
  revaluationId: string;
  journalEntryId: string | null;
  lineCount: number;
  totalUnrealisedGain: number;
  totalUnrealisedLoss: number;
}

export interface FxRateWithNames extends Row<'exchange_rates'> {
  fromCurrencyName: string;
  toCurrencyName: string;
}

interface AccountRow {
  id: string;
  code: string;
  name: string;
  currency: string;
  account_type: Row<'accounts'>['account_type'];
  normal_balance: string;
  is_bank_account: boolean;
  is_active: boolean;
  deleted_at: string | null;
}

interface JournalLineSnapshot {
  account_id: string;
  amount: number;
  amount_base: number;
  currency: string;
  exchange_rate: number;
  functional_amount: number | null;
  functional_currency: string | null;
  original_amount: number | null;
  original_currency: string | null;
  is_debit: boolean;
}

interface BalanceAccumulator {
  originalAmount: number;
  currentBookValue: number;
}

interface RevaluationLineInput {
  line_number: number;
  account_id: string;
  description: string;
  is_debit: boolean;
  amount: number;
  amount_base: number;
  currency: string;
  exchange_rate: number;
  functional_amount: number;
  functional_currency: string;
  original_currency: string;
  original_amount: number;
  rate_date: string;
  rate_is_stale: boolean;
  tax_code: 'none';
  tax_amount: number;
  reconciled: false;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function assertDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error('A valid revaluation date is required.');
  }
}

function assertRate(value: number): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error('Exchange rate must be greater than zero.');
}

function groupKey(accountId: string, currency: string): string {
  return `${accountId}:${currency}`;
}

/**
 * Tenant-scoped exchange rates and period-end monetary balance revaluation.
 * All reads/writes use the caller-injected Supabase client so tests and
 * non-default business sessions can supply their own client.
 */
export class FxRevaluationRepository {
  private readonly client: SupabaseClient<Database>;
  private readonly exchangeRates: ExchangeRateService;

  constructor(client: SupabaseClient<Database>) {
    this.client = client;
    this.exchangeRates = new ExchangeRateService(client);
  }

  async getCurrencies(): Promise<Array<Pick<Row<'currencies'>, 'code' | 'name' | 'symbol' | 'is_primary'>>> {
    const { data, error } = await this.client
      .from('currencies')
      .select('code, name, symbol, is_primary')
      .eq('is_active', true)
      .order('is_primary', { ascending: false })
      .order('code');
    if (error) throw toRepositoryError('currencies', error);
    return data ?? [];
  }

  /** Returns the most recent saved rate for each pair. */
  async getCurrentRates(businessId: string): Promise<FxRateWithNames[]> {
    const allRates: Row<'exchange_rates'>[] = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await this.client
        .from('exchange_rates')
        .select('*')
        .eq('business_id', businessId)
        .order('rate_date', { ascending: false })
        .order('created_at', { ascending: false })
        .order('from_currency', { ascending: true })
        .order('to_currency', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw toRepositoryError('exchange_rates', error);
      allRates.push(...(data ?? []));
      if ((data ?? []).length < pageSize) break;
    }

    const { data: currencies, error: currencyError } = await this.client
      .from('currencies')
      .select('code, name');
    if (currencyError) throw toRepositoryError('currencies', currencyError);
    const names = new Map((currencies ?? []).map((currency) => [currency.code, currency.name]));
    const seenPairs = new Set<string>();
    return allRates.flatMap((rate) => {
      const key = `${rate.from_currency}:${rate.to_currency}`;
      if (seenPairs.has(key)) return [];
      seenPairs.add(key);
      return [{
        ...rate,
        fromCurrencyName: names.get(rate.from_currency) ?? rate.from_currency,
        toCurrencyName: names.get(rate.to_currency) ?? rate.to_currency,
      }];
    });
  }

  /** Insert a new rate, or update the existing manual rate for this exact date. */
  async setRate(
    businessId: string,
    fromCurrency: string,
    toCurrency: string,
    rate: number,
    effectiveDate: string,
    userId?: string | null,
  ): Promise<Row<'exchange_rates'>> {
    assertRate(rate);
    assertDate(effectiveDate);
    const from = fromCurrency.trim().toUpperCase();
    const to = toCurrency.trim().toUpperCase();
    if (!from || !to || from === to) throw new Error('Choose two different currencies.');

    const { data: existing, error: lookupError } = await this.client
      .from('exchange_rates')
      .select('*')
      .eq('business_id', businessId)
      .eq('from_currency', from)
      .eq('to_currency', to)
      .eq('rate_date', effectiveDate)
      .maybeSingle();
    if (lookupError) throw toRepositoryError('exchange_rates', lookupError);

    if (existing) {
      if (existing.source !== 'manual') {
        throw new Error('Automatically sourced rates are historical records; add a manual rate for a new effective date.');
      }
      const { data, error } = await this.client
        .from('exchange_rates')
        .update(userId ? { rate, created_by: userId } : { rate })
        .eq('business_id', businessId)
        .eq('id', existing.id)
        .select('*')
        .single();
      if (error) throw toRepositoryError('exchange_rates', error);
      return data;
    }

    const { data, error } = await this.client
      .from('exchange_rates')
      .insert({
        business_id: businessId,
        from_currency: from,
        to_currency: to,
        rate,
        rate_date: effectiveDate,
        source: 'manual',
        created_by: userId ?? null,
      })
      .select('*')
      .single();
    if (error) throw toRepositoryError('exchange_rates', error);
    return data;
  }

  /**
   * Read account-level monetary balances from posted ledger lines as of the
   * requested date. Invoice/payable, bank, and loan accounts are grouped by
   * their original currency so earlier revaluation adjustments are included
   * in current book value without changing the underlying foreign quantity.
   */
  async getOpenForeignBalances(
    businessId: string,
    revaluationDate: string,
    functionalCurrency?: string,
  ): Promise<FxOpenForeignBalance[]> {
    assertDate(revaluationDate);
    const { data: business, error: businessError } = await this.client
      .from('businesses')
      .select('base_currency')
      .eq('id', businessId)
      .single();
    if (businessError) throw toRepositoryError('businesses', businessError);
    const baseCurrency = business.base_currency;
    const targetCurrency = functionalCurrency ?? baseCurrency;
    if (targetCurrency !== baseCurrency) {
      throw new Error('Revaluation currency must match the business functional currency.');
    }

    const [accountsResult, receivableResult, payableResult, loanResult] = await Promise.all([
      this.client.from('accounts')
        .select('id, code, name, currency, account_type, normal_balance, is_bank_account, is_active, deleted_at')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .is('deleted_at', null),
      this.client.from('invoices')
        .select('ar_account_id')
        .eq('business_id', businessId)
        .lte('issue_date', revaluationDate)
        .is('deleted_at', null)
        .in('status', ['sent', 'partially_paid', 'overdue']),
      this.client.from('expenses')
        .select('ap_account_id')
        .eq('business_id', businessId)
        .lte('expense_date', revaluationDate)
        .is('deleted_at', null)
        .in('status', ['draft', 'approved', 'partially_paid']),
      this.client.from('loans')
        .select('loan_account_id')
        .eq('business_id', businessId)
        .lte('start_date', revaluationDate)
        .neq('status', 'paid_off'),
    ]);
    if (accountsResult.error) throw toRepositoryError('accounts', accountsResult.error);
    if (receivableResult.error) throw toRepositoryError('invoices', receivableResult.error);
    if (payableResult.error) throw toRepositoryError('expenses', payableResult.error);
    if (loanResult.error) throw toRepositoryError('loans', loanResult.error);

    const accounts = (accountsResult.data ?? []) as AccountRow[];
    const accountById = new Map(accounts.map((account) => [account.id, account]));
    const receivableIds = new Set((receivableResult.data ?? []).map((row) => row.ar_account_id).filter((id): id is string => Boolean(id)));
    const payableIds = new Set((payableResult.data ?? []).map((row) => row.ap_account_id).filter((id): id is string => Boolean(id)));
    const loanIds = new Set((loanResult.data ?? []).map((row) => row.loan_account_id));
    const defaultReceivable = accounts.find((account) => account.code === '1131')?.id;
    const defaultPayable = accounts.find((account) => account.code === '2111')?.id;
    if (defaultReceivable) receivableIds.add(defaultReceivable);
    if (defaultPayable) payableIds.add(defaultPayable);

    const categoryByAccount = new Map<string, FxBalanceCategory>();
    receivableIds.forEach((id) => categoryByAccount.set(id, 'receivables'));
    payableIds.forEach((id) => categoryByAccount.set(id, 'payables'));
    loanIds.forEach((id) => { if (!categoryByAccount.has(id)) categoryByAccount.set(id, 'loan'); });
    accounts.filter((account) => account.is_bank_account).forEach((account) => {
      if (!categoryByAccount.has(account.id)) categoryByAccount.set(account.id, 'bank');
    });

    const accountIds = [...categoryByAccount.keys()].filter((id) => accountById.has(id));
    if (accountIds.length === 0) return [];

    const snapshots: JournalLineSnapshot[] = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await this.client
        .from('journal_lines')
        .select('account_id, amount, amount_base, currency, exchange_rate, functional_amount, functional_currency, original_amount, original_currency, is_debit, journal_entries!inner(entry_date, status)')
        .eq('business_id', businessId)
        .in('account_id', accountIds)
        .lte('journal_entries.entry_date', revaluationDate)
        .in('journal_entries.status', ['posted', 'reversed'])
        .order('journal_entry_id', { ascending: true })
        .order('line_number', { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) throw toRepositoryError('journal_lines', error);
      const page = (data ?? []) as unknown as JournalLineSnapshot[];
      snapshots.push(...page);
      if (page.length < pageSize) break;
    }

    const totals = new Map<string, BalanceAccumulator>();
    for (const line of snapshots) {
      const account = accountById.get(line.account_id);
      const category = categoryByAccount.get(line.account_id);
      const currency = line.original_currency ?? line.currency;
      if (!account || !category || currency === targetCurrency) continue;
      const direction = account.normal_balance === 'credit' ? -1 : 1;
      const side = line.is_debit ? 1 : -1;
      const key = groupKey(line.account_id, currency);
      const total = totals.get(key) ?? { originalAmount: 0, currentBookValue: 0 };
      total.originalAmount += direction * side * Number(line.original_amount ?? line.amount);
      total.currentBookValue += direction * side * Number(line.functional_amount ?? line.amount_base);
      totals.set(key, total);
    }

    const balanceRequests = [...totals.entries()].flatMap(([key, values]) => {
      const separator = key.indexOf(':');
      const accountId = key.slice(0, separator);
      const currency = key.slice(separator + 1);
      const account = accountById.get(accountId);
      if (!account || Math.abs(values.originalAmount) <= 0.005) return [];
      return [{ account, currency, values, category: categoryByAccount.get(accountId)! }];
    });

    return Promise.all(balanceRequests.map(async ({ account, currency, values, category }) => {
      const closing = await this.exchangeRates.getRate(businessId, currency, targetCurrency, revaluationDate);
      const currentBookValue = roundMoney(values.currentBookValue);
      const revaluedAmount = roundMoney(values.originalAmount * closing.rate);
      const naturalDelta = roundMoney(revaluedAmount - currentBookValue);
      const unrealisedGainLoss = account.account_type === 'asset' ? naturalDelta : -naturalDelta;
      return {
        accountId: account.id,
        accountCode: account.code,
        accountName: account.name,
        accountType: account.account_type,
        category,
        currency,
        originalAmount: roundMoney(values.originalAmount),
        currentBookValue,
        closingRate: closing.rate,
        closingRateDate: closing.rateDate,
        rateSource: closing.source,
        rateIsStale: closing.isStale,
        revaluedAmount,
        unrealisedGainLoss,
      };
    }));
  }

  /**
   * Create the FX journal and audit record in one transaction via the
   * run_fx_revaluation RPC. The unique business/date constraint is checked
   * inside the same transaction, so retries cannot leave duplicate ledger
   * entries.
   */
  async runRevaluation(
    businessId: string,
    revaluationDate: string,
    rates: Record<string, number> = {},
    functionalCurrency?: string,
  ): Promise<FxRevaluationResult> {
    const balances = await this.getOpenForeignBalances(businessId, revaluationDate, functionalCurrency);
    const targetCurrency = functionalCurrency ?? (await this.getBusinessCurrency(businessId));
    let gains: Row<'accounts'> | null = null;
    let losses: Row<'accounts'> | null = null;
    const lines: RevaluationLineInput[] = [];
    let totalUnrealisedGain = 0;
    let totalUnrealisedLoss = 0;
    let lineNumber = 1;

    for (const balance of balances) {
      const rateKey = `${balance.currency}:${targetCurrency}`;
      const closingRate = rates[rateKey] ?? balance.closingRate;
      assertRate(closingRate);
      const delta = roundMoney(balance.originalAmount * closingRate - balance.currentBookValue);
      if (Math.abs(delta) < 0.005) continue;

      const isAsset = balance.accountType === 'asset';
      const isGain = isAsset ? delta > 0 : delta < 0;
      const adjustmentIsDebit = isAsset ? delta > 0 : delta < 0;
      const amount = Math.abs(delta);
      const offsetAccount = isGain
        ? (gains ??= await this.getAccountByCode(businessId, '4230'))
        : (losses ??= await this.getAccountByCode(businessId, '7300'));
      const adjustmentLine: RevaluationLineInput = {
        line_number: lineNumber++,
        account_id: balance.accountId,
        description: `IAS 21 revaluation — ${balance.accountCode} ${balance.currency}`,
        is_debit: adjustmentIsDebit,
        amount,
        amount_base: amount,
        currency: targetCurrency,
        exchange_rate: 1,
        functional_amount: amount,
        functional_currency: targetCurrency,
        original_currency: balance.currency,
        original_amount: 0,
        rate_date: revaluationDate,
        rate_is_stale: false,
        tax_code: 'none',
        tax_amount: 0,
        reconciled: false,
      };
      const fxLine: RevaluationLineInput = {
        line_number: lineNumber++,
        account_id: offsetAccount.id,
        description: `${isGain ? 'Unrealised FX gain' : 'Unrealised FX loss'} — ${balance.accountCode} ${balance.currency}`,
        is_debit: !adjustmentIsDebit,
        amount,
        amount_base: amount,
        currency: targetCurrency,
        exchange_rate: 1,
        functional_amount: amount,
        functional_currency: targetCurrency,
        original_currency: targetCurrency,
        original_amount: amount,
        rate_date: revaluationDate,
        rate_is_stale: false,
        tax_code: 'none',
        tax_amount: 0,
        reconciled: false,
      };
      if (isGain) totalUnrealisedGain += amount;
      else totalUnrealisedLoss += amount;
      lines.push(adjustmentLine, fxLine);
    }

    totalUnrealisedGain = roundMoney(totalUnrealisedGain);
    totalUnrealisedLoss = roundMoney(totalUnrealisedLoss);
    const sources = [...new Set(balances.map((balance) => balance.rateSource))];
    const { data, error } = await this.client.rpc('run_fx_revaluation', {
      p_business_id: businessId,
      p_revaluation_date: revaluationDate,
      p_functional_currency: targetCurrency,
      p_lines: lines as unknown as Json,
      p_total_unrealised_gain: totalUnrealisedGain,
      p_total_unrealised_loss: totalUnrealisedLoss,
      p_closing_rate_source: sources.join(',') || 'manual/cache',
    });
    if (error) throw toRepositoryError('fx_revaluations', error);

    const result = data as unknown as FxRevaluationResult;
    return result;
  }

  async getRevaluationHistory(businessId: string): Promise<Row<'fx_revaluations'>[]> {
    const { data, error } = await this.client
      .from('fx_revaluations')
      .select('*')
      .eq('business_id', businessId)
      .order('revaluation_date', { ascending: false });
    if (error) throw toRepositoryError('fx_revaluations', error);
    return data ?? [];
  }

  private async getBusinessCurrency(businessId: string): Promise<string> {
    const { data, error } = await this.client
      .from('businesses')
      .select('base_currency')
      .eq('id', businessId)
      .single();
    if (error) throw toRepositoryError('businesses', error);
    return data.base_currency;
  }

  private async getAccountByCode(businessId: string, code: string): Promise<Row<'accounts'>> {
    const { data, error } = await this.client
      .from('accounts')
      .select('*')
      .eq('business_id', businessId)
      .eq('code', code)
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw toRepositoryError('accounts', error);
    if (!data) throw new Error(`Account ${code} is required to post an FX revaluation.`);
    return data;
  }
}
