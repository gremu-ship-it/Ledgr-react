import type { SupabaseClient } from '@supabase/supabase-js';

export interface TrialBalanceRow {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  parent_account_id: string | null;
  total_debit: number;
  total_credit: number;
  balance: number;
  level: number;
}

export interface TrialBalanceParams {
  businessId: string;
  dateFrom: string;
  dateTo: string;
  branchId?: string | null;
  /** Exclude original/reversal pairs for period P&L without changing the canonical trial balance. */
  excludeReversalPairs?: boolean;
}

export const ReportRepository = {
  async getTrialBalance(
    supabase: SupabaseClient,
    params: TrialBalanceParams,
  ): Promise<TrialBalanceRow[]> {
    const rpc = params.excludeReversalPairs
      ? 'get_profit_loss_trial_balance'
      : 'get_trial_balance';
    const { data, error } = await (supabase as unknown as {
      rpc: (
        functionName: string,
        args: { p_business_id: string; p_date_from: string; p_date_to: string; p_branch_id: string | null },
      ) => Promise<{ data: unknown; error: Error | null }>;
    }).rpc(rpc, {
      p_business_id: params.businessId,
      p_date_from: params.dateFrom,
      p_date_to: params.dateTo,
      p_branch_id: params.branchId ?? null,
    });

    if (error) throw error;
    return (data ?? []) as TrialBalanceRow[];
  },
};
