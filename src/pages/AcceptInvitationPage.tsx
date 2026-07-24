import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';

type PageState = 'loading' | 'success' | 'error' | 'needs_login';

interface AcceptResult {
  business_id: string;
  role: string;
  business_name: string;
}

/**
 * Landing page for invitation links.
 *
 * Flow:
 * 1. Extract token from ?token= query param
 * 2. If user is not authenticated → redirect to /login with return URL
 * 3. If authenticated → call accept-invite-link Edge Function
 * 4. On success → reload business memberships, redirect to /dashboard
 * 5. On error → show message (invalid/expired token, email restriction mismatch, etc.)
 *
 * Route: /accept-invitation?token=<hex>
 */
export function AcceptInvitationPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const currentUser = useAppStore((s) => s.currentUser);
  const setBusinesses = useAppStore((s) => s.setBusinesses);
  const setCurrentBusiness = useAppStore((s) => s.setCurrentBusiness);

  const [pageState, setPageState] = useState<PageState>('loading');
  const [result, setResult] = useState<AcceptResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const token = searchParams.get('token');

  useEffect(() => {
    if (!token) {
      setPageState('error');
      setErrorMessage('No invitation token found in the link. Please check the URL and try again.');
      return;
    }

    // If not logged in, redirect to login preserving the full invite URL
    if (!currentUser) {
      setPageState('needs_login');
      return;
    }

    void acceptInvitation(token);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, currentUser]);

  async function acceptInvitation(inviteToken: string) {
    setPageState('loading');

    // Try Edge Function first (new link-based invites)
    let { data, error } = await supabase.functions.invoke('accept-invite-link', {
      body: { token: inviteToken },
    });

    const isNotFound = 
      (error && ((error as any).status === 404 || error.message.includes('404'))) ||
      (data?.error && data?.code === 'INVITATION_NOT_FOUND');

    if (isNotFound) {
      console.log('Token not found in business_invitations, trying legacy RPC...');
      const rpcRes = await (supabase.rpc as any)('accept_invitation', {
        p_token: inviteToken,
      });
      data = rpcRes.data;
      error = rpcRes.error;
    }

    // Handle already_member gracefully
    if ((data as any)?.already_member || (error?.message || '').toLowerCase().includes('already') || data?.code === 'ALREADY_MEMBER') {
      setPageState('success');
      setResult({
        business_id: (data as any)?.business_id || '',
        role: (data as any)?.role || 'member',
        business_name: (data as any)?.business_name || 'the business',
      });
      setTimeout(() => navigate('/dashboard', { replace: true }), 1500);
      return;
    }

    const finalError = error || (data?.error ? { message: data.message || data.error } : null);

    if (finalError) {
      setPageState('error');
      setErrorMessage(
        finalError.message.includes('Invalid or expired')
          ? 'This invitation link is invalid or has expired. Ask the business owner to send a new invite.'
          : finalError.message.includes('already a member')
            ? 'You are already a member of this business.'
            : finalError.message,
      );
      return;
    }

    const accepted = data as AcceptResult;
    setResult(accepted);
    setPageState('success');

    // Reload business memberships into the store so the new business
    // is immediately available in the switcher without requiring a page reload.
    const { data: memberships } = await supabase
      .from('business_users')
      .select('role, business:businesses!inner(*)')
      .eq('user_id', currentUser!.id)
      .eq('is_active', true)
      .eq('businesses.is_active', true)
      .is('businesses.deleted_at', null);

    if (memberships) {
      type JoinRow = {
        role: string;
        business: Record<string, unknown> | Record<string, unknown>[] | null;
      };
      const mapped = (memberships as unknown as JoinRow[])
        .map((row) => {
          const business = Array.isArray(row.business) ? row.business[0] : row.business;
          if (!business) return null;
          return { business, role: row.role } as unknown as Parameters<typeof setBusinesses>[0][number];
        })
        .filter((m): m is NonNullable<typeof m> => m !== null);

      setBusinesses(mapped);

      // Auto-select the newly joined business
      const newBiz = mapped.find((m) => (m.business as { id: string }).id === accepted.business_id);
      if (newBiz) setCurrentBusiness(newBiz);
    }

    // Redirect to dashboard after a short success display
    setTimeout(() => navigate('/dashboard', { replace: true }), 2500);
  }

  // ── Needs login ────────────────────────────────────────────────────────────
  if (pageState === 'needs_login') {
    const returnUrl = encodeURIComponent(window.location.href);
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-soft">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500 text-lg font-bold text-white">
            L
          </div>
          <h1 className="text-lg font-semibold text-gray-900">You've been invited to Ledgr</h1>
          <p className="mt-2 text-sm text-gray-500">
            Sign in or create an account to accept this invitation and join the business.
          </p>
          <div className="mt-5 flex flex-col gap-2">
            <Link
              to={`/login?returnTo=${returnUrl}`}
              className="block rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-600"
            >
              Sign in
            </Link>
            <Link
              to={`/register?returnTo=${returnUrl}`}
              className="block rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              Create account
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (pageState === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
          <p className="text-sm text-gray-500">Accepting invitation…</p>
        </div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (pageState === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-soft">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
            <AlertCircle className="h-6 w-6 text-red-500" />
          </div>
          <h1 className="text-lg font-semibold text-gray-900">Invitation failed</h1>
          <p className="mt-2 text-sm text-gray-500">{errorMessage}</p>
          <Link
            to="/dashboard"
            className="mt-5 inline-block text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            Go to dashboard
          </Link>
        </div>
      </div>
    );
  }

  // ── Success ────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-soft">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50">
          <CheckCircle2 className="h-6 w-6 text-brand-500" />
        </div>
        <h1 className="text-lg font-semibold text-gray-900">
          Welcome to {result?.business_name ?? 'the business'}!
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          You've joined as{' '}
          <span className="font-medium capitalize">
            {result?.role?.replace('_', ' ') ?? 'a member'}
          </span>
          . Redirecting to your dashboard…
        </p>
      </div>
    </div>
  );
}