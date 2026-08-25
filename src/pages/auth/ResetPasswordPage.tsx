import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { secureSignOut } from '@/lib/authSession';
import { AuthShell } from '@/components/auth/AuthShell';
import { PasswordInput, PasswordStrengthMeter, measureStrength, FormField, AuthAlert, SubmitButton } from '@/components/auth/AuthUI';

type ResetState = 'awaiting_session' | 'form' | 'success' | 'invalid_link';

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [pageState, setPageState] = useState<ResetState>('awaiting_session');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setPageState('form');
    });
    const timeout = setTimeout(() => {
      setPageState((s) => (s === 'awaiting_session' ? 'invalid_link' : s));
    }, 3000);
    return () => { listener.subscription.unsubscribe(); clearTimeout(timeout); };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (measureStrength(password).score < 2) { setError(t('auth.weakPasswordShort')); return; }
    if (password !== confirmPassword) { setError(t('auth.passwordsDoNotMatch')); return; }
    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) { setError(updateError.message); return; }
    setPageState('success');
    await secureSignOut('global');
    setTimeout(() => navigate('/login', { replace: true }), 2500);
  }

  if (pageState === 'awaiting_session') {
    return <AuthShell title={t('auth.verifyingLink')}><div className="py-6 text-center text-sm text-gray-500">{t('auth.validatingResetLink')}</div></AuthShell>;
  }
  if (pageState === 'invalid_link') {
    return (
      <AuthShell title={t('auth.linkExpired')}>
        <AuthAlert type="error" message={t('auth.resetLinkInvalid')} />
        <p className="mt-4 text-center text-sm text-gray-500">
          <a href="/forgot-password" className="font-medium text-brand-600 hover:text-brand-700">{t('auth.requestNewLink')}</a>
        </p>
      </AuthShell>
    );
  }
  if (pageState === 'success') {
    return <AuthShell title={t('auth.passwordUpdated')}><AuthAlert type="success" message={t('auth.passwordUpdatedRedirect')} /></AuthShell>;
  }

  return (
    <AuthShell title={t('auth.setNewPassword')} subtitle={t('auth.setNewPasswordSubtitle')}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <AuthAlert type="error" message={error} />}
        <FormField id="password" label={t('auth.newPassword')}>
          <PasswordInput id="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('auth.newPassword')} />
          <PasswordStrengthMeter password={password} />
        </FormField>
        <FormField id="confirmPassword" label={t('auth.confirmNewPassword')}>
          <PasswordInput id="confirmPassword" autoComplete="new-password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder={t('auth.samePasswordAgain')} />
        </FormField>
        <SubmitButton loading={loading} label={t('auth.updatePassword')} loadingLabel={t('auth.updating')} />
      </form>
    </AuthShell>
  );
}