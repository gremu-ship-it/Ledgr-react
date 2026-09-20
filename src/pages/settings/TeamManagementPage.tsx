import { useState, useEffect, useCallback, useRef } from 'react';
import {
  UserPlus, Trash2, Loader2, AlertCircle,
  Crown, Shield, Calculator, Users, Eye, BarChart3, Mail,
  Link, Copy, ExternalLink, Plus, Clock, UserX, ShoppingBag, Package,
  Smartphone, KeyRound, MessageCircle
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { invokeFunction } from '@/lib/edgeFunctionErrors';
import { useAppStore } from '@/store/useAppStore';
import { usePermissions } from '@/hooks/usePermissions';
import { PermissionGate } from '@/components/rbac/PermissionGate';
import { clsx } from 'clsx';
import { createLogger } from '@/lib/logger';
import { handleError } from '@/lib/errorHandler';
import {
  formatPhoneForDisplay,
  normalizePhone,
  smsShareLink,
  whatsappShareLink,
} from '@/lib/phone';

const log = createLogger('TeamManagementPage');

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
  | 'viewer'
  | 'purchasing_officer'
  | 'warehouse_worker'
  | 'sales_manager'
  | 'customer_service_rep'
  | 'tax_compliance_officer'
  | 'treasury_manager'
  | 'asset_manager'
  | 'board_member'
  | 'branch_manager'
  // POS roles (user_role enum values added by 20260920000000_pos_module.sql)
  | 'manager'
  | 'cashier'
  | 'stock_clerk';

interface Member {
  id: string;
  user_id: string;
  role: UserRole;
  is_active: boolean;
  invited_at: string | null;
  accepted_at: string | null;
  invitation_token: string | null;
  invitation_expires_at: string | null;
  email: string | null;
  /** E.164 number for a member added by phone; their identity when there is no email. */
  phone: string | null;
  full_name: string | null;
}

/** What invite-team-member answers with on success. */
interface InviteResult {
  success?: boolean;
  code?: string;
  message?: string;
  member?: {
    user_id?: string;
    email?: string | null;
    phone?: string | null;
    role?: string;
    full_name?: string | null;
  };
  /** One-time credentials for a phone account. Returned once, never again. */
  login?: { phone?: string | null; temporary_password?: string };
}

/** True when a pending invitation's role/access window has passed. */
function isInvitationExpired(member: Member): boolean {
  if (!member.invitation_expires_at) return false;
  const expires = new Date(member.invitation_expires_at).getTime();
  if (Number.isNaN(expires)) return false;
  return expires < Date.now();
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
    description: 'Read/write financial data',
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
    description: 'Restricted to items under inventory',
    icon: Eye,
    badge: 'bg-sky-100 text-sky-700',
  },
  sales_clerk: {
    label: 'Sales Clerk',
    description: 'Only view income, expenses, and invoices',
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
  purchasing_officer: {
    label: 'Purchasing Officer',
    description: 'Manages expenses, vendors, and inventory restocking',
    icon: Calculator,
    badge: 'bg-orange-100 text-orange-700',
  },
  warehouse_worker: {
    label: 'Warehouse Worker',
    description: 'Manages warehouse picking, packing, and stock transfers',
    icon: Eye,
    badge: 'bg-yellow-100 text-yellow-700',
  },
  sales_manager: {
    label: 'Sales Manager',
    description: 'Manages sales, invoices, customers, and sales reports',
    icon: Users,
    badge: 'bg-emerald-100 text-emerald-700',
  },
  customer_service_rep: {
    label: 'Customer Service Rep',
    description: 'Handles customer invoices and contacts view',
    icon: Users,
    badge: 'bg-cyan-100 text-cyan-700',
  },
  tax_compliance_officer: {
    label: 'Tax Compliance Officer',
    description: 'Manages tax returns, compliance, reports, and journals',
    icon: Shield,
    badge: 'bg-rose-100 text-rose-700',
  },
  treasury_manager: {
    label: 'Treasury Manager',
    description: 'Manages bank reconciliation, accounts, cash flow, and capital',
    icon: Calculator,
    badge: 'bg-violet-100 text-violet-700',
  },
  asset_manager: {
    label: 'Asset Manager',
    description: 'Manages fixed assets and capital equipment schedules',
    icon: Eye,
    badge: 'bg-stone-100 text-stone-700',
  },
  board_member: {
    label: 'Board Member / Investor',
    description: 'Read-only access to dashboard and high-level reports',
    icon: BarChart3,
    badge: 'bg-slate-100 text-slate-700',
  },
  branch_manager: {
    label: 'Branch Manager',
    description: 'Manages branch operations, income, expenses, inventory, and reports',
    icon: Shield,
    badge: 'bg-lime-100 text-lime-700',
  },
  // ── POS roles ──────────────────────────────────────────────────────────
  manager: {
    label: 'POS Manager',
    description: 'Runs the till, approves overrides, voids, refunds, and views POS reports',
    icon: Users,
    badge: 'bg-indigo-100 text-indigo-700',
  },
  cashier: {
    label: 'Cashier',
    description: 'Opens/closes shifts and records sales at the POS only',
    icon: ShoppingBag,
    badge: 'bg-green-100 text-green-700',
  },
  stock_clerk: {
    label: 'Stock Clerk',
    description: 'Receives, transfers, and adjusts stock — no sales access',
    icon: Package,
    badge: 'bg-yellow-100 text-yellow-700',
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
  'purchasing_officer',
  'warehouse_worker',
  'sales_manager',
  'customer_service_rep',
  'tax_compliance_officer',
  'treasury_manager',
  'asset_manager',
  'board_member',
  'branch_manager',
  'manager',
  'cashier',
  'stock_clerk',
];

// ── RoleBadge ────────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: UserRole }) {
  const config = ROLE_CONFIG[role] || { label: role, icon: Shield, badge: 'bg-gray-100 text-gray-700' };
  const Icon = config.icon;
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium', config.badge)}>
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  );
}

