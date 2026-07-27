import { useState, type FormEvent, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { AuthShell } from '@/components/auth/AuthShell';
import { usePartner } from '@/partner/PartnerContext';
import {
  AuthAlert,
  FormField,
  Input,
  PasswordInput,
  PasswordStrengthMeter,
  SubmitButton,
  measureStrength,
} from '@/components/auth/AuthUI';

export function RegisterPage() {
  const { t } = useTranslation();
  const { partner, branding } = usePartner();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnToParam = searchParams.get('returnTo');

  const safeReturnTo = useMemo((): string | null => {
    if (!returnToParam) return null;
    try {
      const decoded = decodeURIComponent(returnToParam);
      if (decoded.startsWith('http')) {
        const url = new URL(decoded);
        return url.origin === window.location.origin ? url.pathname + url.search + url.hash : null;
      }
      return decoded.startsWith('/') ? decoded : null;
    } catch {
      return null;
    }
  }, [returnToParam]);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function validate(): boolean {
    if (measureStrength(password).score < 2) {
      setError(t('auth.weakPassword'));
      return false;
    }
    if (password !== confirmPassword) {
      setError(t('auth.passwordsDoNotMatch'));
      return false;
    }
    return true;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!validate()) return;

    setLoading(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    setLoading(false);

    if (signUpError) {
      setError(signUpError.message);
      return;
    }

    if (data.session) {
      navigate(safeReturnTo || '/create-business', { replace: true });
    } else {
      setSuccess(true);
    }
  }

  if (success) {
    return (
      <AuthShell title={t('auth.checkInbox')}>
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-50">
            <CheckCircle2 className="h-6 w-6 text-brand-500" />
          </div>
          <p className="text-sm text-gray-500">
            {t('auth.confirmationEmailSent', { email })}
          </p>
          {safeReturnTo && (
            <p className="text-xs text-gray-400">{t('auth.confirmInviteAfterEmail')}</p>
          )}
          <Link
            to={safeReturnTo ? `/login?returnTo=${encodeURIComponent(safeReturnTo)}` : '/login'}
            className="mt-2 text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            {t('auth.backToSignIn')}
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={partner ? branding.onboardingTitle : t('auth.createAccountTitle')}
      subtitle={
        partner
          ? branding.onboardingSubtitle ?? `Get started with ${branding.appName}`
          : safeReturnTo
            ? t('auth.createAccountInviteSubtitle')
            : t('auth.createAccountSubtitle')
      }
    >
      {safeReturnTo && (
        <div className="mb-4 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700">
          {t('auth.invitedRegisterNotice')}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <AuthAlert type="error" message={error} />}

        <FormField id="fullName" label={t('auth.fullName')}>
          <Input
            id="fullName"
            type="text"
            required
            autoComplete="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Alexander Gremu"
          />
        </FormField>

        <FormField id="email" label={t('common.email')}>
          <Input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@business.mw"
          />
        </FormField>

        <FormField id="password" label={t('auth.password')}>
          <PasswordInput
            id="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('auth.passwordPlaceholder')}
          />
          <PasswordStrengthMeter password={password} />
        </FormField>

        <FormField id="confirmPassword" label={t('auth.confirmPassword')}>
          <PasswordInput
            id="confirmPassword"
            required
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder={t('auth.samePasswordAgain')}
          />
        </FormField>

        <SubmitButton loading={loading} label={t('auth.createAccount')} loadingLabel={t('auth.creatingAccount')} />
      </form>

      <p className="mt-6 text-center text-sm text-gray-500">
        {t('auth.alreadyHaveAccount')}{' '}
        <Link
          to={safeReturnTo ? `/login?returnTo=${encodeURIComponent(safeReturnTo)}` : '/login'}
          className="font-medium text-brand-600 hover:text-brand-700"
        >
          {t('auth.signIn')}
        </Link>
      </p>
    </AuthShell>
  );
}
