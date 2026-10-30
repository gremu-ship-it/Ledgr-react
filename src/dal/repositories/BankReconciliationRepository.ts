import type { SupabaseClient } from '@supabase/supabase-js';
import type { ImportedStatementLine } from '@/lib/bankReconciliation/statementCsv';
import type { GlMatchLine } from '@/lib/reconciliation/matcher';

export interface CashBankCoaAccount {
  id: string;
  code: string;
  name: string;
  is_bank_account: boolean;
}

export interface BankAccount {
  id: string;
  business_id: string;
  account_id: string;
  bank_name: string;
  account_number: string;
  branch_name: string | null;
  currency: string;
  is_active: boolean;
  account_code: string;
  account_name: string;
  created_at: string;
}

export interface BankStatement {
  id: string;
  business_id: string;
  account_id: string;
  bank_account_id: string;
  bank_name: string;
  account_number: string;
  account_code: string;
  account_name: string;
  statement_date: string;
  period_start: string;
  opening_balance: number;
  closing_balance: number;
  total_deposits: number;
  total_withdrawals: number;
  line_count: number;
  status: 'draft' | 'reconciled';
  created_at: string;
  source: string | null;
}

export interface BankStatementLine {
  id: string;
  statement_id: string;
  transaction_date: string;
  description: string;
  reference: string | null;
  amount: number;
  running_balance: number | null;
  is_reconciled: boolean;
}

export interface CreateBankAccountInput {
  business_id: string;
  account_id: string;
  bank_name: string;
  account_number: string;
  branch_name: string | null;
  currency: 'MWK';
}

export type UpdateBankAccountInput = Partial<Pick<BankAccount,
  'account_id' | 'bank_name' | 'account_number' | 'branch_name' | 'is_active'
>>;

export interface ImportBankStatementInput {
  businessId: string;
  bankAccountId: string;
  statementDate: string;
  periodStart: string;
  openingBalance: number;
  closingBalance: number;
  lines: ImportedStatementLine[];
}

export interface UnreconciledGlLine {
  journal_line_id: string;
  entry_date: string;
  description: string;
  entry_number: string;
  is_debit: boolean;
  amount: number;
  account_id: string;
}

export interface BankReconciliationMatch {
  id: string;
  business_id: string;
  statement_line_id: string;
  journal_line_id: string;
  matched_amount: number;
  is_auto_match: boolean;
  matched_by: string;
  matched_at: string;
}

export interface CreateMatchInput {
  bankLineId: string;
  glLineId: string;
  matchedAmount: number;
  isAutoMatch: boolean;
}

export interface ReconciliationGlLine extends GlMatchLine {
  account_id: string;
  matchedAmount: number;
}

interface RawReconciliationGlLine {
  journal_line_id: string;
  entry_date: string;
  description: string;
  entry_number: string;
  is_debit: boolean;
  amount: number | string;
  account_id: string;
  matched_amount: number | string;
}

interface RawBankAccount {
  id: string;
  business_id: string;
  account_id: string;
  bank_name: string;
  account_number: string;
  branch_name: string | null;
  currency: string;
  is_active: boolean;
  created_at: string;
}

interface RawBankStatement {
  id: string;
  business_id: string;
  account_id: string;
  statement_date: string;
  opening_balance: number | string;
  closing_balance: number | string;
  source: string | null;
  uploaded_by: string | null;
  created_at: string;
  is_locked: boolean;
  reconciled_at: string | null;
}

interface RawStatementLine {
  id: string;
  statement_id: string;
  business_id: string;
  transaction_date: string;
  description: string;
  reference: string | null;
  debit_amount: number | string;
  credit_amount: number | string;
  balance: number | string | null;
  is_reconciled: boolean;
}

interface RawCoaAccount {
  id: string;
  code: string;
  name: string;
  is_bank_account: boolean;
}

