import { useState, useEffect, useCallback } from 'react';
import {
  UserPlus, Trash2, Loader2, AlertCircle,
  Crown, Shield, Calculator, Users, Eye, BarChart3, Mail,
  Link, Copy, ExternalLink, Plus
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';
import { usePermissions } from '@/hooks/usePermissions';
import { PermissionGate } from '@/components/rbac/PermissionGate';
import { clsx } from 'clsx';

// ── Types ────────────────────────────────────────────────────────────────────

type UserRole =
  | 'owner'
  | 'admin'
  | 'accountant'
  | 'payroll_manager'
  | 'supervisor'
  | 'data_entry'
  | 'inventory_manager'
  | 'sales_clerk'
  | 'auditor'
  | 'viewer';

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

interface InvitationLink {
  id: string;
  business_id: string;
  email: string | null;
  role: UserRole;
  token: string;
  invited_by: string | null;
  invited_at: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
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
  supervisor: {
    label: 'Supervisor',
    description: 'Read/write financial data and write payroll',
    icon: Shield,
    badge: 'bg-indigo-100 text-indigo-700',
  },
  data_entry: {
    label: 'Data Entry',
    description: 'Read/write financial data, cannot write payroll or export',
    icon: Calculator,
    badge: 'bg-teal-100 text-teal-700',
  },
  inventory_manager: {
    label: 'Inventory Manager',
    description: 'Read/write stock and financial records, can export',
    icon: Eye,
    badge: 'bg-sky-100 text-sky-700',
  },
  sales_clerk: {
    label: 'Sales Clerk',
    description: 'Read/write sales and expenses',
    icon: Calculator,
    badge: 'bg-green-100 text-green-700',
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

const INVITABLE_ROLES: UserRole[] = [
  'admin',
  'accountant',
  'payroll_manager',
  'supervisor',
  'data_entry',
  'inventory_manager',
  'sales_clerk',
  'auditor',
  'viewer',
];

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
  const [activeTab, setActiveTab] = useState<'direct' | 'link'>('direct');
  
  // Direct Add state
  const [directEmail, setDirectEmail] = useState('');
  const [directRole, setDirectRole] = useState<UserRole>('viewer');
  
  // Invite Link state
  const [linkRole, setLinkRole] = useState<UserRole>('viewer');
  const [linkEmailRestriction, setLinkEmailRestriction] = useState('');
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Owners can assign any role; admins cannot assign 'admin'
  const assignableRoles = currentRole === 'owner'
    ? INVITABLE_ROLES
    : INVITABLE_ROLES.filter((r) => r !== 'admin');

  async function handleDirectInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('invite-team-member', {
        body: {
          business_id: businessId,
          email: directEmail.trim().toLowerCase(),
          role: directRole,
        },
      });

      if (fnError) {
        const legacyMsg = (data as any)?.message || (data as any)?.error || fnError.message;
        if (legacyMsg.toLowerCase().includes('no account found') || legacyMsg.toLowerCase().includes('user not found')) {
          throw new Error(legacyMsg);
        }

        // Attempt legacy RPC as fallback (token-based)
        try {
          const { data: rpcData, error: rpcError } = await (supabase.rpc as any)('invite_member', {
            p_business_id: businessId,
            p_email: directEmail.trim().toLowerCase(),
            p_role: directRole,
          });
          if (rpcError) throw new Error(rpcError.message);
          const token = rpcData as string;
          const inviteUrl = `${window.location.origin}/accept-invitation?token=${token}`;
          setSuccess(`Invitation created (legacy token flow). Link: ${inviteUrl} – Ask user to register at /register first if needed.`);
          setDirectEmail('');
          setDirectRole('viewer');
          onInvited();
          return;
        } catch {
          throw new Error(legacyMsg);
        }
      }

      if ((data as any)?.error) {
        throw new Error((data as any).message || (data as any).error);
      }

      setSuccess((data as any)?.message || `Added ${directEmail} as ${directRole} successfully.`);
      setDirectEmail('');
      setDirectRole('viewer');
      onInvited();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateInviteLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setGeneratedLink(null);
    setLoading(true);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('create-invite-link', {
        body: {
          business_id: businessId,
          role: linkRole,
          email: linkEmailRestriction.trim() || undefined,
          origin: window.location.origin,
        },
      });

      if (fnError) {
        throw new Error(fnError.message);
      }
      if (data?.error) {
        throw new Error(data.message || data.error);
      }

      setGeneratedLink(data.invite_url);
      setSuccess(`Invite link created for ${ROLE_CONFIG[linkRole].label}!`);
      onInvited();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function handleCopy() {
    if (!generatedLink) return;
    navigator.clipboard.writeText(generatedLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
      <div className="flex border-b border-gray-200 mb-4">
        <button
          type="button"
          onClick={() => { setActiveTab('direct'); setError(null); setSuccess(null); setGeneratedLink(null); }}
          className={clsx(
            'px-4 py-2 text-xs font-semibold -mb-px border-b-2 transition-all',
            activeTab === 'direct'
              ? 'border-brand-500 text-brand-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          )}
        >
          Direct Add (Existing User)
        </button>
        <button
          type="button"
          onClick={() => { setActiveTab('link'); setError(null); setSuccess(null); setGeneratedLink(null); }}
          className={clsx(
            'px-4 py-2 text-xs font-semibold -mb-px border-b-2 transition-all',
            activeTab === 'link'
              ? 'border-brand-500 text-brand-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          )}
        >
          Shareable Invite Link
        </button>
      </div>

      {activeTab === 'direct' ? (
        <div>
          <div className="mb-3 rounded-lg bg-white border border-gray-100 p-3">
            <p className="text-xs font-medium text-gray-700">How it works (server-side):</p>
            <ol className="mt-1 list-decimal pl-4 text-xs text-gray-600 space-y-0.5">
              <li>Person registers at <span className="font-medium">{window.location.origin}/register</span></li>
              <li>You enter their email + role below and click Add member</li>
              <li>They get instant access – no invitation link needed</li>
            </ol>
            <p className="mt-2 text-[11px] text-gray-400">Uses Edge Function <code className="bg-gray-50 px-1 rounded">invite-team-member</code>.</p>
          </div>

          {error && (
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="break-words">{error}</span>
            </div>
          )}

          {success && (
            <div className="mb-3 rounded-lg bg-brand-50 p-3 text-sm text-brand-700">
              <p className="font-medium">Success!</p>
              <p className="mt-1 break-all text-xs text-brand-600">{success}</p>
            </div>
          )}

          <form onSubmit={handleDirectInvite} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-gray-600">Email address</label>
              <input
                type="email"
                required
                value={directEmail}
                onChange={(e) => setDirectEmail(e.target.value)}
                placeholder="colleague@business.mw"
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>

            <div className="w-full sm:w-44">
              <label className="mb-1 block text-xs font-medium text-gray-600">Role</label>
              <select
                value={directRole}
                onChange={(e) => setDirectRole(e.target.value as UserRole)}
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
              Add member
            </button>
          </form>
          <div className="mt-3">
            <p className="text-xs font-medium text-gray-500">Role permissions:</p>
            <p className="text-xs text-gray-400">{ROLE_CONFIG[directRole].description}</p>
          </div>
        </div>
      ) : (
        <div>
          <div className="mb-3 rounded-lg bg-white border border-gray-100 p-3">
            <p className="text-xs font-medium text-gray-700">How it works (shareable links):</p>
            <ol className="mt-1 list-decimal pl-4 text-xs text-gray-600 space-y-0.5">
              <li>Select a role and optionally restrict the link to a specific email address.</li>
              <li>Click Generate Link – a unique, secure invitation token is registered in the database.</li>
              <li>Copy and send the URL. The recipient can click, sign in/register, and join.</li>
            </ol>
            <p className="mt-2 text-[11px] text-gray-400">Uses Edge Function <code className="bg-gray-50 px-1 rounded">create-invite-link</code>. Explicitly restricted to this business only.</p>
          </div>

          {error && (
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="break-words">{error}</span>
            </div>
          )}

          {success && (
            <div className="mb-3 rounded-lg bg-brand-50 p-3 text-sm text-brand-700">
              <p className="font-medium">{success}</p>
            </div>
          )}

          {generatedLink && (
            <div className="mb-4 rounded-lg border border-brand-200 bg-white p-3">
              <label className="block text-xs font-medium text-brand-800 mb-1">Invitation Link (Expires in 7 days):</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={generatedLink}
                  className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 select-all"
                />
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1 rounded-lg bg-brand-500 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-600"
                >
                  <Copy className="h-3 w-3" />
                  {copied ? 'Copied!' : 'Copy'}
                </button>
                <a
                  href={generatedLink}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center rounded-lg border border-gray-200 px-3 py-2 hover:bg-gray-50"
                >
                  <ExternalLink className="h-3 w-3 text-gray-600" />
                </a>
              </div>
            </div>
          )}

          <form onSubmit={handleCreateInviteLink} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-gray-600">Restrict to email (Optional)</label>
              <input
                type="email"
                value={linkEmailRestriction}
                onChange={(e) => setLinkEmailRestriction(e.target.value)}
                placeholder="Only this email can accept (Optional)"
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>

            <div className="w-full sm:w-44">
              <label className="mb-1 block text-xs font-medium text-gray-600">Role</label>
              <select
                value={linkRole}
                onChange={(e) => setLinkRole(e.target.value as UserRole)}
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
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Generate Link
            </button>
          </form>
          <div className="mt-3">
            <p className="text-xs font-medium text-gray-500">Role permissions:</p>
            <p className="text-xs text-gray-400">{ROLE_CONFIG[linkRole].description}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main TeamManagementPage ───────────────────────────────────────────────────

export function TeamManagementPage() {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const currentUser = useAppStore((s) => s.currentUser);
  const permissions = usePermissions();

  const [members, setMembers] = useState<Member[]>([]);
  const [activeLinks, setActiveLinks] = useState<InvitationLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const businessId = currentBusiness?.business.id;
  const currentRole = (currentBusiness?.role ?? 'viewer') as UserRole;

  const loadMembersAndInvites = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);

    // 1. Fetch active members
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
      } else {
        // Fallback Client-side query
        const { data: directMembers, error: fetchError } = await supabase
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

        if (fetchError) throw fetchError;

        const mapped: Member[] = (directMembers ?? []).map((row: any) => ({
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
      }
    } catch (err: any) {
      setError(err.message || 'Error loading team members');
    }

    // 2. Fetch active shareable invite links from business_invitations
    try {
      const { data: invitesData, error: invitesError } = await (supabase as any)
        .from('business_invitations')
        .select('*')
        .is('accepted_at', null)
        .gt('expires_at', new Date().toISOString())
        .eq('business_id', businessId);

      if (invitesError) throw invitesError;
      setActiveLinks((invitesData || []) as any as InvitationLink[]);
    } catch (err: any) {
      console.error('Error loading invite links:', err);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    void loadMembersAndInvites();
  }, [loadMembersAndInvites]);

  async function handleRemove(memberId: string, memberUserId: string) {
    if (memberUserId === currentUser?.id) {
      alert('You cannot remove yourself from the business.');
      return;
    }

    if (!window.confirm('Remove this member from the business?')) return;

    setRemoving(memberId);

    const { error: removeError } = await supabase
      .from('business_users')
      .update({ is_active: false, updated_at: new Date().toISOString() } as any)
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
    const { error: updateError } = await supabase
      .from('business_users')
      .update({ role: newRole, updated_at: new Date().toISOString() } as any)
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

  async function handleRevokeInviteLink(inviteId: string) {
    if (!window.confirm('Are you sure you want to revoke this invitation link? It will immediately stop working.')) return;
    setRevoking(inviteId);

    const { error: revokeError } = await (supabase as any)
      .from('business_invitations')
      .delete()
      .eq('id', inviteId);

    setRevoking(null);

    if (revokeError) {
      setError(revokeError.message);
      return;
    }

    setActiveLinks((prev) => prev.filter((lnk) => lnk.id !== inviteId));
  }

  function copyInviteLink(token: string) {
    const link = `${window.location.origin}/accept-invitation?token=${token}`;
    navigator.clipboard.writeText(link);
    alert('Invitation link copied!');
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
          onInvited={() => void loadMembersAndInvites()}
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
            Loading members and invites…
          </div>
        ) : activeMembers.length === 0 ? (
          <p className="py-4 text-sm text-gray-400">No active members found.</p>
        ) : (
          <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
            {activeMembers.map((member) => {
              const isCurrentUser = member.user_id === currentUser?.id;
              const isMemberOwner = member.role === 'owner';
              const canModify =
                permissions.canManageUsers &&
                !isCurrentUser &&
                !(isMemberOwner && currentRole !== 'owner');

              return (
                <div key={member.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
                    {(member.full_name ?? member.email ?? '?').charAt(0).toUpperCase()}
                  </div>

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

                  {canModify ? (
                    <select
                      value={member.role}
                      onChange={(e) => void handleChangeRole(member.id, e.target.value as UserRole)}
                      className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    >
                      {(currentRole === 'owner' ? Object.keys(ROLE_CONFIG) as UserRole[] : INVITABLE_ROLES).map((r) => (
                        <option key={r} value={r}>{ROLE_CONFIG[r].label}</option>
                      ))}
                    </select>
                  ) : (
                    <RoleBadge role={member.role} />
                  )}

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

      {/* Active shareable invite links */}
      {!loading && activeLinks.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-gray-900">
            Active shareable invitation links ({activeLinks.length})
          </h3>
          <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
            {activeLinks.map((lnk) => (
              <div key={lnk.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50">
                  <Link className="h-4 w-4 text-brand-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900">
                    {lnk.email ? `Restricted to: ${lnk.email}` : 'Anyone with the link can accept'}
                  </p>
                  <p className="text-xs text-gray-400">
                    Expires {new Date(lnk.expires_at).toLocaleDateString('en-GB', {
                      day: 'numeric', month: 'short', year: 'numeric',
                    })}
                  </p>
                </div>
                <RoleBadge role={lnk.role} />
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => copyInviteLink(lnk.token)}
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                    title="Copy Link"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                  <PermissionGate require="canManageUsers">
                    <button
                      onClick={() => void handleRevokeInviteLink(lnk.id)}
                      disabled={revoking === lnk.id}
                      className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                      title="Revoke Invitation"
                    >
                      {revoking === lnk.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  </PermissionGate>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Legacy/Direct Pending invitations */}
      {pendingMembers.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-gray-900">
            Direct pending invitations ({pendingMembers.length})
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
                      canRead: ['owner','admin','accountant','payroll_manager','supervisor','data_entry','inventory_manager','sales_clerk','auditor','viewer'],
                      canWrite: ['owner','admin','accountant','supervisor','data_entry','inventory_manager','sales_clerk'],
                      canWritePayroll: ['owner','admin','accountant','payroll_manager','supervisor'],
                      canDelete: ['owner','admin'],
                      canManageUsers: ['owner','admin'],
                      canExport: ['owner','admin','accountant','payroll_manager','supervisor','inventory_manager','auditor'],
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
