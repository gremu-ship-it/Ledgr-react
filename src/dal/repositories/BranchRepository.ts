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

  async findLocations(businessId: string): Promise<Row<'inventory_locations'>[]> {
    const { data, error } = await this.client
      .from('inventory_locations')
      .select('*')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .order('name', { ascending: true });
    if (error) throw toRepositoryError('inventory_locations', error);
    return data ?? [];
  }

  async findLocationByBranch(branchId: string): Promise<Row<'inventory_locations'> | null> {
    const { data, error } = await this.client
      .from('inventory_locations')
      .select('*')
      .eq('branch_id', branchId)
      .maybeSingle();
    if (error) throw toRepositoryError('inventory_locations', error);
    return data ?? null;
  }

  async createWithLocation(
    branch: InsertDto<'branches'>,
  ): Promise<{ branch: Row<'branches'>; location: Row<'inventory_locations'> }> {
    const createdBranch = await this.create(branch as never);

    const { data: location, error: locError } = await this.client
      .from('inventory_locations')
      .insert({
        business_id: createdBranch.business_id,
        branch_id: createdBranch.id,
        name: createdBranch.name,
        code: createdBranch.code ?? createdBranch.name.slice(0, 6).toUpperCase(),
        is_default: false,
        is_active: true,
      } as never)
      .select('*')
      .single();

    if (locError) {
      await this.client.from('branches').delete().eq('id', createdBranch.id);
      throw toRepositoryError('inventory_locations', locError);
    }

    return { branch: createdBranch, location };
  }

  async createBranch(dto: InsertDto<'branches'>): Promise<Row<'branches'>> {
    return this.create(dto as never);
  }

  async updateBranch(id: string, dto: UpdateDto<'branches'>): Promise<Row<'branches'>> {
    return this.update(id, dto as never);
  }

  async deactivateBranch(id: string): Promise<void> {
    await this.update(id, {
      is_active: false,
      deleted_at: new Date().toISOString(),
    } as never);

    await this.client
      .from('inventory_locations')
      .update({ is_active: false } as never)
      .eq('branch_id', id);
  }

  override async softDelete(id: string): Promise<Row<'branches'>> {
    return this.update(id, {
      deleted_at: new Date().toISOString(),
      is_active: false,
    } as never);
  }
}