function numeric(value: number | string | null | undefined): number {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function periodStartFallback(statementDate: string): string {
  return `${statementDate.slice(0, 7)}-01`;
}

function accountWithMetadata(
  row: RawBankAccount,
  account?: RawCoaAccount,
): BankAccount {
  return {
    ...row,
    account_code: account?.code ?? '',
    account_name: account?.name ?? '',
  };
}

async function readAccounts(
  supabase: SupabaseClient,
  businessId: string,
): Promise<{ bankAccounts: RawBankAccount[]; coaById: Map<string, RawCoaAccount> }> {
  const { data: bankRows, error: bankError } = await supabase
    .from('bank_accounts')
    .select('id,business_id,account_id,bank_name,account_number,branch_name,currency,is_active,created_at')
    .eq('business_id', businessId)
    .order('bank_name');
  if (bankError) throw bankError;

  const bankAccounts = (bankRows ?? []) as unknown as RawBankAccount[];
  const accountIds = [...new Set(bankAccounts.map((account) => account.account_id))];
  if (accountIds.length === 0) return { bankAccounts, coaById: new Map() };

  const { data: coaRows, error: coaError } = await supabase
    .from('accounts')
    .select('id,code,name,is_bank_account')
    .eq('business_id', businessId)
    .in('id', accountIds);
  if (coaError) throw coaError;
  const coaById = new Map(((coaRows ?? []) as unknown as RawCoaAccount[]).map((account) => [account.id, account]));
  return { bankAccounts, coaById };
}

async function readStatementLines(
  supabase: SupabaseClient,
  statementIds: string[],
): Promise<Map<string, RawStatementLine[]>> {
  if (statementIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('bank_statement_lines')
    .select('id,statement_id,business_id,transaction_date,description,reference,debit_amount,credit_amount,balance,is_reconciled')
    .in('statement_id', statementIds)
    .order('transaction_date');
  if (error) throw error;
  const grouped = new Map<string, RawStatementLine[]>();
  for (const line of (data ?? []) as unknown as RawStatementLine[]) {
    const group = grouped.get(line.statement_id) ?? [];
    group.push(line);
    grouped.set(line.statement_id, group);
  }
  return grouped;
}

function mapStatement(
  statement: RawBankStatement,
  bankAccount: BankAccount,
  metadataPeriodStart: string | undefined,
  lines: RawStatementLine[],
): BankStatement {
  const isReconciled = statement.is_locked || statement.reconciled_at !== null;
  return {
    id: statement.id,
    business_id: statement.business_id,
    account_id: statement.account_id,
    bank_account_id: bankAccount.id,
    bank_name: bankAccount.bank_name,
    account_number: bankAccount.account_number,
    account_code: bankAccount.account_code,
    account_name: bankAccount.account_name,
    statement_date: statement.statement_date,
    period_start: metadataPeriodStart ?? lines[0]?.transaction_date ?? periodStartFallback(statement.statement_date),
    opening_balance: numeric(statement.opening_balance),
    closing_balance: numeric(statement.closing_balance),
    total_deposits: lines.reduce((total, line) => total + numeric(line.credit_amount), 0),
    total_withdrawals: lines.reduce((total, line) => total + numeric(line.debit_amount), 0),
    line_count: lines.length,
    status: isReconciled ? 'reconciled' : 'draft',
    created_at: statement.created_at,
    source: statement.source,
  };
}

export const BankReconciliationRepository = {
  async getEligibleCoaAccounts(supabase: SupabaseClient, businessId: string): Promise<CashBankCoaAccount[]> {
    const { data, error } = await supabase
      .from('accounts')
      .select('id,code,name,is_bank_account,is_group,is_active,account_type')
      .eq('business_id', businessId)
      .eq('account_type', 'asset')
      .eq('is_active', true)
      .eq('is_group', false)
      .order('code');
    if (error) throw error;
    return ((data ?? []) as unknown as Array<RawCoaAccount & { code: string }>)
      .filter((account) => account.code.startsWith('111') || account.code.startsWith('112'))
      .map(({ id, code, name, is_bank_account }) => ({ id, code, name, is_bank_account }));
  },

  async getBankAccounts(supabase: SupabaseClient, businessId: string): Promise<BankAccount[]> {
    const { bankAccounts, coaById } = await readAccounts(supabase, businessId);
    return bankAccounts.map((account) => accountWithMetadata(account, coaById.get(account.account_id)));
  },

  async createBankAccount(supabase: SupabaseClient, input: CreateBankAccountInput): Promise<void> {
    const { error } = await supabase.from('bank_accounts').insert(input as never);
    if (error) throw error;
  },

  async updateBankAccount(
    supabase: SupabaseClient,
    businessId: string,
    bankAccountId: string,
    input: UpdateBankAccountInput,
  ): Promise<void> {
    const { error } = await supabase
      .from('bank_accounts')
      .update(input as never)
      .eq('business_id', businessId)
      .eq('id', bankAccountId);
    if (error) throw error;
  },

  async deactivateBankAccount(supabase: SupabaseClient, businessId: string, bankAccountId: string): Promise<void> {
    const { error } = await supabase
      .from('bank_accounts')
      .update({ is_active: false } as never)
      .eq('business_id', businessId)
      .eq('id', bankAccountId);
    if (error) throw error;
  },

  async getStatements(
    supabase: SupabaseClient,
    businessId: string,
    bankAccountId?: string,
  ): Promise<BankStatement[]> {
    const { bankAccounts, coaById } = await readAccounts(supabase, businessId);
    const selectedAccounts = bankAccountId
      ? bankAccounts.filter((account) => account.id === bankAccountId)
      : bankAccounts;
    if (selectedAccounts.length === 0) return [];

    const accountIds = selectedAccounts.map((account) => account.account_id);
    const statementQuery = supabase
      .from('bank_statements')
      .select('id,business_id,account_id,statement_date,opening_balance,closing_balance,source,uploaded_by,created_at,is_locked,reconciled_at')
      .eq('business_id', businessId)
      .in('account_id', accountIds)
      .order('statement_date', { ascending: false });
    const { data: statementRows, error: statementError } = await statementQuery;
    if (statementError) throw statementError;
    const statements = (statementRows ?? []) as unknown as RawBankStatement[];
    const statementIds = statements.map((statement) => statement.id);
    if (statementIds.length === 0) return [];

    const [{ data: metadataRows, error: metadataError }, linesByStatement] = await Promise.all([
      supabase.from('bank_statement_import_metadata').select('statement_id,period_start').in('statement_id', statementIds),
      readStatementLines(supabase, statementIds),
    ]);
    if (metadataError) throw metadataError;
    const periodStartById = new Map(((metadataRows ?? []) as unknown as Array<{ statement_id: string; period_start: string }>).
      map((metadata) => [metadata.statement_id, metadata.period_start]));
    const bankAccountByCoaId = new Map(selectedAccounts.map((account) => [account.account_id, accountWithMetadata(account, coaById.get(account.account_id))]));

    return statements.flatMap((statement) => {
      const bankAccount = bankAccountByCoaId.get(statement.account_id);
      if (!bankAccount) return [];
      return [mapStatement(statement, bankAccount, periodStartById.get(statement.id), linesByStatement.get(statement.id) ?? [])];
    });
  },

  async getStatement(
    supabase: SupabaseClient,
    businessId: string,
    statementId: string,
  ): Promise<BankStatement | null> {
    const { data, error } = await supabase
      .from('bank_statements')
      .select('id,business_id,account_id,statement_date,opening_balance,closing_balance,source,uploaded_by,created_at,is_locked,reconciled_at')
      .eq('business_id', businessId)
      .eq('id', statementId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const statement = data as unknown as RawBankStatement;
    const [accounts, { data: metadata, error: metadataError }, linesByStatement] = await Promise.all([
      this.getBankAccounts(supabase, businessId),
      supabase.from('bank_statement_import_metadata').select('period_start').eq('statement_id', statementId).maybeSingle(),
      readStatementLines(supabase, [statementId]),
    ]);
    if (metadataError) throw metadataError;
    const bankAccount = accounts.find((account) => account.account_id === statement.account_id);
    if (!bankAccount) return null;
    return mapStatement(
      statement,
      bankAccount,
      (metadata as { period_start: string } | null)?.period_start,
      linesByStatement.get(statementId) ?? [],
    );
  },

  async getStatementLines(supabase: SupabaseClient, statementId: string): Promise<BankStatementLine[]> {
    const grouped = await readStatementLines(supabase, [statementId]);
    return (grouped.get(statementId) ?? []).map((line) => ({
      id: line.id,
      statement_id: line.statement_id,
      transaction_date: line.transaction_date,
      description: line.description,
      reference: line.reference,
      amount: numeric(line.credit_amount) - numeric(line.debit_amount),
      running_balance: line.balance === null ? null : numeric(line.balance),
      is_reconciled: line.is_reconciled,
    }));
  },

  async importStatement(supabase: SupabaseClient, input: ImportBankStatementInput): Promise<string> {
    const { data, error } = await supabase.rpc('import_bank_statement', {
      p_business_id: input.businessId,
      p_bank_account_id: input.bankAccountId,
      p_statement_date: input.statementDate,
      p_period_start: input.periodStart,
      p_opening_balance: input.openingBalance,
      p_closing_balance: input.closingBalance,
      p_lines: input.lines as never,
    } as never);
    if (error) throw error;
    return String(data);
  },

  async deleteStatement(supabase: SupabaseClient, businessId: string, statementId: string): Promise<void> {
    const { error } = await supabase.rpc('delete_draft_bank_statement', {
      p_business_id: businessId,
      p_statement_id: statementId,
    } as never);
    if (error) throw error;
  },

  async getUnreconciledGlLines(
    supabase: SupabaseClient,
    params: { businessId: string; bankAccountId: string; dateFrom: string; dateTo: string },
  ): Promise<UnreconciledGlLine[]> {
    const { data, error } = await supabase.rpc('get_unreconciled_gl_lines', {
      p_business_id: params.businessId,
      p_bank_account_id: params.bankAccountId,
      p_date_from: params.dateFrom,
      p_date_to: params.dateTo,
    } as never);
    if (error) throw error;
    return (data ?? []) as unknown as UnreconciledGlLine[];
  },

  async getMatchesForStatement(supabase: SupabaseClient, statementId: string): Promise<BankReconciliationMatch[]> {
    const { data: lineRows, error: linesError } = await supabase
      .from('bank_statement_lines')
      .select('id')
      .eq('statement_id', statementId);
    if (linesError) throw linesError;
    const lineIds = ((lineRows ?? []) as unknown as Array<{ id: string }>).map(({ id }) => id);
    if (lineIds.length === 0) return [];
    const { data, error } = await supabase
      .from('bank_reconciliation_matches')
      .select('id,business_id,statement_line_id,journal_line_id,matched_amount,is_auto_match,matched_by,matched_at')
      .in('statement_line_id', lineIds)
      .order('matched_at');
    if (error) throw error;
    return ((data ?? []) as unknown as BankReconciliationMatch[]).map((match) => ({
      ...match,
      matched_amount: numeric(match.matched_amount),
    }));
  },

  async getReconciliationGlLines(
    supabase: SupabaseClient,
    params: { businessId: string; bankAccountId: string; dateFrom: string; dateTo: string },
  ): Promise<ReconciliationGlLine[]> {
    const { data, error } = await supabase.rpc('get_bank_reconciliation_gl_lines', {
      p_business_id: params.businessId,
      p_bank_account_id: params.bankAccountId,
      p_date_from: params.dateFrom,
      p_date_to: params.dateTo,
    } as never);
    if (error) throw error;
    return ((data ?? []) as unknown as RawReconciliationGlLine[]).map((line) => ({
      id: line.journal_line_id,
      entry_date: line.entry_date,
      description: line.description,
      entry_number: line.entry_number,
      is_debit: line.is_debit,
      amount: numeric(line.amount),
      account_id: line.account_id,
      matchedAmount: numeric(line.matched_amount),
    }));
  },

  async getBookBalance(
    supabase: SupabaseClient,
    businessId: string,
    bankAccountId: string,
    asOfDate: string,
  ): Promise<number> {
    const { data, error } = await supabase.rpc('get_bank_gl_book_balance', {
      p_business_id: businessId,
      p_bank_account_id: bankAccountId,
      p_as_of_date: asOfDate,
    } as never);
    if (error) throw error;
    return numeric(data as number | string | null);
  },

  async bulkCreateMatches(
    supabase: SupabaseClient,
    businessId: string,
    statementId: string,
    matches: CreateMatchInput[],
  ): Promise<void> {
    if (matches.length === 0) return;
    const { error } = await supabase.rpc('create_bank_reconciliation_matches', {
      p_business_id: businessId,
      p_statement_id: statementId,
      p_matches: matches.map((match) => ({
        statement_line_id: match.bankLineId,
        journal_line_id: match.glLineId,
        matched_amount: match.matchedAmount,
        is_auto_match: match.isAutoMatch,
      })) as never,
    } as never);
    if (error) throw error;
  },

  async deleteMatch(supabase: SupabaseClient, businessId: string, matchId: string): Promise<void> {
    const { error } = await supabase.rpc('delete_bank_reconciliation_match', {
      p_business_id: businessId,
      p_match_id: matchId,
    } as never);
    if (error) throw error;
  },

  async reconcileStatement(supabase: SupabaseClient, businessId: string, statementId: string): Promise<void> {
    const { error } = await supabase.rpc('reconcile_bank_statement', {
      p_business_id: businessId,
      p_statement_id: statementId,
    } as never);
    if (error) throw error;
  },

  async unreconcileStatement(supabase: SupabaseClient, businessId: string, statementId: string): Promise<void> {
    const { error } = await supabase.rpc('unreconcile_bank_statement', {
      p_business_id: businessId,
      p_statement_id: statementId,
    } as never);
    if (error) throw error;
  },
};
