import { useState, type FormEvent, useMemo } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { createLogger } from '@/lib/logger';
import { AuthShell } from '@/components/auth/AuthShell';
import { usePartner } from '@/partner/PartnerContext';
import {
  FormField,
  Input,
  PasswordInput,
  AuthAlert,
  SubmitButton,
  OTPInput,
} from '@/components/auth/AuthUI';

type LoginStep = 'credentials' | 'mfa';

const log = createLogger('LoginPage');

/**
 * Classify a Supabase sign-in error so platform failures are never reported
 * to the user as "wrong password".
 *
 *  - credential : the password/email genuinely didn't match (400
 *                 invalid_credentials) — safe to blame the credentials.
 *  - unverified : the account exists but the email isn't confirmed.
 *  - service    : anything else (401 invalid/rotated API key, 5xx
 *                 "database error ..." from GoTrue, network failure, rate
 *                 limiting). Telling the user their password is wrong here
 *                 is misleading and hides real outages from support.
 */
function classifySignInError(err: {
  message: string;
  code?: string;
  status?: number;
}): 'credential' | 'unverified' | 'service' {
  const msg = err.message.toLowerCase();
  if (err.code === 'email_not_confirmed' || msg.includes('email not confirmed')) {
    return 'unverified';
  }
  if (
    err.code === 'invalid_credentials' ||
    (err.status === 400 && msg.includes('invalid login credentials'))
  ) {
    return 'credential';
  }
  return 'service';
}

export function LoginPage() {
  const { t } = useTranslation();
  const { partner, branding } = usePartner();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  // Support both state.from (protected redirect) and ?returnTo= (invite flow)
  const fromState = (location.state as { from?: { pathname?: string } })?.from?.pathname;
  const returnToParam = searchParams.get('returnTo');

  const safeReturnTo = useMemo(() => {
    if (!returnToParam) return null;
    try {
      const decoded = decodeURIComponent(returnToParam);
      if (decoded.startsWith('http')) {
        const url = new URL(decoded);
        if (url.origin === window.location.origin) return url.pathname + url.search + url.hash;
        return null;
      }
      if (decoded.startsWith('/')) return decoded;
      return null;
    } catch {
      return null;
    }
  }, [returnToParam]);

  const from = safeReturnTo ?? fromState ?? '/dashboard';
  const inactivityLogout = (location.state as { reason?: string })?.reason === 'inactivity';

  // Step 1: email + password
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);

  // Step 2: TOTP MFA
  const [step, setStep] = useState<LoginStep>('credentials');
  const [mfaFactorId, setMfaFactorId] = useState('');
  const [mfaCode, setMfaCode] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCredentials(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setLoading(false);
      const kind = classifySignInError(signInError);
      if (kind === 'unverified') {
        setError(t('auth.emailNotVerified'));
      } else if (kind === 'credential') {
        setError(t('auth.incorrectCredentials'));
      } else {
        // Platform-level failure (invalid API key, GoTrue database error,
        // network, rate limit…). Surface it as a service problem and log the
        // raw error so it reaches Sentry instead of hiding behind a
        // "wrong password" message.
        log.error('Sign-in failed with a non-credential error', signInError as Error, {
          operation: 'signInWithPassword',
          data: {
            status: (signInError as { status?: number }).status,
            code: (signInError as { code?: string }).code,
          },
        });
        setError(t('auth.serviceUnavailable'));
      }
      return;
    }

    // Supabase persists sessions in localStorage. For a session-only login we
    // pair a durable mode flag with a tab-scoped marker: after the browser/tab
    // closes the marker is gone, so useAuthListener signs the persisted session
    // out before hydrating any business data.
    if (!rememberMe && signInData.session) {
      localStorage.setItem('ledgr-auth-persistence', 'session');
      sessionStorage.setItem('ledgr-session-only', '1');
    } else {
      localStorage.removeItem('ledgr-auth-persistence');
      sessionStorage.removeItem('ledgr-session-only');
    }

    // Check Authenticator Assurance Level for MFA requirement
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

    if (aal?.nextLevel === 'aal2' && aal.nextLevel !== aal.currentLevel) {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const totp = factors?.totp?.[0];

      if (totp) {
        setMfaFactorId(totp.id);
        setLoading(false);
        setStep('mfa');
        return;
      }
    }

    setLoading(false);
    navigate(from, { replace: true });
  }

  async function handleMfa(e: FormEvent) {
    e.preventDefault();
    if (mfaCode.length !== 6) {
      setError(t('auth.enterMfaCode'));
      return;
    }
    setError(null);
    setLoading(true);

    // Use explicit challenge() → verify() instead of challengeAndVerify()
    // due to known reliability issues with the combined method.
    const { data: challengeData, error: challengeError } =
      await supabase.auth.mfa.challenge({ factorId: mfaFactorId });

    if (challengeError) {
      setLoading(false);
      setError(challengeError.message);
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: mfaFactorId,
      challengeId: challengeData.id,
      code: mfaCode,
    });

    setLoading(false);

    if (verifyError) {
      setError(t('auth.invalidMfaCode'));
      setMfaCode('');
      return;
    }

    navigate(from, { replace: true });
  }

  // ── MFA step UI ──────────────────────────────────────────────────────────
  if (step === 'mfa') {
    return (
      <AuthShell
        title={t('auth.twoFactor')}
        subtitle={t('auth.twoFactorSubtitle')}
      >
        <form onSubmit={handleMfa} className="space-y-5">
          {error && <AuthAlert type="error" message={error} />}

          <OTPInput value={mfaCode} onChange={setMfaCode} disabled={loading} />

          <SubmitButton loading={loading} label={t('auth.verify')} loadingLabel={t('auth.verifying')} />

          <button
            type="button"
            onClick={() => {
              setStep('credentials');
              setMfaCode('');
              setError(null);
            }}
            className="w-full text-center text-sm text-gray-700 hover:text-gray-900 hover:underline"
          >
            {t('auth.backToSignIn')}
          </button>
        </form>
      </AuthShell>
    );
  }

  // ── Credentials step UI ──────────────────────────────────────────────────
  return (
    <AuthShell
      title={partner ? `Sign in to ${branding.appName}` : t('auth.welcomeBack')}
      subtitle={partner ? `Access your ${branding.appName} account` : t('auth.signInSubtitle')}
    >
      <form onSubmit={handleCredentials} className="space-y-4">
        {inactivityLogout && (
          <AuthAlert
            type="info"
            message={t('auth.signedOutInactivity')}
          />
        )}
        {error && <AuthAlert type="error" message={error} />}

        <FormField id="email" label={t('common.email')}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@business.mw"
          />
        </FormField>

        <FormField id="password" label={t('auth.password')}>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </FormField>

        <div className="flex items-center justify-between text-sm">
          <label className="flex cursor-pointer items-center gap-2 text-gray-600">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
            />
            {t('auth.rememberMe')}
          </label>
          <Link to="/forgot-password" className="font-medium text-brand-600 hover:text-brand-700">
            {t('auth.forgotPassword')}
          </Link>
        </div>

        <SubmitButton loading={loading} label={t('auth.signIn')} loadingLabel={t('auth.signingIn')} />
      </form>

      <p className="mt-5 text-center text-sm text-gray-500">
        {t('auth.dontHaveAccount')}{' '}
        <Link
          to={safeReturnTo ? `/register?returnTo=${encodeURIComponent(safeReturnTo)}` : '/register'}
          className="font-medium text-brand-600 hover:text-brand-700"
        >
          {t('auth.createOne')}
        </Link>
      </p>
    </AuthShell>
  );
}
