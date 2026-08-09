import { supabase } from '@/lib/supabase';

export interface BusinessDirectoryEntry {
  business_id: string;
  business_name: string;
  trading_name: string | null;
  email: string | null;
  phone: string | null;
  plan_tier: string;
  created_at: string;
  owner_emails: string;
  owner_names: string;
}

function mapRow(row: Record<string, unknown>): BusinessDirectoryEntry {
  return {
    business_id: String(row.out_business_id ?? ''),
    business_name: String(row.out_business_name ?? ''),
    trading_name: row.out_trading_name ? String(row.out_trading_name) : null,
    email: row.out_email ? String(row.out_email) : null,
    phone: row.out_phone ? String(row.out_phone) : null,
    plan_tier: String(row.out_plan_tier ?? 'free'),
    created_at: String(row.out_created_at ?? ''),
    owner_emails: String(row.out_owner_emails ?? ''),
    owner_names: String(row.out_owner_names ?? ''),
  };
}

/**
 * Platform-admin businesses directory.
 *
 * Powered by a SECURITY DEFINER RPC (20260809000003_admin_business_directory.sql)
 * because the client cannot read auth.users / business_users across tenants.
 * Authorization is enforced inside the function against auth.uid() — only
 * platform admins get rows; everyone else gets a hard error.
 */
export const BusinessAdminRepository = {
  async listAll(): Promise<BusinessDirectoryEntry[]> {
    const { data, error } = await supabase.rpc('list_all_businesses' as never);
    if (error) throw new Error(error.message);
    return ((data as Record<string, unknown>[]) ?? []).map(mapRow);
  },
};
