import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row, InsertDto, UpdateDto } from '../types/database';
import { BaseRepository } from './BaseRepository';
import { toRepositoryError } from '../errors/RepositoryError';

export class BranchRepository extends BaseRepository<'branches'> {
  constructor(client: SupabaseClient<Database>) {
    super(client, 'branches');
  }

  async findByBusiness(businessId: string): Promise<Row<'branches'>[]> {
    const { data, error } = await this.client
      .from('branches')
      .select('*')
      .eq('business_id', businessId)
      .is('deleted_at', null)
      .order('name', { ascending: true });
    if (error) throw toRepositoryError('branches', error);
    return data ?? [];
  }

  async findActive(businessId: string): Promise<Row<'branches'>[]> {
    const { data, error } = await this.client
      .from('branches')
      .select('*')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name', { ascending: true });
    if (error) throw toRepositoryError('branches', error);
    return data ?? [];
  }

  async createBranch(dto: InsertDto<'branches'>): Promise<Row<'branches'>> {
    return this.create(dto as never);
  }

  async updateBranch(id: string, dto: UpdateDto<'branches'>): Promise<Row<'branches'>> {
    return this.update(id, dto as never);
  }

  async softDelete(id: string): Promise<Row<'branches'>> {
    return this.update(id, {
      deleted_at: new Date().toISOString(),
      is_active: false,
    } as never);
  }
}