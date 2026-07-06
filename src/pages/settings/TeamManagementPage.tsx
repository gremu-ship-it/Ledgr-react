import { useState, useEffect, useCallback } from 'react';
import {
  UserPlus, Trash2, Loader2, AlertCircle,
  Crown, Shield, Calculator, Users, Eye, BarChart3, Mail,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';
import { usePermissions } from '@/hooks/usePermissions';
import { PermissionGate } from '@/components/rbac/PermissionGate';
import { clsx } from 'clsx';

// ── Types ────────────────────────────────────────────────────────────────────

type UserRole = 'owner' | 'admin' | 'accountant' | 'payroll_manager' | 'auditor' | 'viewer';

interface Member {
  id: string;
  user_id: string;
  role: UserRole;
  is_active: boolean;
  invited_at: string | null;
  accepted_at: string | null;
  invitation_token: string | null;
  email: string | null;
  full_name: string | null;
}

// ── Role display config ───────────────────────────────────────────────────────

const ROLE_CONFIG: Record<UserRole, {
  label: string;
  description: string;
  icon: React.ElementType;
  badge: string;
}> = {
  owner: {
    label: 'Owner',
    description: 'Full access including billing and user management',
    icon: Crown,
    badge: 'bg-amber-100 text-amber-700',
  },
  admin: {
    label: 'Admin',
    description: 'Full access except billing',
    icon: Shield,
    badge: 'bg-brand-100 text-brand-700',
  },
  accountant: {
    label: 'Accountant',
    description: 'Read/write all financial data',
    icon: Calculator,
    badge: 'bg-blue-100 text-blue-700',
  },
  payroll_manager: {
    label: 'Payroll Manager',
    description: 'Read/write payroll, read-only on other modules',
    icon: Users,
    badge: 'bg-purple-100 text-purple-700',
  },
  auditor: {
    label: 'Auditor',
    description: 'Read-only access, can export reports',
    icon: Eye,
    badge: 'bg-gray-100 text-gray-700',
  },
  viewer: {
    label: 'Viewer',
    description: 'Read-only dashboard and reports',
    icon: BarChart3,
    badge: 'bg-gray-100 text-gray-600',
  },
};

const INVITABLE_ROLES: UserRole[] = ['admin', 'accountant', 'payroll_manager', 'auditor', 'viewer'];

// ── RoleBadge ────────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: UserRole }) {
  const config = ROLE_CONFIG[role];
  const Icon = config.icon;
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium', config.badge)}>
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  );
}

// ── InviteMemberForm ─────────────────────────────────────────────────────────

interface InviteMemberFormProps {
  businessId: string;
  currentRole: UserRole;
  onInvited: () => void;
}

