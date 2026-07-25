import { useCallback, useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';

type PageState = 'loading' | 'success' | 'error' | 'needs_login';

interface AcceptResult {
  business_id: string;
  role: string;
  business_name: string;
}

type InviteResponse = Partial<AcceptResult> & {
  error?: string;
  message?: string;
  code?: string;
  already_member?: boolean;
};

type FunctionError = {
  message: string;
  status?: number;
};

function asInviteResponse(data: unknown): InviteResponse {
  return (data ?? {}) as InviteResponse;
}

function asFunctionError(error: unknown): FunctionError | null {
  if (!error || typeof error !== 'object') return null;
  const maybe = error as { message?: unknown; status?: unknown };
  return {
    message: typeof maybe.message === 'string' ? maybe.message : String(error),
    status: typeof maybe.status === 'number' ? maybe.status : undefined,
  };
}

/** Landing page for invitation links. Route: /accept-invitation?token=<hex> */
export function AcceptInvitationPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const currentUser = useAppStore((s) => s.currentUser);
  const setBusinesses = useAppStore((s) => s.setBusinesses);
  const setCurrentBusiness = useAppStore((s) => s.setCurrentBusiness);

  const token = searchParams.get('token');
  const [pageState, setPageState] = useState<PageState>(() => (token ? 'loading' : 'error'));
  const [result, setResult] = useState<AcceptResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>(() => (token ? '' : t('invite.noToken')));

  const acceptInvitation = useCallback(async (inviteToken: string) => {
    setPageState('loading');

    let { data, error } = await supabase.functions.invoke('accept-invite-link', {
      body: { token: inviteToken },
    });

    let response = asInviteResponse(data);
    let functionError = asFunctionError(error);

    const isNotFound =
      functionError?.status === 404 ||
      functionError?.message.includes('404') ||
      (response.error && response.code === 'INVITATION_NOT_FOUND');

    if (isNotFound) {
      console.log('Token not found in business_invitations, trying legacy RPC...');
      const rpcRes = await supabase.rpc('accept_invitation' as never, {
        p_token: inviteToken,
      } as never);
      data = rpcRes.data;
      error = rpcRes.error;
      response = asInviteResponse(data);
      functionError = asFunctionError(error);
    }

    if (response.already_member || functionError?.message.toLowerCase().includes('already') || response.code === 'ALREADY_MEMBER') {
      setPageState('success');
      setResult({
        business_id: response.business_id || '',
        role: response.role || 'member',
        business_name: response.business_name || t('invite.theBusiness'),
      });
      setTimeout(() => navigate('/dashboard', { replace: true }), 1500);
      return;
    }

    const finalError = functionError || (response.error ? { message: response.message || response.error } : null);

    if (finalError) {
      setPageState('error');
      setErrorMessage(
        finalError.message.includes('Invalid or expired')
          ? t('invite.invalidExpired')
          : finalError.message.includes('already a member')
            ? t('invite.alreadyMember')
            : finalError.message,
      );
      return;
    }

    const accepted: AcceptResult = {
      business_id: response.business_id || '',
      role: response.role || 'member',
      business_name: response.business_name || t('invite.theBusiness'),
    };
    setResult(accepted);
    setPageState('success');

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

      const newBiz = mapped.find((m) => (m.business as { id: string }).id === accepted.business_id);
      if (newBiz) setCurrentBusiness(newBiz);
    }

    setTimeout(() => navigate('/dashboard', { replace: true }), 2500);
  }, [currentUser, navigate, setBusinesses, setCurrentBusiness, t]);

  useEffect(() => {
    if (!token) return;

    if (!currentUser) return;

    // Accepting an invite synchronizes app state with Supabase after auth is ready.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void acceptInvitation(token);
  }, [token, currentUser, acceptInvitation]);

  const effectivePageState: PageState = token && !currentUser && pageState === 'loading' ? 'needs_login' : pageState;

  if (effectivePageState === 'needs_login') {
    const returnUrl = encodeURIComponent(window.location.href);
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-soft">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500 text-lg font-bold text-white">L</div>
          <h1 className="text-lg font-semibold text-gray-900">{t('invite.invitedTitle')}</h1>
          <p className="mt-2 text-sm text-gray-500">{t('invite.needsLoginBody')}</p>
          <div className="mt-5 flex flex-col gap-2">
            <Link to={`/login?returnTo=${returnUrl}`} className="block rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-600">
              {t('auth.signIn')}
            </Link>
            <Link to={`/register?returnTo=${returnUrl}`} className="block rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50">
              {t('auth.createAccount')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (effectivePageState === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
          <p className="text-sm text-gray-500">{t('invite.accepting')}</p>
        </div>
      </div>
    );
  }

  if (effectivePageState === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-soft">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
            <AlertCircle className="h-6 w-6 text-red-500" />
          </div>
          <h1 className="text-lg font-semibold text-gray-900">{t('invite.failedTitle')}</h1>
          <p className="mt-2 text-sm text-gray-500">{errorMessage}</p>
          <Link to="/dashboard" className="mt-5 inline-block text-sm font-medium text-brand-600 hover:text-brand-700">
            {t('invite.goDashboard')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-soft">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50">
          <CheckCircle2 className="h-6 w-6 text-brand-500" />
        </div>
        <h1 className="text-lg font-semibold text-gray-900">
          {t('invite.welcomeTitle', { business: result?.business_name ?? t('invite.theBusiness') })}
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          {t('invite.joinedAs', { role: result?.role?.replace('_', ' ') ?? t('invite.member') })}
        </p>
      </div>
    </div>
  );
}
