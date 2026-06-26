import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row, InsertDto, UpdateDto } from '../types/database';
import { BaseRepository } from './BaseRepository';
import { toRepositoryError } from '../errors/RepositoryError';

export class ContactRepository extends BaseRepository<'contacts'> {
  constructor(client: SupabaseClient<Database>) {
    super(client, 'contacts');
  }

  async findByBusiness(
    businessId: string,
    type?: 'customer' | 'supplier' | 'both',
  ): Promise<Row<'contacts'>[]> {
    let query = this.client
      .from('contacts')
      .select('*')
      .eq('business_id', businessId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name', { ascending: true });

    if (type) query = query.eq('contact_type', type);

    const { data, error } = await query;
    if (error) throw toRepositoryError('contacts', error);
    return data ?? [];
  }

  async createContact(payload: InsertDto<'contacts'>): Promise<Row<'contacts'>> {
    const { data, error } = await this.client
      .from('contacts')
      .insert(payload as never)
      .select('*')
      .single();
    if (error) throw toRepositoryError('contacts', error);
    return data as Row<'contacts'>;
  }

  async updateContact(id: string, payload: UpdateDto<'contacts'>): Promise<Row<'contacts'>> {
    const { data, error } = await this.client
      .from('contacts')
      .update(payload as never)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw toRepositoryError('contacts', error);
    return data as Row<'contacts'>;
  }

  async deleteContact(id: string): Promise<void> {
    const { error } = await this.client
      .from('contacts')
      .update({ deleted_at: new Date().toISOString(), is_active: false } as never)
      .eq('id', id);
    if (error) throw toRepositoryError('contacts', error);
  }

  async getArAgeing(businessId: string) {
    const { data, error } = await this.client
      .from('v_ar_ageing')
      .select('*')
      .eq('business_id', businessId)
      .order('days_overdue', { ascending: false });
    if (error) throw toRepositoryError('v_ar_ageing', error);
    return data ?? [];
  }
}