import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row } from '../types/database';
import { BaseRepository } from './BaseRepository';
import { NotFoundError, toRepositoryError } from '../errors/RepositoryError';

export class BusinessRepository extends BaseRepository<'businesses'> {
  constructor(client: SupabaseClient<Database>) {
    super(client, 'businesses');
  }

  /**
   * FIX [findById override]: BaseRepository.findById does not filter deleted_at.
   * A soft-deleted business would be returned by the generic method.
   * This override adds .is('deleted_at', null) so callers always receive
   * only live businesses.
   */
  override async findById(id: string): Promise<Row<'businesses'>> {
    const { data, error } = await this.client
      .from('businesses')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw toRepositoryError('businesses', error);
    if (!data) throw new NotFoundError('businesses', id);
    return data;
  }

  /**
   * Fetch all active businesses the current user belongs to.
   * Filters pushed DB-side via !inner join — no in-memory filtering.
   */
  async findByUser(userId: string): Promise<Row<'businesses'>[]> {
    const { data, error } = await this.client
      .from('business_users')
      .select('business:businesses!inner(*)')
      .eq('user_id', userId)
      .eq('is_active', true)
      .eq('businesses.is_active', true)
      .is('businesses.deleted_at', null);
    if (error) throw toRepositoryError('businesses', error);
    type JoinRow = { business: Row<'businesses'> | Row<'businesses'>[] | null };
    return (data ?? [])
      .map((row) => {
        const joined = (row as JoinRow).business;
        return Array.isArray(joined) ? joined[0] : joined;
      })
      .filter((b): b is Row<'businesses'> => b !== null && b !== undefined);
  }

  /**
   * Fetch a business with the user's role.
   * Checks business_users.is_active to match the RLS current_user_business_role() helper.
   */
  async findWithRole(
    businessId: string,
    userId: string,
  ): Promise<{ business: Row<'businesses'>; role: Row<'business_users'>['role'] } | null> {
    const business = await this.findById(businessId);
    const { data, error } = await this.client
      .from('business_users')
      .select('role')
      .eq('business_id', businessId)
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw toRepositoryError('businesses', error);
    if (!data) return null;
    const role = (data as { role: Row<'business_users'>['role'] }).role;
    return { business, role };
  }

  /** ⚠️ Concurrency risk — documented. Replace with Postgres RPC for multi-user deployments. */
  async reserveNextInvoiceNumber(businessId: string): Promise<string> {
    const business = await this.findById(businessId);
    const nextNumber = business.invoice_next_number;
    await this.update(businessId, { invoice_next_number: nextNumber + 1 });
    return `${business.invoice_prefix ?? 'INV'}-${String(nextNumber).padStart(4, '0')}`;
  }

  async reserveNextExpenseNumber(businessId: string): Promise<string> {
    const business = await this.findById(businessId);
    const nextNumber = business.expense_next_number;
    await this.update(businessId, { expense_next_number: nextNumber + 1 });
    return `${business.expense_prefix ?? 'EXP'}-${String(nextNumber).padStart(4, '0')}`;
  }

  async reserveNextPayrollNumber(businessId: string): Promise<string> {
    const business = await this.findById(businessId);
    const nextNumber = business.payroll_next_number;

    await this.update(businessId, {
      payroll_next_number: nextNumber + 1,
    });

    return `${business.payroll_prefix ?? 'PAY'}-${String(
      nextNumber,
    ).padStart(4, '0')}`;
  }

  async findUserProfile(userId: string) {
    const { data, error } = await this.client
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      throw toRepositoryError('user_profiles', error);
    }

    return data;
  }

  /**
   * UPDATED: Uses !inner join + select * to get the full business shape,
   * and filters deleted/inactive businesses DB-side to avoid RLS circular
   * dependency issues where only id+name were previously selected.
   */
  async findMembershipsWithRole(userId: string) {
    const { data, error } = await this.client
      .from('business_users')
      .select(`
        role,
        is_active,
        business:businesses!inner (
          *
        )
      `)
      .eq('user_id', userId)
      .eq('is_active', true)
      .eq('businesses.is_active', true)
      .is('businesses.deleted_at', null);

    if (error) {
      throw toRepositoryError('business_users', error);
    }

    const memberships = (data ?? [])
      .map((row: any) => {
        const business = Array.isArray(row.business)
          ? row.business[0]
          : row.business;
        return { role: row.role, business };
      })
      .filter((m: any) => m?.business?.id && m.business.name);

    console.log('findMembershipsWithRole result:', memberships);
    return memberships;
  }
}