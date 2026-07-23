import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row } from '../types/database';
import { BaseRepository } from './BaseRepository';
import { toRepositoryError } from '../errors/RepositoryError';

export class ShareRepository extends BaseRepository<'share_transactions'> {
  constructor(client: SupabaseClient<Database>) {
    super(client, 'share_transactions');
  }

  async findByBusiness(businessId: string): Promise<Row<'share_transactions'>[]> {
    const { data, error } = await this.client
      .from('share_transactions')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });
    if (error) throw toRepositoryError('share_transactions', error);
    return data ?? [];
  }
}
