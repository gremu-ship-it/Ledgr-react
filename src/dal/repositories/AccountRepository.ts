import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row, AccountType, AccountSubtype } from '../types/database';
import { BaseRepository } from './BaseRepository';
import { toRepositoryError } from '../errors/RepositoryError';

export class AccountRepository extends BaseRepository<'accounts'> {
  constructor(client: SupabaseClient<Database>) {
    super(client, 'accounts');
  }

  async findByBusiness(businessId: string): Promise<Row<'accounts'>[]> {
    const { data, error } = await this.client
      .from('accounts').select('*')
      .eq('business_id', businessId)
      .is('deleted_at', null)
      .order('code', { ascending: true });
    if (error) throw toRepositoryError('accounts', error);
    return data ?? [];
  }

  /**
   * FIX [is_active filter]: Added is_active=true filter to match
   * findPostingAccounts behaviour. Inactive accounts should not be
   * returned for general use — they remain in the DB for historical
   * journal line references but are not selectable for new postings.
   *
   * @param includeGroups - false (default) = leaf accounts only for posting pickers.
   *                        true = full hierarchy for CoA tree views.
   */
  async findByType(
    businessId: string,
    accountType: AccountType,
    includeGroups = false,
  ): Promise<Row<'accounts'>[]> {
    let query = this.client
      .from('accounts').select('*')
      .eq('business_id', businessId)
      .eq('account_type', accountType)
      .eq('is_active', true)         // FIX: was missing
      .is('deleted_at', null);
    if (!includeGroups) query = query.eq('is_group', false);
    const { data, error } = await query.order('code', { ascending: true });
    if (error) throw toRepositoryError('accounts', error);
    return data ?? [];
  }

  async findPostingAccounts(businessId: string): Promise<Row<'accounts'>[]> {
    const { data, error } = await this.client
      .from('accounts').select('*')
      .eq('business_id', businessId)
      .eq('is_group', false)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('code', { ascending: true });
    if (error) throw toRepositoryError('accounts', error);
    return data ?? [];
  }

  async findBySubtype(businessId: string, subtype: AccountSubtype): Promise<Row<'accounts'>[]> {
    const { data, error } = await this.client
      .from('accounts').select('*')
      .eq('business_id', businessId)
      .eq('account_subtype', subtype)
      .eq('is_group', false)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('code', { ascending: true });
    if (error) throw toRepositoryError('accounts', error);
    return data ?? [];
  }

  async findByCode(businessId: string, code: string): Promise<Row<'accounts'> | null> {
    const { data, error } = await this.client
      .from('accounts').select('*')
      .eq('business_id', businessId)
      .eq('code', code)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw toRepositoryError('accounts', error);
    return data ?? null;
  }

  async findBankAccounts(businessId: string): Promise<Row<'accounts'>[]> {
    const { data, error } = await this.client
      .from('accounts').select('*')
      .eq('business_id', businessId)
      .eq('is_bank_account', true)
      .is('deleted_at', null)
      .order('name', { ascending: true });
    if (error) throw toRepositoryError('accounts', error);
    return data ?? [];
  }

  async findOrCreateBySubtype(
    businessId: string,
    subtype: AccountSubtype,
    accountType: AccountType,
    defaults: { code: string; name: string; normalBalance: 'debit' | 'credit' },
  ): Promise<Row<'accounts'>> {
    const existing = await this.findBySubtype(businessId, subtype);
    if (existing.length > 0) return existing[0];

    return this.create({
      business_id: businessId,
      code: defaults.code,
      name: defaults.name,
      account_type: accountType,
      account_subtype: subtype,
      normal_balance: defaults.normalBalance,
      currency: 'MWK',
      is_group: false,
      is_system: true,
      is_active: true,
      is_bank_account: false,
      opening_balance: 0,
    } as never);
  }
}