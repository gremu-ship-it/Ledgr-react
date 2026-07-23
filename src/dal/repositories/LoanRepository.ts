import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row } from '../types/database';
import { BaseRepository } from './BaseRepository';
import { toRepositoryError } from '../errors/RepositoryError';

export class LoanRepository extends BaseRepository<'loans'> {
  constructor(client: SupabaseClient<Database>) {
    super(client, 'loans');
  }

  async findByBusiness(businessId: string): Promise<Row<'loans'>[]> {
    const { data, error } = await this.client
      .from('loans')
      .select('*')
      .eq('business_id', businessId)
      .order('start_date', { ascending: false });
    if (error) throw toRepositoryError('loans', error);
    return data ?? [];
  }
}

export class LoanRepaymentRepository extends BaseRepository<'loan_repayments'> {
  constructor(client: SupabaseClient<Database>) {
    super(client, 'loan_repayments');
  }

  async findByBusiness(businessId: string): Promise<Row<'loan_repayments'>[]> {
    const { data, error } = await this.client
      .from('loan_repayments')
      .select('*')
      .eq('business_id', businessId)
      .order('repayment_date', { ascending: false });
    if (error) throw toRepositoryError('loan_repayments', error);
    return data ?? [];
  }

  async findByLoan(businessId: string, loanId: string): Promise<Row<'loan_repayments'>[]> {
    const { data, error } = await this.client
      .from('loan_repayments')
      .select('*')
      .eq('business_id', businessId)
      .eq('loan_id', loanId)
      .order('repayment_date', { ascending: true });
    if (error) throw toRepositoryError('loan_repayments', error);
    return data ?? [];
  }
}
