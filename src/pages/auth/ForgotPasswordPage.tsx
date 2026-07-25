import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { AuthShell } from '@/components/auth/AuthShell';
import { FormField, Input, AuthAlert, SubmitButton } from '@/components/auth/AuthUI';
import { CheckCircle2 } from 'lucide-react';

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (resetError) { setError(resetError.message); return; }
    setSent(true);
  }

  if (sent) {
    return (
      <AuthShell title={t('auth.checkInbox')}>
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50">
            <CheckCircle2 className="h-7 w-7 text-brand-500" />
          </div>
          <p className="text-sm text-gray-600">
            {t('auth.resetEmailSent', { email })}
          </p>
          <p className="text-xs text-gray-400">{t('auth.checkSpam')}</p>
          <Link to="/login" className="mt-2 text-sm font-medium text-brand-600 hover:text-brand-700">
            {t('auth.backToSignIn')}
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t('auth.resetPassword')} subtitle={t('auth.resetPasswordSubtitle')}>
      <form onSubmit={handleSubmit} className="space-y-4">
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
        <SubmitButton loading={loading} label={t('auth.sendResetLink')} loadingLabel={t('auth.sending')} />
      </form>
      <p className="mt-5 text-center text-sm text-gray-500">
        {t('auth.rememberedIt')}{' '}
        <Link to="/login" className="font-medium text-brand-600 hover:text-brand-700">
          {t('auth.signIn')}
        </Link>
      </p>
    </AuthShell>
  );
}
