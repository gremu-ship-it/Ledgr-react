import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { AuthShell } from '@/components/auth/AuthShell';
import {
  PasswordInput,
  PasswordStrengthMeter,
  measureStrength,
  FormField,
  AuthAlert,
  SubmitButton,
} from '@/components/auth/AuthUI';

type ResetState = 'awaiting_session' | 'form' | 'success' | 'invalid_link';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [pageState, setPageState] = useState<ResetState>('awaiting_session');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When the user clicks the reset link in their email, Supabase redirects them
  // here with the recovery token in the URL hash. The Supabase client picks this
  // up via detectSessionInUrl and fires PASSWORD_RECOVERY on onAuthStateChange.
  // We listen for that event to know the token is valid and show the form.
  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setPageState('form');
      }
    });

    // If the user navigated here without a valid token (e.g. directly), give
    // the listener 3 seconds to fire, then mark the link as invalid.
    const timeout = setTimeout(() => {
      setPageState((s) => (s === 'awaiting_session' ? 'invalid_link' : s));
    }, 3000);

    return () => {
      listener.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (measureStrength(password).score < 2) {
      setError('Password is too weak. Use at least 8 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);

    // updateUser is called while the session is in PASSWORD_RECOVERY state.
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setPageState('success');

    // Sign out all sessions except the current one so the new password
    // takes effect everywhere, then redirect to login.
    await supabase.auth.signOut({ scope: 'global' });
    setTimeout(() => navigate('/login', { replace: true }), 2500);
  }

  if (pageState === 'awaiting_session') {
    return (
      <AuthShell title="Verifying link…" subtitle="Please wait">
        <div className="py-6 text-center text-sm text-gray-500">
          Validating your reset link…
        </div>
      </AuthShell>
    );
  }

  if (pageState === 'invalid_link') {
    return (
      <AuthShell title="Link expired or invalid">
        <AuthAlert
          type="error"
          message="This password reset link is invalid or has expired. Please request a new one."
        />
        <p className="mt-4 text-center text-sm text-gray-500">
          <a href="/forgot-password" className="font-medium text-brand-600 hover:text-brand-700">
            Request a new link
          </a>
        </p>
      </AuthShell>
    );
  }

  if (pageState === 'success') {
    return (
      <AuthShell title="Password updated">
        <AuthAlert
          type="success"
          message="Your password has been updated. Redirecting you to sign in…"
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Set a new password" subtitle="Choose a strong password for your Ledgr account">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <AuthAlert type="error" message={error} />}

        <FormField id="password" label="New password">
          <PasswordInput
            id="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="New password"
          />
          <PasswordStrengthMeter password={password} />
        </FormField>

        <FormField id="confirmPassword" label="Confirm new password">
          <PasswordInput
            id="confirmPassword"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Same password again"
          />
        </FormField>

        <SubmitButton loading={loading} label="Update password" loadingLabel="Updating…" />
      </form>
    </AuthShell>
  );
}
