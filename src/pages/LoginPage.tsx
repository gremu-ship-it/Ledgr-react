import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { AuthShell } from '@/components/auth/AuthShell';
import {
  FormField,
  Input,
  PasswordInput,
  AuthAlert,
  SubmitButton,
  OTPInput,
} from '@/components/auth/AuthUI';

type LoginStep = 'credentials' | 'mfa';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } })?.from?.pathname ?? '/dashboard';
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
      if (signInError.message.toLowerCase().includes('email not confirmed')) {
        setError('Your email address is not yet verified. Check your inbox for the confirmation link.');
      } else {
        setError('Incorrect email or password. Please try again.');
      }
      return;
    }

    // "Remember me" (30 days) — Supabase default: stores session in localStorage.
    // Session-only (no checkbox) — we store a flag so useAuthListener can enforce
    // clearing the localStorage session on next page load if the sessionStorage
    // marker is gone (i.e. the browser tab/window was closed).
    if (!rememberMe && signInData.session) {
      // Mark this as a session-only login. If the user closes the browser
      // (sessionStorage is cleared), useAuthListener will find no marker and
      // sign out on the next load.
      sessionStorage.setItem('ledgr-session-only', '1');
    } else {
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
      setError('Enter the 6-digit code from your authenticator app.');
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
      setError('Invalid code. Check your authenticator app and try again.');
      setMfaCode('');
      return;
    }

    navigate(from, { replace: true });
  }

  // ── MFA step UI ──────────────────────────────────────────────────────────
  if (step === 'mfa') {
    return (
      <AuthShell
        title="Two-factor authentication"
        subtitle="Enter the 6-digit code from your authenticator app"
      >
        <form onSubmit={handleMfa} className="space-y-5">
          {error && <AuthAlert type="error" message={error} />}

          <OTPInput value={mfaCode} onChange={setMfaCode} disabled={loading} />

          <SubmitButton loading={loading} label="Verify" loadingLabel="Verifying…" />

          <button
            type="button"
            onClick={() => {
              setStep('credentials');
              setMfaCode('');
              setError(null);
            }}
            className="w-full text-center text-sm text-gray-500 hover:text-gray-700"
          >
            ← Back to sign in
          </button>
        </form>
      </AuthShell>
    );
  }

  // ── Credentials step UI ──────────────────────────────────────────────────
  return (
    <AuthShell title="Welcome back to Ledgr" subtitle="Sign in to your account">
      <form onSubmit={handleCredentials} className="space-y-4">
        {inactivityLogout && (
          <AuthAlert
            type="info"
            message="You were signed out after 60 minutes of inactivity. Please sign in again."
          />
        )}
        {error && <AuthAlert type="error" message={error} />}

        <FormField id="email" label="Email">
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

        <FormField id="password" label="Password">
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
            Remember me (30 days)
          </label>
          <Link to="/forgot-password" className="font-medium text-brand-600 hover:text-brand-700">
            Forgot password?
          </Link>
        </div>

        <SubmitButton loading={loading} label="Sign in" loadingLabel="Signing in…" />
      </form>

      <p className="mt-5 text-center text-sm text-gray-500">
        Don't have an account?{' '}
        <Link to="/register" className="font-medium text-brand-600 hover:text-brand-700">
          Create one
        </Link>
      </p>
    </AuthShell>
  );
}
