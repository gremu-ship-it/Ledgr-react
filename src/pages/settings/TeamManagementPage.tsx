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
    badge: 'bg-warning/12 text-warning',
  },
  admin: {
    label: 'Admin',
    description: 'Full access except billing',
    icon: Shield,
    badge: 'bg-brand-500/10 text-brand-700 dark:text-brand-300',
  },
  accountant: {
    label: 'Accountant',
    description: 'Read/write all financial data',
    icon: Calculator,
    badge: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  },
  payroll_manager: {
    label: 'Payroll Manager',
    description: 'Read/write payroll, read-only on other modules',
    icon: Users,
    badge: 'bg-accent/12 text-accent dark:text-accent-light',
  },
  auditor: {
    label: 'Auditor',
    description: 'Read-only access, can export reports',
    icon: Eye,
    badge: 'bg-surface text-sub',
  },
  viewer: {
    label: 'Viewer',
    description: 'Read-only dashboard and reports',
    icon: BarChart3,
    badge: 'bg-surface text-sub',
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

    // NEW FLOW: Server-side Edge Function — user must already be registered at /register
    try {
      const { data, error: fnError } = await supabase.functions.invoke('invite-team-member', {
        body: {
          business_id: businessId,
          email: email.trim().toLowerCase(),
          role,
        },
      });

      if (fnError) {
        // If Edge Function deployment is missing or errors, fallback to legacy RPC for backwards compat
        const legacyMsg = (data as any)?.message || (data as any)?.error || fnError.message;
        // If it's USER_NOT_FOUND we should show clear guidance instead of trying legacy RPC
        if (legacyMsg.toLowerCase().includes('no account found') || legacyMsg.toLowerCase().includes('user not found')) {
          throw new Error(legacyMsg);
        }

        // Attempt legacy RPC as fallback (token-based)
        try {
          const { data: rpcData, error: rpcError } = await (supabase.rpc as any)('invite_member', {
            p_business_id: businessId,
            p_email: email.trim().toLowerCase(),
            p_role: role,
          });
          if (rpcError) throw new Error(rpcError.message);
          const token = rpcData as string;
          const inviteUrl = `${window.location.origin}/accept-invitation?token=${token}`;
          setSuccess(`Invitation created (legacy token flow). Link: ${inviteUrl} – Ask user to register at /register first if needed.`);
          setEmail('');
          setRole('viewer');
          onInvited();
          return;
        } catch {
          // If fallback also fails, surface original Edge Function message
          throw new Error(legacyMsg);
        }
      }

      if ((data as any)?.error) {
        throw new Error((data as any).message || (data as any).error);
      }

      setSuccess((data as any)?.message || `Added ${email} as ${role} successfully.`);
      setEmail('');
      setRole('viewer');
      onInvited();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-bg p-4">
      <h3 className="mb-3 text-sm font-semibold text-ink">Add a team member</h3>
      <div className="mb-3 rounded-lg bg-card border border-line p-3">
        <p className="text-xs font-medium text-sub">How it works (server-side):</p>
        <ol className="mt-1 list-decimal pl-4 text-xs text-sub space-y-0.5">
          <li>Person registers at <span className="font-medium">{window.location.origin}/register</span></li>
          <li>You enter their email + role below and click Add member</li>
          <li>They get instant access – no invitation link needed</li>
        </ol>
        <p className="mt-2 text-[11px] text-muted">Uses Edge Function <code className="bg-bg px-1 rounded">invite-team-member</code>.</p>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-danger/10 p-3 text-sm text-danger">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}

      {success && (
        <div className="mb-3 rounded-lg bg-brand-500/10 p-3 text-sm text-brand-700 dark:text-brand-300">
          <p className="font-medium">Success!</p>
          <p className="mt-1 break-all text-xs text-brand-600 dark:text-brand-300">{success}</p>
        </div>
      )}

      <form onSubmit={handleInvite} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-sub">Email address</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@business.mw"
            className="block w-full rounded-lg border border-line px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>

        <div className="w-full sm:w-44">
          <label className="mb-1 block text-xs font-medium text-sub">Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            className="block w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            {assignableRoles.map((r) => (
              <option key={r} value={r}>{ROLE_CONFIG[r].label}</option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
          Add member
        </button>
      </form>

      <div className="mt-3">
        <p className="text-xs font-medium text-muted">Role permissions:</p>
        <p className="text-xs text-muted">{ROLE_CONFIG[role].description}</p>
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

    // Try enriched server-side list first (includes email via Auth Admin API)
    try {
      const { data, error } = await supabase.functions.invoke('list-team-members', {
        body: { business_id: businessId },
      });
      if (!error && data && !(data as any).error && (data as any).members) {
        const enriched = (data as any).members as Array<{
          id: string;
          user_id: string;
          role: UserRole;
          is_active: boolean;
          invited_at: string | null;
          accepted_at: string | null;
          email: string | null;
          full_name: string | null;
        }>;
        setMembers(
          enriched.map((m) => ({
            id: m.id,
            user_id: m.user_id,
            role: m.role,
            is_active: m.is_active,
            invited_at: m.invited_at,
            accepted_at: m.accepted_at,
            invitation_token: null,
            email: m.email,
            full_name: m.full_name,
          })),
        );
        setLoading(false);
        return;
      }
    } catch {
      // fall through to client query
    }

    // Fallback: client-side query (may not have email if auth_users view unavailable)
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
        )
      `)
      .eq('business_id', businessId)
      .order('created_at', { ascending: true });

    setLoading(false);

    if (fetchError) {
      setError(fetchError.message);
      return;
    }

    const mapped: Member[] = (data ?? []).map((row: any) => ({
      id: row.id as string,
      user_id: row.user_id as string,
      role: row.role as UserRole,
      is_active: row.is_active as boolean,
      invited_at: row.invited_at as string | null,
      accepted_at: row.accepted_at as string | null,
      invitation_token: row.invitation_token as string | null,
      email: null,
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
      <div className="py-8 text-center text-sm text-muted">
        No business selected.
      </div>
    );
  }

  const activeMembers = members.filter((m) => m.is_active);
  const pendingMembers = members.filter((m) => !m.is_active && m.invitation_token);

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-danger/10 p-3 text-sm text-danger">
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
        <h3 className="mb-3 text-sm font-semibold text-ink">
          Active members ({activeMembers.length})
        </h3>

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading members…
          </div>
        ) : activeMembers.length === 0 ? (
          <p className="py-4 text-sm text-muted">No active members found.</p>
        ) : (
          <div className="divide-y divide-line rounded-xl border border-line bg-card">
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
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-500/10 text-sm font-semibold text-brand-700 dark:text-brand-300">
                    {(member.full_name ?? member.email ?? '?').charAt(0).toUpperCase()}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">
                      {member.full_name ?? member.email ?? 'Unknown user'}
                      {isCurrentUser && (
                        <span className="ml-1.5 text-xs font-normal text-muted">(you)</span>
                      )}
                    </p>
                    {member.email && member.full_name && (
                      <p className="truncate text-xs text-muted">{member.email}</p>
                    )}
                  </div>

                  {/* Role selector or badge */}
                  {canModify ? (
                    <select
                      value={member.role}
                      onChange={(e) => void handleChangeRole(member.id, e.target.value as UserRole)}
                      className="rounded-lg border border-line bg-card px-2 py-1 text-xs font-medium text-sub focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
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
                      className="shrink-0 rounded-lg p-1.5 text-muted transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-50"
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
          <h3 className="mb-3 text-sm font-semibold text-ink">
            Pending invitations ({pendingMembers.length})
          </h3>
          <div className="divide-y divide-line rounded-xl border border-dashed border-line bg-card">
            {pendingMembers.map((member) => (
              <div key={member.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface">
                  <Mail className="h-4 w-4 text-muted" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-sub">
                    {member.email ?? 'Invited user'}
                  </p>
                  {member.invited_at && (
                    <p className="text-xs text-muted">
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
                    className="shrink-0 rounded-lg p-1.5 text-muted transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-50"
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
        <h3 className="mb-3 text-sm font-semibold text-ink">Role permissions</h3>
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[520px] text-xs">
            <thead>
              <tr className="border-b border-line bg-bg">
                <th className="px-4 py-2.5 text-left font-semibold text-sub">Permission</th>
                {(Object.keys(ROLE_CONFIG) as UserRole[]).map((r) => (
                  <th key={r} className="px-3 py-2.5 text-center font-semibold text-sub">
                    {ROLE_CONFIG[r].label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {[
                { label: 'Read data', key: 'canRead' },
                { label: 'Write financial data', key: 'canWrite' },
                { label: 'Write payroll', key: 'canWritePayroll' },
                { label: 'Delete records', key: 'canDelete' },
                { label: 'Manage users', key: 'canManageUsers' },
                { label: 'Export reports', key: 'canExport' },
                { label: 'Billing & subscription', key: 'canManageBilling' },
              ].map(({ label, key }) => (
                <tr key={key} className="hover:bg-bg/50">
                  <td className="px-4 py-2 font-medium text-sub">{label}</td>
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
                          has ? 'bg-brand-500/10 text-brand-600 dark:text-brand-300' : 'bg-surface text-muted',
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
