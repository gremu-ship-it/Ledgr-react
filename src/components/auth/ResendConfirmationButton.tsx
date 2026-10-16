import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { AuthAlert } from '@/components/auth/AuthUI';

/**
 * Supabase Auth allows one signup-confirmation email per address per 60 seconds
 * and rejects faster requests. Mirror that here so the button is not left
 * enabled only to fail.
 */
export const RESEND_COOLDOWN_SECONDS = 60;

const RATE_LIMIT_CODES = new Set(['over_email_send_rate_limit', 'over_request_rate_limit']);

interface ResendConfirmationButtonProps {
  email: string;
  /** Where the confirmation link should send the user after they confirm. */
  emailRedirectTo: string;
}

/**
 * Lets someone who never received (or lost) their signup confirmation email ask
 * for a fresh one, instead of being stuck on "check your inbox".
 */
export function ResendConfirmationButton({ email, emailRedirectTo }: ResendConfirmationButtonProps) {
  const { t } = useTranslation();
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [cooldown]);

  async function handleResend() {
    setSending(true);
    setStatus(null);
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo },
    });
    setSending(false);

    if (error) {
      const code = (error as { code?: string }).code;
      const rateLimited = Boolean(code && RATE_LIMIT_CODES.has(code));
      // Only burn the cooldown when an email actually went out, or when the
      // server itself asked us to back off. Any other failure (network,
      // misconfiguration) must leave the button usable so the user can retry
      // straight away instead of staring at a 60s lockout.
      if (rateLimited) setCooldown(RESEND_COOLDOWN_SECONDS);
      setStatus({
        type: 'error',
        message: rateLimited ? t('auth.resendRateLimited') : error.message,
      });
      return;
    }
    setCooldown(RESEND_COOLDOWN_SECONDS);
    setStatus({ type: 'success', message: t('auth.resendConfirmationSent', { email }) });
  }

  const disabled = sending || cooldown > 0;
  const label = sending
    ? t('auth.resendingConfirmation')
    : cooldown > 0
      ? t('auth.resendConfirmationIn', { seconds: cooldown })
      : t('auth.resendConfirmation');

  return (
    <div className="space-y-2">
      {status && <AuthAlert type={status.type} message={status.message} />}
      <button
        type="button"
        onClick={() => void handleResend()}
        disabled={disabled}
        className="text-sm font-medium text-brand-600 hover:text-brand-700 disabled:cursor-not-allowed disabled:text-gray-400"
      >
        {label}
      </button>
    </div>
  );
}
