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
  /**
   * Fetch all active businesses the current user belongs to.
   *
   * When `partnerId` is supplied the listing is scoped to that partner's
   * clients instead — used by the partner admin portal, where RLS already
   * restricts the caller to partners they administer.
   */
  async findByUser(userId: string, partnerId?: string): Promise<Row<'businesses'>[]> {
    if (partnerId) {
      const { data, error } = await this.client
        .from('partner_clients')
        .select('business:businesses!inner(*)')
        .eq('partner_id', partnerId)
        .eq('businesses.is_active', true)
        .is('businesses.deleted_at', null);
      if (error) throw toRepositoryError('businesses', error);
      type JoinRow = { business: Row<'businesses'> | Row<'businesses'>[] | null };
      return ((data ?? []) as JoinRow[])
        .map((row) => (Array.isArray(row.business) ? row.business[0] : row.business))
        .filter((b): b is Row<'businesses'> => b !== null && b !== undefined);
    }
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

  /**
   * Reserve the next document number for a business.
   *
   * Delegates to the `reserve_next_document_number` RPC rather than doing a
   * read-then-write here, for two reasons:
   *
   *  1. Permissions. Advancing a counter used to require UPDATE on the whole
   *     businesses row, which RLS restricts to owner/admin. Every other writer
   *     role — supervisor, sales_clerk, data_entry — got zero matched rows,
   *     and BaseRepository.update() reports that as
   *     `businesses with id "…" was not found`, naming a business that exists
   *     and is readable. The RPC is SECURITY DEFINER and checks
   *     can_write_business_data / can_write_payroll instead, so a writer can
   *     raise an invoice without also being able to rename the company.
   *
   *  2. Concurrency. Read-then-write let two simultaneous users observe the
   *     same counter and reserve the same number. The RPC's
   *     `UPDATE … RETURNING` is atomic.
   */
  private async reserveDocumentNumber(
    businessId: string,
    kind: 'invoice' | 'expense' | 'payroll',
  ): Promise<string> {
    const { data, error } = await this.client.rpc('reserve_next_document_number', {
      p_business_id: businessId,
      p_kind: kind,
    });
    if (error) throw toRepositoryError('businesses', error);
    if (!data) throw new NotFoundError('businesses', businessId);
    return data as string;
  }

  async reserveNextInvoiceNumber(businessId: string): Promise<string> {
    return this.reserveDocumentNumber(businessId, 'invoice');
  }

  async reserveNextExpenseNumber(businessId: string): Promise<string> {
    return this.reserveDocumentNumber(businessId, 'expense');
  }

  async reserveNextPayrollNumber(businessId: string): Promise<string> {
    return this.reserveDocumentNumber(businessId, 'payroll');
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

    type MembershipRow = { role: string; business: Row<'businesses'> | Row<'businesses'>[] };
    const memberships = (data ?? [])
      .map((row: MembershipRow) => {
        const business = Array.isArray(row.business) ? row.business[0] : row.business;
        return { role: row.role, business };
      })
      .filter((m): m is { role: string; business: Row<'businesses'> } =>
        Boolean(m.business?.id && m.business.name),
      );

    return memberships;
  }
}