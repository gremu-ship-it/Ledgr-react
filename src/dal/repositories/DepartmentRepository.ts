import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row, InsertDto, UpdateDto } from '../types/database';
import { BaseRepository } from './BaseRepository';
import { toRepositoryError } from '../errors/RepositoryError';

export class DepartmentRepository extends BaseRepository<'departments'> {
  constructor(client: SupabaseClient<Database>) {
    super(client, 'departments');
  }

  async findByBusiness(businessId: string): Promise<Row<'departments'>[]> {
    const { data, error } = await this.client
      .from('departments')
      .select('*')
      .eq('business_id', businessId)
      .is('deleted_at', null)
      .order('name', { ascending: true });
    if (error) throw toRepositoryError('departments', error);
    return data ?? [];
  }

  async findActive(businessId: string): Promise<Row<'departments'>[]> {
    const { data, error } = await this.client
      .from('departments')
      .select('*')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name', { ascending: true });
    if (error) throw toRepositoryError('departments', error);
    return data ?? [];
  }

  async createDepartment(dto: InsertDto<'departments'>): Promise<Row<'departments'>> {
    return this.create(dto as never);
  }

  async updateDepartment(id: string, dto: UpdateDto<'departments'>): Promise<Row<'departments'>> {
    return this.update(id, dto as never);
  }

  async deactivateDepartment(id: string): Promise<void> {
    await this.update(id, {
      is_active: false,
      deleted_at: new Date().toISOString(),
    } as never);
  }

  override async softDelete(id: string): Promise<Row<'departments'>> {
    return this.update(id, {
      deleted_at: new Date().toISOString(),
      is_active: false,
    } as never);
  }
}