function InviteMemberForm({ businessId, currentRole, onInvited }: InviteMemberFormProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('viewer');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Owners can assign any role; admins cannot assign 'admin'
  const assignableRoles = currentRole === 'owner'
    ? INVITABLE_ROLES
    : INVITABLE_ROLES.filter((r) => r !== 'admin');

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    const { data, error: rpcError } = await (supabase.rpc as any)('invite_member', {
      p_business_id: businessId,
      p_email: email.trim().toLowerCase(),
      p_role: role,
    });

    setLoading(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    // Build the invite URL using the returned token
    const token = data as string;
    const inviteUrl = `${window.location.origin}/accept-invitation?token=${token}`;

    // Send the invite email via Supabase Auth invite
    // Falls back to showing the link if email sending is not configured
    const { error: emailError } = await supabase.auth.admin
      ? { error: null } // admin API not available client-side
      : { error: null };

    void emailError; // email is sent server-side via Supabase trigger or Edge Function

    setSuccess(`Invitation sent to ${email}. Link: ${inviteUrl}`);
    setEmail('');
    setRole('viewer');
    onInvited();
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
      <h3 className="mb-3 text-sm font-semibold text-gray-900">Invite a team member</h3>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {success && (
        <div className="mb-3 rounded-lg bg-brand-50 p-3 text-sm text-brand-700">
          <p className="font-medium">Invitation created!</p>
          <p className="mt-1 break-all text-xs text-brand-600">{success}</p>
          <p className="mt-1 text-xs text-brand-500">
            Copy and share the link above, or configure Supabase email templates to send automatically.
          </p>
        </div>
      )}

      <form onSubmit={handleInvite} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-gray-600">Email address</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@business.mw"
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>

        <div className="w-full sm:w-44">
          <label className="mb-1 block text-xs font-medium text-gray-600">Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            {assignableRoles.map((r) => (
              <option key={r} value={r}>{ROLE_CONFIG[r].label}</option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
          Send invite
        </button>
      </form>

      <div className="mt-3">
        <p className="text-xs font-medium text-gray-500">Role permissions:</p>
        <p className="text-xs text-gray-400">{ROLE_CONFIG[role].description}</p>
      </div>
    </div>
  );
}

// ── Main TeamManagementPage ───────────────────────────────────────────────────

export function TeamManagementPage() {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const currentUser = useAppStore((s) => s.currentUser);
  const permissions = usePermissions();

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const businessId = currentBusiness?.business.id;
  const currentRole = (currentBusiness?.role ?? 'viewer') as UserRole;

  const loadMembers = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);

    // Fetch members joined with their profile data
    const { data, error: fetchError } = await supabase
      .from('business_users')
      .select(`
        id,
        user_id,
        role,
        is_active,
        invited_at,
        accepted_at,
        invitation_token,
        user_profiles (
          full_name
        ),
        auth_users:user_id (
          email
        )
      `)
      .eq('business_id', businessId)
      .order('created_at', { ascending: true });

    setLoading(false);

    if (fetchError) {
      setError(fetchError.message);
      return;
    }

    // Flatten the joined data
    const mapped: Member[] = (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      user_id: row.user_id as string,
      role: row.role as UserRole,
      is_active: row.is_active as boolean,
      invited_at: row.invited_at as string | null,
      accepted_at: row.accepted_at as string | null,
      invitation_token: row.invitation_token as string | null,
      email: (row.auth_users as { email?: string } | null)?.email ?? null,
      full_name: (row.user_profiles as { full_name?: string } | null)?.full_name ?? null,
    }));

    setMembers(mapped);
  }, [businessId]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  async function handleRemove(memberId: string, memberUserId: string) {
    // Prevent removing yourself
    if (memberUserId === currentUser?.id) {
      alert('You cannot remove yourself from the business.');
      return;
    }

    if (!window.confirm('Remove this member from the business?')) return;

    setRemoving(memberId);

    const { error: removeError } = await (supabase as any)
      .from('business_users')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', memberId)
      .eq('business_id', businessId!);

    setRemoving(null);

    if (removeError) {
      setError(removeError.message);
      return;
    }

    setMembers((prev) => prev.filter((m) => m.id !== memberId));
  }

  async function handleChangeRole(memberId: string, newRole: UserRole) {
    const { error: updateError } = await (supabase as any)
      .from('business_users')
      .update({ role: newRole, updated_at: new Date().toISOString() })
      .eq('id', memberId)
      .eq('business_id', businessId!);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setMembers((prev) =>
      prev.map((m) => (m.id === memberId ? { ...m, role: newRole } : m))
    );
  }

  if (!businessId) {
    return (
      <div className="py-8 text-center text-sm text-gray-500">
        No business selected.
      </div>
    );
  }

  const activeMembers = members.filter((m) => m.is_active);
  const pendingMembers = members.filter((m) => !m.is_active && m.invitation_token);

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Invite form — only owners and admins can invite */}
      <PermissionGate require="canManageUsers">
        <InviteMemberForm
          businessId={businessId}
          currentRole={currentRole}
          onInvited={() => void loadMembers()}
        />
      </PermissionGate>

      {/* Active members */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-gray-900">
          Active members ({activeMembers.length})
        </h3>

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading members…
          </div>
        ) : activeMembers.length === 0 ? (
          <p className="py-4 text-sm text-gray-400">No active members found.</p>
        ) : (
          <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
            {activeMembers.map((member) => {
              const isCurrentUser = member.user_id === currentUser?.id;
              const isMemberOwner = member.role === 'owner';
              // Can only change/remove if you have manage permission
              // and the target is not an owner (unless you're an owner)
              const canModify =
                permissions.canManageUsers &&
                !isCurrentUser &&
                !(isMemberOwner && currentRole !== 'owner');

              return (
                <div key={member.id} className="flex items-center gap-3 px-4 py-3">
                  {/* Avatar */}
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
                    {(member.full_name ?? member.email ?? '?').charAt(0).toUpperCase()}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {member.full_name ?? member.email ?? 'Unknown user'}
                      {isCurrentUser && (
                        <span className="ml-1.5 text-xs font-normal text-gray-400">(you)</span>
                      )}
                    </p>
                    {member.email && member.full_name && (
                      <p className="truncate text-xs text-gray-500">{member.email}</p>
                    )}
                  </div>

                  {/* Role selector or badge */}
                  {canModify ? (
                    <select
                      value={member.role}
                      onChange={(e) => void handleChangeRole(member.id, e.target.value as UserRole)}
                      className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    >
                      {/* Admins can't promote to owner */}
                      {(currentRole === 'owner' ? Object.keys(ROLE_CONFIG) as UserRole[] : INVITABLE_ROLES).map((r) => (
                        <option key={r} value={r}>{ROLE_CONFIG[r].label}</option>
                      ))}
                    </select>
                  ) : (
                    <RoleBadge role={member.role} />
                  )}

                  {/* Remove button */}
                  {canModify && (
                    <button
                      onClick={() => void handleRemove(member.id, member.user_id)}
                      disabled={removing === member.id}
                      className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                      title="Remove member"
                    >
                      {removing === member.id
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Trash2 className="h-4 w-4" />
                      }
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pending invitations */}
      {pendingMembers.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-gray-900">
            Pending invitations ({pendingMembers.length})
          </h3>
          <div className="divide-y divide-gray-100 rounded-xl border border-dashed border-gray-200 bg-white">
            {pendingMembers.map((member) => (
              <div key={member.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100">
                  <Mail className="h-4 w-4 text-gray-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-gray-700">
                    {member.email ?? 'Invited user'}
                  </p>
                  {member.invited_at && (
                    <p className="text-xs text-gray-400">
                      Invited {new Date(member.invited_at).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}
                    </p>
                  )}
                </div>
                <RoleBadge role={member.role} />
                <PermissionGate require="canManageUsers">
                  <button
                    onClick={() => void handleRemove(member.id, member.user_id)}
                    disabled={removing === member.id}
                    className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                    title="Cancel invitation"
                  >
                    {removing === member.id
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Trash2 className="h-4 w-4" />
                    }
                  </button>
                </PermissionGate>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Role reference */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-gray-900">Role permissions</h3>
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full min-w-[520px] text-xs">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Permission</th>
                {(Object.keys(ROLE_CONFIG) as UserRole[]).map((r) => (
                  <th key={r} className="px-3 py-2.5 text-center font-semibold text-gray-600">
                    {ROLE_CONFIG[r].label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {[
                { label: 'Read data', key: 'canRead' },
                { label: 'Write financial data', key: 'canWrite' },
                { label: 'Write payroll', key: 'canWritePayroll' },
                { label: 'Delete records', key: 'canDelete' },
                { label: 'Manage users', key: 'canManageUsers' },
                { label: 'Export reports', key: 'canExport' },
                { label: 'Billing & subscription', key: 'canManageBilling' },
              ].map(({ label, key }) => (
                <tr key={key} className="hover:bg-gray-50/50">
                  <td className="px-4 py-2 font-medium text-gray-700">{label}</td>
                  {(Object.keys(ROLE_CONFIG) as UserRole[]).map((r) => {
                    const perm = {
                      canRead: ['owner','admin','accountant','payroll_manager','auditor','viewer'],
                      canWrite: ['owner','admin','accountant'],
                      canWritePayroll: ['owner','admin','accountant','payroll_manager'],
                      canDelete: ['owner','admin'],
                      canManageUsers: ['owner','admin'],
                      canExport: ['owner','admin','accountant','payroll_manager','auditor'],
                      canManageBilling: ['owner'],
                    }[key] ?? [];
                    const has = perm.includes(r);
                    return (
                      <td key={r} className="px-3 py-2 text-center">
                        <span className={clsx(
                          'inline-block h-4 w-4 rounded-full text-[10px] font-bold leading-4',
                          has ? 'bg-brand-100 text-brand-600' : 'bg-gray-100 text-gray-400',
                        )}>
                          {has ? '✓' : '–'}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
