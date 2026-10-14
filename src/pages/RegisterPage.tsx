import { useState, type FormEvent, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
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
import { ResendConfirmationButton } from '@/components/auth/ResendConfirmationButton';

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

  // Where the confirmation link should land once the email is confirmed. The
  // same destination the user would reach after an immediate sign-up (no
  // confirmation needed). Supabase only honours URLs on its redirect allow-list
  // and otherwise falls back to the project Site URL.
  const confirmRedirectTo = `${window.location.origin}${safeReturnTo || '/create-business'}`;

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  // Set when the address already has an account. Supabase answers such a
  // sign-up with a fake success (an obfuscated user whose `identities` list
  // is empty) and sends NO email, so the generic "check your inbox" screen
  // would promise a link that is never coming.
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
  // Set when the account was created but GoTrue throttled the confirmation
  // email itself (built-in mailer / rate limit). The user exists but has
  // nothing in their inbox yet — the resend action below is the way out.
  const [emailThrottled, setEmailThrottled] = useState(false);

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

    // Normalise exactly like LoginPage does. Sign-up, resend and sign-in must
    // all address the same inbox — a stray space or capital in "Owner@…"
    // otherwise sends the confirmation somewhere the login never looks.
    const normalizedEmail = email.trim().toLowerCase();
    setEmail(normalizedEmail);

    setLoading(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: confirmRedirectTo,
      },
    });
    setLoading(false);

    if (signUpError) {
      const code = (signUpError as { code?: string }).code;
      const status = (signUpError as { status?: number }).status;
      if (code === 'user_already_exists' || code === 'email_exists') {
        // Some project configs answer a duplicate sign-up with a real error
        // instead of the obfuscated success handled below.
        setAlreadyRegistered(true);
        return;
      }
      if (code === 'over_email_send_rate_limit' || status === 429) {
        // The account was created but the confirmation email was throttled
        // (Supabase's built-in mailer allows only a few emails/hour without
        // custom SMTP). Still land on "check your inbox" so the resend
        // action is available once the window passes, and say plainly why
        // nothing may have arrived yet.
        setEmailThrottled(true);
        setSuccess(true);
        return;
      }
      setError(signUpError.message);
      return;
    }

    if (data.session) {
      navigate(safeReturnTo || '/create-business', { replace: true });
      return;
    }

    // Anti-enumeration fake success: when the address is already registered,
    // GoTrue returns an obfuscated user with no identities and sends NO
    // confirmation email. Telling this user to "check your inbox" strands
    // them — they need sign-in / password reset instead.
    const identities = (data.user as { identities?: unknown[] } | null)?.identities;
    if (data.user && Array.isArray(identities) && identities.length === 0) {
      setAlreadyRegistered(true);
      return;
    }

    setSuccess(true);
  }

  const loginHref = safeReturnTo ? `/login?returnTo=${encodeURIComponent(safeReturnTo)}` : '/login';

  if (alreadyRegistered) {
    return (
      <AuthShell title={t('auth.checkInbox')}>
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <AuthAlert type="info" message={t('auth.accountAlreadyExists', { email })} />
          <Link
            to={loginHref}
            className="mt-2 text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            {t('auth.signIn')}
          </Link>
          <Link to="/forgot-password" className="text-sm font-medium text-brand-600 hover:text-brand-700">
            {t('auth.forgotPassword')}
          </Link>
        </div>
      </AuthShell>
    );
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
          <p className="text-xs text-gray-600">{t('auth.checkSpamFolder')}</p>
          {emailThrottled && <AuthAlert type="info" message={t('auth.signUpRateLimited')} />}
          <ResendConfirmationButton email={email} emailRedirectTo={confirmRedirectTo} />
          {safeReturnTo && (
            <p className="text-xs text-gray-600">{t('auth.confirmInviteAfterEmail')}</p>
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
