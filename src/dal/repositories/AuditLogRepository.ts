import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row } from '../types/database';
import { toRepositoryError } from '../errors/RepositoryError';

export interface AuditLogEntry extends Row<'audit_log'> {
  entry_hash:     string | null;
  prev_hash:      string | null;
  chain_valid?:   boolean;
}

export interface AuditLogFilters {
  businessId:    string;
  fromDate?:     string;
  toDate?:       string;
  userId?:       string;
  resourceType?: string;
  eventType?:    string;
  search?:       string;
  limit?:        number;
  offset?:       number;
}

export interface ChainVerificationResult {
  id:            number;
  occurred_at:   string;
  resource_type: string;
  resource_id:   string | null;
  event_type:    string;
  entry_hash:    string | null;
  prev_hash:     string | null;
  chain_valid:   boolean;
}

export class AuditLogRepository {
  private readonly client: SupabaseClient<Database>;

  constructor(client: SupabaseClient<Database>) {
    this.client = client;
  }

  async findByBusiness(filters: AuditLogFilters): Promise<{
    data: AuditLogEntry[];
    count: number;
  }> {
    const limit  = filters.limit  ?? 50;
    const offset = filters.offset ?? 0;

    let query = this.client
      .from('audit_log')
      .select('*', { count: 'exact' })
      .eq('business_id', filters.businessId)
      .order('occurred_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (filters.fromDate)     query = query.gte('occurred_at', filters.fromDate);
    if (filters.toDate)       query = query.lte('occurred_at', filters.toDate + 'T23:59:59Z');
    if (filters.userId)       query = query.eq('user_id', filters.userId);
    if (filters.resourceType) query = query.eq('resource_type', filters.resourceType);
    if (filters.eventType)    query = query.eq('event_type', filters.eventType);

    if (filters.search) {
      query = query.or(
        `resource_ref.ilike.%${filters.search}%,` +
        `notes.ilike.%${filters.search}%,` +
        `user_email.ilike.%${filters.search}%`,
      );
    }

    const { data, error, count } = await query;
    if (error) throw toRepositoryError('audit_log', error);

    return {
      data: (data ?? []) as AuditLogEntry[],
      count: count ?? 0,
    };
  }

  async verifyChain(
    businessId: string,
    resourceType?: string,
  ): Promise<ChainVerificationResult[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (this.client.rpc as any)(
      'verify_audit_chain',
      {
        p_business_id:   businessId,
        p_resource_type: resourceType ?? null,
      },
    );
    if (error) throw toRepositoryError('audit_log', error);
    return (data ?? []) as ChainVerificationResult[];
  }

  async getDistinctUsers(businessId: string): Promise<{ user_id: string; user_email: string | null }[]> {
    const { data, error } = await this.client
      .from('audit_log')
      .select('user_id, user_email')
      .eq('business_id', businessId)
      .not('user_id', 'is', null)
      .order('user_email', { ascending: true });

    if (error) throw toRepositoryError('audit_log', error);

    // Deduplicate by user_id
    const seen = new Set<string>();
    return (data ?? []).filter((row) => {
      if (!row.user_id || seen.has(row.user_id)) return false;
      seen.add(row.user_id);
      return true;
    }) as { user_id: string; user_email: string | null }[];
  }

  async getDistinctResourceTypes(businessId: string): Promise<string[]> {
    const { data, error } = await this.client
      .from('audit_log')
      .select('resource_type')
      .eq('business_id', businessId)
      .order('resource_type', { ascending: true });

    if (error) throw toRepositoryError('audit_log', error);

    const seen = new Set<string>();
    return (data ?? [])
      .map((r) => r.resource_type)
      .filter((t): t is string => {
        if (!t || seen.has(t)) return false;
        seen.add(t);
        return true;
      });
  }
}