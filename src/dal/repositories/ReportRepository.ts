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
}

export const ReportRepository = {
  async getTrialBalance(
    supabase: SupabaseClient,
    params: TrialBalanceParams,
  ): Promise<TrialBalanceRow[]> {
    const { data, error } = await supabase.rpc('get_trial_balance', {
      p_business_id: params.businessId,
      p_date_from: params.dateFrom,
      p_date_to: params.dateTo,
      p_branch_id: params.branchId ?? null,
    });

    if (error) throw error;
    return (data ?? []) as TrialBalanceRow[];
  },
};
