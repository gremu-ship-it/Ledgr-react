import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { AuthShell } from '@/components/auth/AuthShell';
import { FormField, Input, AuthAlert, SubmitButton } from '@/components/auth/AuthUI';
import { CheckCircle2 } from 'lucide-react';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // Supabase sends a reset email containing a link that, when clicked,
    // redirects to /reset-password with the recovery token in the URL hash.
    // emailRedirectTo must be an allowed redirect URL in your Supabase project settings.
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setLoading(false);

    if (resetError) {
      setError(resetError.message);
      return;
    }

    // Always show success — never confirm whether an email exists (avoids
    // enumeration attacks where an attacker could test which emails are registered).
    setSent(true);
  }

  if (sent) {
    return (
      <AuthShell title="Check your inbox">
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-500/10">
            <CheckCircle2 className="h-7 w-7 text-brand-600 dark:text-brand-400" />
          </div>
          <p className="text-sm text-sub">
            If <span className="font-semibold">{email}</span> is registered with Ledgr, you'll
            receive a password reset link shortly.
          </p>
          <p className="text-xs text-muted">Check your spam folder if it doesn't arrive.</p>
          <Link to="/login" className="mt-2 text-sm font-medium text-brand-600 dark:text-brand-300 hover:text-brand-700 dark:text-brand-300">
            Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter your email and we'll send you a reset link"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
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

        <SubmitButton loading={loading} label="Send reset link" loadingLabel="Sending…" />
      </form>

      <p className="mt-5 text-center text-sm text-muted">
        Remembered it?{' '}
        <Link to="/login" className="font-medium text-brand-600 dark:text-brand-300 hover:text-brand-700 dark:text-brand-300">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
