import { supabase } from '@/lib/supabase';

export interface PartnerAdminMember {
  user_id: string;
  email: string;
  name: string;
  role: 'admin' | 'viewer';
  created_at: string;
}

function mapAdmin(row: Record<string, unknown>): PartnerAdminMember {
  return {
    user_id: String(row.out_user_id ?? row.user_id ?? ''),
    email: String(row.out_email ?? row.email ?? ''),
    name: String(row.out_name ?? row.name ?? ''),
    role: ((row.out_role ?? row.role ?? 'admin') as PartnerAdminMember['role']),
    created_at: String(row.out_created_at ?? row.created_at ?? ''),
  };
}

/**
 * Bank/MFI staff management for a partner tenant.
 *
 * These operations resolve users by email/id against auth.users server-side
 * (SECURITY DEFINER — see 20260809000001_partner_admin_management.sql), so the
 * client never reads auth.users directly. Authorization is enforced inside the
 * functions: add/remove require a platform admin; listing requires a platform
 * admin or that partner's own admin.
 */
export const PartnerAdminRepository = {
  async list(partnerId: string): Promise<PartnerAdminMember[]> {
    const { data, error } = await supabase.rpc('list_partner_admins' as never, {
      p_partner_id: partnerId,
    } as never);
    if (error) throw new Error(error.message);
    return ((data as Record<string, unknown>[]) ?? []).map(mapAdmin);
  },

  async add(partnerId: string, emailOrId: string, role: 'admin' | 'viewer'): Promise<void> {
    const { error } = await supabase.rpc('add_partner_admin' as never, {
      p_partner_id: partnerId,
      p_user_email_or_id: emailOrId.trim().toLowerCase(),
      p_role: role,
    } as never);
    if (error) throw new Error(error.message);
  },

  async remove(partnerId: string, emailOrId: string): Promise<void> {
    const { error } = await supabase.rpc('remove_partner_admin' as never, {
      p_partner_id: partnerId,
      p_user_email_or_id: emailOrId.trim().toLowerCase(),
    } as never);
    if (error) throw new Error(error.message);
  },
};
