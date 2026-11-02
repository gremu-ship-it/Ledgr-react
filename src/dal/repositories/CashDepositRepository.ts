import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json, Row } from '../types/database';

export type CashDepositStatus = 'draft' | 'posted' | 'voided';
export type CashDeposit = Row<'cash_deposits'>;
export type CashDepositLine = Row<'cash_deposit_lines'>;

export interface CashDepositAccountChoice {
  id: string;
  code: string;
  name: string;
  currency: string | null;
  is_bank_account: boolean;
}

export interface CashDepositLineInput {
  source_account_id: string;
  amount: number;
  description?: string | null;
}

export interface CashDepositDraftInput {
  business_id: string;
  deposit_date: string;
  bank_account_id: string;
  reference?: string | null;
  notes?: string | null;
}

export interface CashDepositSummary extends CashDeposit {
  total_amount: number;
  bank_account_name: string;
}

export interface CashDepositDetail {
  deposit: CashDeposit;
  lines: CashDepositLine[];
  accounts: CashDepositAccountChoice[];
}

export interface CashDepositListFilters {
  status?: CashDepositStatus | 'all';
  fromDate?: string;
  toDate?: string;
  search?: string;
}

export class CashDepositRepository {
  private readonly client: SupabaseClient<Database>;

  constructor(client: SupabaseClient<Database>) {
    this.client = client;
  }

  async list(businessId: string, filters: CashDepositListFilters = {}): Promise<CashDepositSummary[]> {
    let query = this.client.from('cash_deposits').select('*').eq('business_id', businessId)
      .order('deposit_date', { ascending: false }).order('created_at', { ascending: false });
    if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status);
    if (filters.fromDate) query = query.gte('deposit_date', filters.fromDate);
    if (filters.toDate) query = query.lte('deposit_date', filters.toDate);
    if (filters.search?.trim()) query = query.ilike('reference', `%${filters.search.trim()}%`);
    const { data, error } = await query;
    if (error) throw error;
    const deposits = data ?? [];
    if (deposits.length === 0) return [];

    const ids = deposits.map((deposit) => deposit.id);
    const { data: lines, error: linesError } = await this.client.from('cash_deposit_lines')
      .select('deposit_id, amount').eq('business_id', businessId).in('deposit_id', ids);
    if (linesError) throw linesError;
    const totals = new Map<string, number>();
    for (const line of lines ?? []) totals.set(line.deposit_id, (totals.get(line.deposit_id) ?? 0) + Number(line.amount));

    const accountIds = [...new Set(deposits.map((deposit) => deposit.bank_account_id))];
    const { data: accounts, error: accountsError } = await this.client.from('accounts')
      .select('id, name').eq('business_id', businessId).in('id', accountIds);
    if (accountsError) throw accountsError;
    const names = new Map((accounts ?? []).map((account) => [account.id, account.name]));
    return deposits.map((deposit) => ({
      ...deposit,
      total_amount: totals.get(deposit.id) ?? 0,
      bank_account_name: names.get(deposit.bank_account_id) ?? '',
    }));
  }

  async getDetail(businessId: string, depositId: string): Promise<CashDepositDetail> {
    const [depositResult, linesResult, accounts] = await Promise.all([
      this.client.from('cash_deposits').select('*').eq('business_id', businessId).eq('id', depositId).maybeSingle(),
      this.client.from('cash_deposit_lines').select('*').eq('business_id', businessId).eq('deposit_id', depositId).order('line_number'),
      this.getAccountChoices(businessId),
    ]);
    if (depositResult.error) throw depositResult.error;
    if (!depositResult.data) throw new Error('Cash deposit not found.');
    if (linesResult.error) throw linesResult.error;
    return { deposit: depositResult.data, lines: linesResult.data ?? [], accounts };
  }

  async getAccountChoices(businessId: string): Promise<CashDepositAccountChoice[]> {
    const [accountsResult, businessResult] = await Promise.all([
      this.client.from('accounts').select('id, code, name, currency, is_bank_account, is_group, is_active, account_type')
        .eq('business_id', businessId).eq('account_type', 'asset').eq('is_active', true)
        .eq('is_group', false).order('code'),
      this.client.from('businesses').select('base_currency').eq('id', businessId).maybeSingle(),
    ]);
    if (accountsResult.error) throw accountsResult.error;
    if (businessResult.error) throw businessResult.error;
    const baseCurrency = businessResult.data?.base_currency ?? 'MWK';
    return (accountsResult.data ?? []).filter((account) =>
      (account.code.startsWith('111') || account.code.startsWith('112'))
      && (!account.currency || account.currency === baseCurrency),
    ).map(({ id, code, name, currency, is_bank_account }) => ({ id, code, name, currency, is_bank_account }));
  }

  async createDraft(input: CashDepositDraftInput, lines: CashDepositLineInput[]): Promise<CashDeposit> {
    this.validateLines(lines);
    const { data, error } = await this.client.rpc('save_cash_deposit_draft', {
      p_business_id: input.business_id,
      p_deposit_id: null,
      p_deposit_date: input.deposit_date,
      p_bank_account_id: input.bank_account_id,
      p_reference: input.reference ?? null,
      p_notes: input.notes ?? null,
      p_lines: lines.map((line) => ({ ...line })) as Json,
    });
    if (error) throw error;
    return this.fetchDeposit(input.business_id, data);
  }

  async updateDraft(businessId: string, depositId: string, input: Omit<CashDepositDraftInput, 'business_id'>, lines: CashDepositLineInput[]): Promise<CashDeposit> {
    this.validateLines(lines);
    const { data, error } = await this.client.rpc('save_cash_deposit_draft', {
      p_business_id: businessId,
      p_deposit_id: depositId,
      p_deposit_date: input.deposit_date ?? '',
      p_bank_account_id: input.bank_account_id ?? '',
      p_reference: input.reference ?? null,
      p_notes: input.notes ?? null,
      p_lines: lines.map((line) => ({ ...line })) as Json,
    });
    if (error) throw error;
    return this.fetchDeposit(businessId, data);
  }

  async getSourceLines(businessId: string, depositId: string): Promise<CashDepositLine[]> {
    const { data, error } = await this.client.from('cash_deposit_lines').select('*')
      .eq('business_id', businessId).eq('deposit_id', depositId).order('line_number');
    if (error) throw error;
    return data ?? [];
  }

  async post(depositId: string): Promise<string> {
    const { data, error } = await this.client.rpc('post_cash_deposit', { p_deposit_id: depositId });
    if (error) throw error;
    if (!data) throw new Error('Cash deposit posting did not return a journal entry.');
    return data;
  }

  async voidAndReverse(depositId: string, reason: string): Promise<string> {
    if (!reason.trim()) throw new Error('A reason is required to void a posted cash deposit.');
    const { data, error } = await this.client.rpc('void_cash_deposit', { p_deposit_id: depositId, p_reason: reason.trim() });
    if (error) throw error;
    if (!data) throw new Error('Cash deposit reversal did not return a journal entry.');
    return data;
  }

  private async fetchDeposit(businessId: string, depositId: string): Promise<CashDeposit> {
    const { data, error } = await this.client.from('cash_deposits').select('*')
      .eq('business_id', businessId).eq('id', depositId).single();
    if (error) throw error;
    return data;
  }

  private validateLines(lines: CashDepositLineInput[]): void {
    if (lines.length === 0) throw new Error('A cash deposit requires at least one source line.');
    if (lines.some((line) => !line.source_account_id || !Number.isFinite(line.amount) || line.amount <= 0)) {
      throw new Error('Each cash source must have an account and a positive amount.');
    }
  }
}