// ── One-time phone credentials ───────────────────────────────────────────────

/** A phone account's login, as returned once by invite-team-member. */
export interface PhoneCredentials {
  phone: string;
  password: string;
}

/**
 * The panel that hands a phone member's one-time password to the owner.
 *
 * Shared by the invite form (a new member) and the member list ("New password"
 * for someone who lost theirs): a phone account has no inbox, so this panel is
 * the only route the password ever travels, and both entry points must offer
 * the same Copy / WhatsApp / SMS hand-over.
 */
export function PhoneCredentialsPanel({ credentials }: { credentials: PhoneCredentials }) {
  const [copied, setCopied] = useState(false);
  const message =
    `Your Ledgr login\n` +
    `Phone: ${credentials.phone}\n` +
    `Password: ${credentials.password}\n` +
    `Sign in at ${window.location.origin}/login`;
  const waLink = whatsappShareLink(credentials.phone, message);
  const smsLink = smsShareLink(credentials.phone, message);

  return (
    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <div className="flex items-start gap-2">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900">
            One-time password for {formatPhoneForDisplay(credentials.phone)}
          </p>
          <p className="mt-0.5 text-xs text-amber-700">
            Shown once and never stored in a readable form — send it now. They can
            change it after signing in.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="select-all rounded bg-white px-2 py-1 font-mono text-sm text-gray-900 ring-1 ring-amber-200">
              {credentials.password}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(credentials.password);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100"
            >
              <Copy className="h-3.5 w-3.5" />
              {copied ? 'Copied' : 'Copy'}
            </button>
            {waLink && (
              <a
                href={waLink}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                Send on WhatsApp
              </a>
            )}
            {smsLink && (
              <a
                href={smsLink}
                className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100"
              >
                <Smartphone className="h-3.5 w-3.5" />
                Send by SMS
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
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
  const [directMode, setDirectMode] = useState<'email' | 'phone'>('email');
  const [directEmail, setDirectEmail] = useState('');
  const [directPhone, setDirectPhone] = useState('');
  const [directName, setDirectName] = useState('');
  const [directRole, setDirectRole] = useState<UserRole>('viewer');
  /** One-time credentials for a phone account, straight from the invite call. */
  const [phoneLogin, setPhoneLogin] = useState<PhoneCredentials | null>(null);
  
  // Invite Link state
  const [linkRole, setLinkRole] = useState<UserRole>('viewer');
  const [linkMode, setLinkMode] = useState<'email' | 'phone'>('email');
  const [linkEmailRestriction, setLinkEmailRestriction] = useState('');
  const [linkPhoneRestriction, setLinkPhoneRestriction] = useState('');
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
    setPhoneLogin(null);
    setLoading(true);

    // Normalise here so the member is stored in E.164 and the failure is
    // immediate, before a round trip that cannot succeed.
    const normalizedPhone = directMode === 'phone' ? normalizePhone(directPhone) : null;
    if (directMode === 'phone' && !normalizedPhone) {
      setError('Enter a valid phone number, e.g. 0991234567 or +265991234567.');
      setLoading(false);
      return;
    }

    try {
      // invokeFunction reads the Edge Function's own error body. The bare SDK
      // call hands back a constant "Edge Function returned a non-2xx status
      // code" and throws the reason away, which is why a phone invite used to
      // fail with a message nobody could act on.
      const { data: okData, failure } = await invokeFunction<InviteResult>('invite-team-member', {
        business_id: businessId,
        role: directRole,
        ...(directMode === 'phone'
          ? { phone: normalizedPhone, full_name: directName.trim() || undefined }
          : { email: directEmail.trim().toLowerCase() }),
      });

      if (failure) {
        const legacyMsg = failure.message;

        // The legacy RPC fallback only understands email. A phone invite is
        // provisioned entirely by the Edge Function, so there is nothing to
        // fall back to — surface the real error.
        if (directMode === 'phone') {
          throw new Error(legacyMsg);
        }

        if (legacyMsg.toLowerCase().includes('no account found') || legacyMsg.toLowerCase().includes('user not found')) {
          throw new Error(legacyMsg);
        }

        // Attempt legacy RPC as fallback (token-based)
        try {
          const { data: rpcData, error: rpcError } = await supabase.rpc('invite_member', {
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

      // A phone account comes back with one-time credentials. This is the only
      // time they are returned — there is no inbox to recover them through.
      if (okData?.login?.temporary_password && okData.login.phone) {
        setPhoneLogin({ phone: okData.login.phone, password: okData.login.temporary_password });
      }

      setSuccess(
        okData?.message ||
          `Added ${directMode === 'phone' ? formatPhoneForDisplay(normalizedPhone) : directEmail} as ${directRole} successfully.`,
      );
      setDirectEmail('');
      setDirectPhone('');
      setDirectName('');
      setDirectRole('viewer');
      onInvited();
    } catch (err) {
      handleError(err, { module: 'TeamManagementPage', operation: 'addDirectMember', notify: false });
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
      const { data, failure } = await invokeFunction<{ invite_url: string }>('create-invite-link', {
        business_id: businessId,
        role: linkRole,
        ...(linkMode === 'phone'
          ? { phone: normalizePhone(linkPhoneRestriction) || undefined }
          : { email: linkEmailRestriction.trim() || undefined }),
        origin: window.location.origin,
      });

      if (failure) {
        throw new Error(failure.message);
      }
      if (!data?.invite_url) {
        throw new Error('The invitation service did not return a link. Please try again.');
      }

      setGeneratedLink(data.invite_url);
      setSuccess(`Invite link created for ${ROLE_CONFIG[linkRole]?.label || linkRole}!`);
      onInvited();
    } catch (err) {
      handleError(err, { module: 'TeamManagementPage', operation: 'createInviteLink', notify: false });
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
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-gray-700">Add by</span>
              <div className="inline-flex rounded-lg border border-gray-200 p-0.5">
                {(['email', 'phone'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      setDirectMode(mode);
                      setError(null);
                      setSuccess(null);
                      setPhoneLogin(null);
                    }}
                    className={clsx(
                      'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors',
                      directMode === mode
                        ? 'bg-brand-500 text-white'
                        : 'text-gray-500 hover:text-gray-700',
                    )}
                  >
                    {mode === 'email'
                      ? <Mail className="h-3.5 w-3.5" />
                      : <Smartphone className="h-3.5 w-3.5" />}
                    {mode === 'email' ? 'Email' : 'Phone number'}
                  </button>
                ))}
              </div>
            </div>

            {directMode === 'email' ? (
              <ol className="mt-2 list-decimal pl-4 text-xs text-gray-600 space-y-0.5">
                <li>Person registers at <span className="font-medium">{window.location.origin}/register</span></li>
                <li>You enter their email + role below and click Add member</li>
                <li>They get instant access – no invitation link needed</li>
              </ol>
            ) : (
              <ol className="mt-2 list-decimal pl-4 text-xs text-gray-600 space-y-0.5">
                <li>Enter their mobile number — no email address or existing account needed</li>
                <li>Ledgr creates their login and shows you a one-time password</li>
                <li>Send it over WhatsApp or SMS; they sign in with number + password</li>
              </ol>
            )}
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

          {phoneLogin && <PhoneCredentialsPanel credentials={phoneLogin} />}

          <form onSubmit={handleDirectInvite} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            {directMode === 'email' ? (
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-gray-600">Email address</label>
                <input
                  type="email"
                  required
                  value={directEmail}
                  onChange={(e) => setDirectEmail(e.target.value)}
                  placeholder="colleague@business.mw"
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-600 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
            ) : (
              <>
                <div className="flex-1">
                  <label htmlFor="invite-phone" className="mb-1 block text-xs font-medium text-gray-600">
                    Mobile number
                  </label>
                  <input
                    id="invite-phone"
                    type="tel"
                    required
                    inputMode="tel"
                    autoComplete="tel"
                    value={directPhone}
                    onChange={(e) => setDirectPhone(e.target.value)}
                    placeholder="0991234567 or +265991234567"
                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-600 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>
                <div className="flex-1">
                  <label htmlFor="invite-name" className="mb-1 block text-xs font-medium text-gray-600">
                    Their name <span className="font-normal text-gray-400">(optional)</span>
                  </label>
                  <input
                    id="invite-name"
                    type="text"
                    value={directName}
                    onChange={(e) => setDirectName(e.target.value)}
                    placeholder="John Banda"
                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-600 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>
              </>
            )}

            <div className="w-full sm:w-44">
              <label className="mb-1 block text-xs font-medium text-gray-600">Role</label>
              <select
                value={directRole}
                onChange={(e) => setDirectRole(e.target.value as UserRole)}
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                {assignableRoles.map((r) => (
                  <option key={r} value={r}>{ROLE_CONFIG[r]?.label || r}</option>
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
            <p className="text-xs text-gray-600">{ROLE_CONFIG[directRole]?.description}</p>
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
              <div className="mb-1 flex items-center justify-between gap-2">
                <label className="block text-xs font-medium text-gray-600">
                  Restrict to {linkMode === 'phone' ? 'phone' : 'email'} (Optional)
                </label>
                <div className="inline-flex rounded-md border border-gray-200 p-0.5">
                  {(['email', 'phone'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setLinkMode(mode)}
                      className={clsx(
                        'rounded px-2 py-0.5 text-[11px] font-semibold transition-colors',
                        linkMode === mode
                          ? 'bg-brand-500 text-white'
                          : 'text-gray-500 hover:text-gray-700',
                      )}
                    >
                      {mode === 'email' ? 'Email' : 'Phone'}
                    </button>
                  ))}
                </div>
              </div>
              {linkMode === 'email' ? (
                <input
                  type="email"
                  value={linkEmailRestriction}
                  onChange={(e) => setLinkEmailRestriction(e.target.value)}
                  placeholder="Only this email can accept (Optional)"
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-600 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              ) : (
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={linkPhoneRestriction}
                  onChange={(e) => setLinkPhoneRestriction(e.target.value)}
                  placeholder="Only this number can accept (Optional)"
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-600 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              )}
            </div>

            <div className="w-full sm:w-44">
              <label className="mb-1 block text-xs font-medium text-gray-600">Role</label>
              <select
                value={linkRole}
                onChange={(e) => setLinkRole(e.target.value as UserRole)}
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                {assignableRoles.map((r) => (
                  <option key={r} value={r}>{ROLE_CONFIG[r]?.label || r}</option>
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
            <p className="text-xs text-gray-600">{ROLE_CONFIG[linkRole]?.description}</p>
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
  /** Which member a password reset is in flight for. */
  const [resendingPassword, setResendingPassword] = useState<string | null>(null);
  /** One-time credentials minted from the roster, shown once above the list. */
  const [rosterCredentials, setRosterCredentials] = useState<PhoneCredentials | null>(null);

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
      if (!error && data && typeof data === 'object' && data !== null && !('error' in data) && 'members' in data) {
        const enriched = (data as { members: Array<{
          id: string;
          user_id: string;
          role: UserRole;
          is_active: boolean;
          invited_at: string | null;
          accepted_at: string | null;
          invitation_token?: string | null;
          invitation_expires_at?: string | null;
          email: string | null;
          phone?: string | null;
          full_name: string | null;
        }> }).members;
        setMembers(
          enriched.map((m) => ({
            id: m.id,
            user_id: m.user_id,
            role: m.role,
            is_active: m.is_active,
            invited_at: m.invited_at,
            accepted_at: m.accepted_at,
            invitation_token: m.invitation_token ?? null,
            invitation_expires_at: m.invitation_expires_at ?? null,
            email: m.email,
            phone: m.phone ?? null,
            full_name: m.full_name,
          })),
        );
      } else {
        // Fallback Client-side query
        const { data: directMembers, error: fetchError } = await supabase
          .from('business_users')
          .select('id, user_id, role, is_active, invited_at, accepted_at, invitation_token, invitation_expires_at')
          .eq('business_id', businessId)
          .order('created_at', { ascending: true });

        if (fetchError) throw fetchError;

        type DirectMemberRow = {
          id: string;
          user_id: string;
          role: string;
          is_active: boolean;
          invited_at: string | null;
          accepted_at: string | null;
          invitation_token: string | null;
          invitation_expires_at: string | null;
        };
        const userIds = (directMembers ?? []).map((r) => r.user_id);
        const { data: profiles } = userIds.length === 0
          ? { data: [] as Array<{ id: string; full_name: string | null; phone: string | null }> }
          : await supabase
              .from('user_profiles')
              .select('id, full_name, phone')
              .in('id', userIds);
        const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
        const mapped: Member[] = (directMembers ?? []).map((row: DirectMemberRow) => ({
          id: row.id,
          user_id: row.user_id,
          role: row.role as UserRole,
          is_active: row.is_active,
          invited_at: row.invited_at,
          accepted_at: row.accepted_at,
          invitation_token: row.invitation_token,
          invitation_expires_at: row.invitation_expires_at,
          email: null,
          // The fallback path cannot read auth.users, so the number on the
          // profile is the only identity a phone-added member has here.
          phone: profileMap.get(row.user_id)?.phone ?? null,
          full_name: profileMap.get(row.user_id)?.full_name ?? null,
        }));
        setMembers(mapped);
      }
    } catch (err) {
      handleError(err, { module: 'TeamManagementPage', operation: 'loadTeamMembers', notify: false });
      setError(err instanceof Error ? err.message : 'Error loading team members');
    }

    // 2. Fetch active shareable invite links from business_invitations
    try {
      const { data: invitesData, error: invitesError } = await supabase
        .from('business_invitations')
        .select('*')
        .is('accepted_at', null)
        .gt('expires_at', new Date().toISOString())
        .eq('business_id', businessId);

      if (invitesError) throw invitesError;
      setActiveLinks((invitesData ?? []) as InvitationLink[]);
    } catch (err) {
      log.error('Error loading invite links', err as Error);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  // didMount ref pattern: react-hooks v6 flags the synchronous setState
  // in `loadMembersAndInvites` (sets loading/error) when called from the
  // effect body. Confining the initial load to the first run only is the
  // standard pattern for "load on mount" data fetching.
  const didMountRef = useRef(false);
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      void loadMembersAndInvites();
    }
  }, [loadMembersAndInvites]);

  /**
   * Mint a fresh one-time password for a member who signs in with a number.
   *
   * A phone account has no inbox, so "I forgot my password" has no self-service
   * route — the owner is the recovery path. Same call as an invite
   * (invite-team-member with reset_password), and the password comes back once.
   */
  async function handleResendPassword(member: Member) {
    if (!member.phone || !businessId) return;

    const shown = formatPhoneForDisplay(member.phone);
    if (
      !window.confirm(
        `Create a new password for ${shown}? Their current password stops working immediately.`,
      )
    ) {
      return;
    }

    setResendingPassword(member.id);
    setRosterCredentials(null);
    setError(null);

    try {
      const { data, failure } = await invokeFunction<InviteResult>('invite-team-member', {
        business_id: businessId,
        // The member's current role: the function returns it unchanged for an
        // active member, so a password reset never alters access.
        role: member.role,
        phone: member.phone,
        reset_password: true,
      });

      if (failure) throw new Error(failure.message);

      const login = data?.login;
      if (!login?.phone || !login.temporary_password) {
        throw new Error(
          'No new password came back for that member. Phone passwords can only be reset for accounts Ledgr created from a number.',
        );
      }
      setRosterCredentials({ phone: login.phone, password: login.temporary_password });
    } catch (err) {
      handleError(err, { module: 'TeamManagementPage', operation: 'resendPhonePassword', notify: false });
      setError(err instanceof Error ? err.message : 'Could not create a new password');
    } finally {
      setResendingPassword(null);
    }
  }

  /**
   * Soft-remove (deactivate) an active member — keeps the row for audit history.
   */
  async function handleRemove(memberId: string, memberUserId: string) {
    if (memberUserId === currentUser?.id) {
      alert('You cannot remove yourself from the business.');
      return;
    }

    if (!window.confirm('Remove this member from the business? They will lose access immediately.')) return;

    setRemoving(memberId);

    const { error: removeError } = await supabase
      .from('business_users')
      .update({
        is_active: false,
        invitation_token: null,
        invitation_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', memberId)
      .eq('business_id', businessId!);

    setRemoving(null);

    if (removeError) {
      setError(removeError.message);
      return;
    }

    // Keep the row locally as inactive so owners can permanently delete it later
    setMembers((prev) =>
      prev.map((m) =>
        m.id === memberId
          ? { ...m, is_active: false, invitation_token: null, invitation_expires_at: null }
          : m,
      ),
    );
  }

  /**
   * Permanently delete a membership row. Intended for expired invitations and
   * already-deactivated members so owners can clean the team roster.
   */
  async function handlePermanentRemove(memberId: string, memberUserId: string, label: string) {
    if (memberUserId === currentUser?.id) {
      alert('You cannot remove yourself from the business.');
      return;
    }

    if (
      !window.confirm(
        `Permanently remove ${label} from this business? This cannot be undone from the team list.`,
      )
    ) {
      return;
    }

    setRemoving(memberId);

    const { error: deleteError } = await supabase
      .from('business_users')
      .delete()
      .eq('id', memberId)
      .eq('business_id', businessId!);

    setRemoving(null);

    if (deleteError) {
      // Some RLS policies only allow soft-delete (is_active=false). Fall back.
      const { error: softError } = await supabase
        .from('business_users')
        .update({
          is_active: false,
          invitation_token: null,
          invitation_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', memberId)
        .eq('business_id', businessId!);

      if (softError) {
        setError(deleteError.message || softError.message);
        return;
      }

      setMembers((prev) =>
        prev.map((m) =>
          m.id === memberId
            ? { ...m, is_active: false, invitation_token: null, invitation_expires_at: null }
            : m,
        ),
      );
      return;
    }

    setMembers((prev) => prev.filter((m) => m.id !== memberId));
  }

  async function handleRemoveAllExpired() {
    const expired = members.filter(
      (m) => !m.is_active && Boolean(m.invitation_token) && isInvitationExpired(m),
    );
    if (expired.length === 0) return;

    if (!window.confirm(`Permanently remove all ${expired.length} expired invitation(s)?`)) {
      return;
    }

    setRemoving('__all_expired__');
    const failures: string[] = [];

    for (const member of expired) {
      const { error: deleteError } = await supabase
        .from('business_users')
        .delete()
        .eq('id', member.id)
        .eq('business_id', businessId!);

      if (deleteError) {
        const { error: softError } = await supabase
          .from('business_users')
          .update({
            is_active: false,
            invitation_token: null,
            invitation_expires_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', member.id)
          .eq('business_id', businessId!);
        if (softError) {
          failures.push(member.email ?? member.full_name ?? member.id);
        }
      }
    }

    setRemoving(null);

    if (failures.length > 0) {
      setError(`Could not remove: ${failures.join(', ')}`);
    }

    await loadMembersAndInvites();
  }

  async function handleChangeRole(memberId: string, newRole: UserRole) {
    const { error: updateError } = await supabase
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

  async function handleRevokeInviteLink(inviteId: string) {
    if (!window.confirm('Are you sure you want to revoke this invitation link? It will immediately stop working.')) return;
    setRevoking(inviteId);

    const { error: revokeError } = await supabase
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
  // Pending invitations that are still within their acceptance window
  const pendingMembers = members.filter(
    (m) => !m.is_active && m.invitation_token && !isInvitationExpired(m),
  );
  // Invitations whose role/access window has expired — owners can purge these
  const expiredMembers = members.filter(
    (m) => !m.is_active && Boolean(m.invitation_token) && isInvitationExpired(m),
  );
  // Soft-removed members (no longer active, no open invite) — owners can purge
  const inactiveMembers = members.filter(
    (m) => !m.is_active && !m.invitation_token && m.role !== 'owner',
  );

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

        {rosterCredentials && (
          <PhoneCredentialsPanel credentials={rosterCredentials} />
        )}

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading members and invites…
          </div>
        ) : activeMembers.length === 0 ? (
          <p className="py-4 text-sm text-gray-600">No active members found.</p>
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
                    {(member.full_name ?? member.email ?? member.phone ?? '?').charAt(0).toUpperCase()}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {member.full_name ??
                        member.email ??
                        (member.phone ? formatPhoneForDisplay(member.phone) : 'Unknown user')}
                      {isCurrentUser && (
                        <span className="ml-1.5 text-xs font-normal text-gray-400">(you)</span>
                      )}
                    </p>
                    {member.email && member.full_name && (
                      <p className="truncate text-xs text-gray-500">{member.email}</p>
                    )}
                    {/* A phone member's number IS their identity — there is no
                        address behind it, so show it whenever it is not already
                        the headline. */}
                    {!member.email && member.phone && (
                      <p className="flex items-center gap-1 truncate text-xs text-gray-500">
                        <Smartphone className="h-3 w-3 shrink-0" />
                        {formatPhoneForDisplay(member.phone)}
                      </p>
                    )}
                  </div>

                  {canModify ? (
                    <select
                      value={member.role}
                      onChange={(e) => void handleChangeRole(member.id, e.target.value as UserRole)}
                      className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    >
                      {(currentRole === 'owner' ? Object.keys(ROLE_CONFIG) as UserRole[] : INVITABLE_ROLES).map((r) => (
                        <option key={r} value={r}>{ROLE_CONFIG[r]?.label || r}</option>
                      ))}
                    </select>
                  ) : (
                    <RoleBadge role={member.role} />
                  )}

                  {canModify && member.phone && (
                    <button
                      onClick={() => void handleResendPassword(member)}
                      disabled={resendingPassword === member.id}
                      className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-amber-50 hover:text-amber-600 disabled:opacity-50"
                      title="Create a new one-time password"
                      aria-label={`Create a new one-time password for ${
                        member.full_name ?? formatPhoneForDisplay(member.phone)
                      }`}
                    >
                      {resendingPassword === member.id
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <KeyRound className="h-4 w-4" />}
                    </button>
                  )}

                  {canModify && (
                    <button
                      onClick={() => void handleRemove(member.id, member.user_id)}
                      disabled={removing === member.id}
                      className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                      title="Remove member"
                      aria-label={`Remove ${
                        member.full_name ?? member.email ?? 'this member'
                      } from the business`}
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
                  <p className="text-xs text-gray-600">
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
                    {member.email ?? member.full_name ?? 'Invited user'}
                  </p>
                  <p className="text-xs text-gray-600">
                    {member.invited_at && (
                      <>
                        Invited {new Date(member.invited_at).toLocaleDateString('en-GB', {
                          day: 'numeric', month: 'short', year: 'numeric',
                        })}
                      </>
                    )}
                    {member.invitation_expires_at && (
                      <>
                        {member.invited_at ? ' · ' : ''}
                        Expires {new Date(member.invitation_expires_at).toLocaleDateString('en-GB', {
                          day: 'numeric', month: 'short', year: 'numeric',
                        })}
                      </>
                    )}
                  </p>
                </div>
                <RoleBadge role={member.role} />
                <PermissionGate require="canManageUsers">
                  <button
                    onClick={() =>
                      void handlePermanentRemove(
                        member.id,
                        member.user_id,
                        member.email ?? member.full_name ?? 'this invitation',
                      )
                    }
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

      {/* Expired invitations — owners/admins can purge these */}
      {!loading && expiredMembers.length > 0 && (
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-900">
              Expired invitations ({expiredMembers.length})
            </h3>
            <PermissionGate require="canManageUsers">
              <button
                type="button"
                onClick={() => void handleRemoveAllExpired()}
                disabled={removing === '__all_expired__'}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50"
              >
                {removing === '__all_expired__'
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <UserX className="h-3.5 w-3.5" />
                }
                Remove all expired
              </button>
            </PermissionGate>
          </div>
          <p className="mb-2 text-xs text-gray-500">
            These invitations are past their expiry date and can no longer be accepted. Remove them to clean up the team roster.
          </p>
          <div className="divide-y divide-gray-100 rounded-xl border border-amber-200 bg-amber-50/40">
            {expiredMembers.map((member) => (
              <div key={member.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100">
                  <Clock className="h-4 w-4 text-amber-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-800">
                    {member.email ?? member.full_name ?? 'Invited user'}
                  </p>
                  <p className="text-xs text-amber-700">
                    Role expired
                    {member.invitation_expires_at && (
                      <>
                        {' '}
                        on {new Date(member.invitation_expires_at).toLocaleDateString('en-GB', {
                          day: 'numeric', month: 'short', year: 'numeric',
                        })}
                      </>
                    )}
                  </p>
                </div>
                <RoleBadge role={member.role} />
                <span className="hidden rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 sm:inline">
                  Expired
                </span>
                <PermissionGate require="canManageUsers">
                  <button
                    onClick={() =>
                      void handlePermanentRemove(
                        member.id,
                        member.user_id,
                        member.email ?? member.full_name ?? 'this expired invitation',
                      )
                    }
                    disabled={removing === member.id || removing === '__all_expired__'}
                    className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                    title="Remove expired invitation"
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

      {/* Inactive / previously removed members */}
      {!loading && inactiveMembers.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-gray-900">
            Inactive members ({inactiveMembers.length})
          </h3>
          <p className="mb-2 text-xs text-gray-500">
            Previously removed members. You can permanently delete them from the roster.
          </p>
          <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-gray-50">
            {inactiveMembers.map((member) => (
              <div key={member.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-200 text-sm font-semibold text-gray-500">
                  {(member.full_name ?? member.email ?? '?').charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-gray-700">
                    {member.full_name ?? member.email ?? 'Unknown user'}
                  </p>
                  {member.email && member.full_name && (
                    <p className="truncate text-xs text-gray-500">{member.email}</p>
                  )}
                </div>
                <RoleBadge role={member.role} />
                <span className="hidden rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600 sm:inline">
                  Inactive
                </span>
                <PermissionGate require="canManageUsers">
                  <button
                    onClick={() =>
                      void handlePermanentRemove(
                        member.id,
                        member.user_id,
                        member.full_name ?? member.email ?? 'this member',
                      )
                    }
                    disabled={removing === member.id}
                    className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                    title="Permanently remove member"
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
                <th scope="col" className="px-4 py-2.5 text-left font-semibold text-gray-600">Permission</th>
                {(Object.keys(ROLE_CONFIG) as UserRole[]).map((r) => (
                  <th scope="col" key={r} className="px-3 py-2.5 text-center font-semibold text-gray-600">
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
                      canRead: ['owner','admin','accountant','payroll_manager','supervisor','data_entry','inventory_manager','sales_clerk','auditor','viewer','purchasing_officer','warehouse_worker','sales_manager','customer_service_rep','tax_compliance_officer','treasury_manager','asset_manager','board_member','branch_manager','manager','cashier','stock_clerk'],
                      canWrite: ['owner','admin','accountant','supervisor','data_entry','inventory_manager','sales_clerk','purchasing_officer','warehouse_worker','sales_manager','customer_service_rep','tax_compliance_officer','treasury_manager','asset_manager','branch_manager','manager','cashier','stock_clerk'],
                      canWritePayroll: ['owner','admin','accountant','payroll_manager','supervisor'],
                      canDelete: ['owner','admin'],
                      canManageUsers: ['owner','admin'],
                      canExport: ['owner','admin','accountant','payroll_manager','supervisor','inventory_manager','auditor','purchasing_officer','sales_manager','tax_compliance_officer','treasury_manager','asset_manager','board_member','branch_manager','manager'],
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
