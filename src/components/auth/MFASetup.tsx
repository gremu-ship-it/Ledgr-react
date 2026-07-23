import { useState, useEffect, useCallback } from 'react';
import { Loader2, ShieldCheck, ShieldOff, Copy, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { OTPInput, AuthAlert } from '@/components/auth/AuthUI';
import type { Factor } from '@supabase/supabase-js';

interface MFASetupProps {
  onEnrolled?: () => void;
  onUnenrolled?: () => void;
}

type SetupStep = 'loading' | 'idle' | 'enrolling' | 'enabled';

export function MFASetup({ onEnrolled, onUnenrolled }: MFASetupProps) {
  const [step, setStep] = useState<SetupStep>('loading');
  const [enrolledFactor, setEnrolledFactor] = useState<Factor | null>(null);
  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');
  const [factorId, setFactorId] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadFactors = useCallback(async () => {
    setStep('loading');
    const { data } = await supabase.auth.mfa.listFactors();
    const verified = data?.totp?.[0] ?? null;
    setEnrolledFactor(verified);
    setStep(verified ? 'enabled' : 'idle');
  }, []);

  useEffect(() => { void loadFactors(); }, [loadFactors]);

  async function startEnrollment() {
    setError(null); setLoading(true);
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: 'totp', issuer: 'Ledgr', friendlyName: 'Ledgr Authenticator',
    });
    setLoading(false);
    if (enrollError || !data) { setError(enrollError?.message ?? 'Failed to start 2FA setup.'); return; }
    setFactorId(data.id);
    setQrCode(`data:image/svg+xml;utf8,${encodeURIComponent(data.totp.qr_code)}`);
    setSecret(data.totp.secret);
    setStep('enrolling');
  }

  async function handleVerify() {
    if (otpCode.length !== 6) { setError('Enter the 6-digit code from your authenticator app.'); return; }
    setError(null); setLoading(true);
    const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeError) { setLoading(false); setError(challengeError.message); return; }
    const { error: verifyError } = await supabase.auth.mfa.verify({ factorId, challengeId: challengeData.id, code: otpCode });
    setLoading(false);
    if (verifyError) { setError("Incorrect code. Make sure your phone's clock is synced."); setOtpCode(''); return; }
    await loadFactors(); onEnrolled?.();
  }

  async function handleUnenroll() {
    if (!enrolledFactor) return;
    if (!window.confirm('Are you sure you want to disable two-factor authentication?')) return;
    setLoading(true);
    const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: enrolledFactor.id });
    setLoading(false);
    if (unenrollError) { setError(unenrollError.message); return; }
    await loadFactors(); onUnenrolled?.();
  }

  function copySecret() {
    void navigator.clipboard.writeText(secret);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }

  if (step === 'loading') return <div className="flex items-center gap-2 py-4 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />Checking 2FA status…</div>;

  if (step === 'enabled') return (
    <div className="space-y-4">
      {error && <AuthAlert type="error" message={error} />}
      <div className="flex items-center gap-3 rounded-xl bg-brand-500/10 px-4 py-3">
        <ShieldCheck className="h-5 w-5 shrink-0 text-brand-600 dark:text-brand-300" />
        <div>
          <p className="text-sm font-semibold text-brand-700 dark:text-brand-300">Two-factor authentication is enabled</p>
          <p className="text-xs text-brand-600 dark:text-brand-300">Your account is protected with TOTP authentication.</p>
        </div>
      </div>
      <button onClick={() => void handleUnenroll()} disabled={loading}
        className="flex items-center gap-2 rounded-lg border border-danger/20 bg-danger/10 px-4 py-2 text-sm font-medium text-danger hover:bg-danger/10 disabled:opacity-50">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldOff className="h-4 w-4" />}
        Disable two-factor authentication
      </button>
    </div>
  );

  if (step === 'enrolling') return (
    <div className="space-y-5">
      {error && <AuthAlert type="error" message={error} />}
      <div className="text-sm text-sub">
        <p className="font-medium text-ink">Step 1 — Scan the QR code</p>
        <p className="mt-1">Open Google Authenticator, Authy, or any TOTP app and scan below.</p>
      </div>
      <div className="flex justify-center">
        <img src={qrCode} alt="TOTP QR code" className="h-44 w-44 rounded-xl border border-line bg-card p-2" />
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-muted">Can't scan? Enter this secret manually:</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-lg bg-surface px-3 py-2 font-mono text-xs tracking-widest text-sub">{secret}</code>
          <button onClick={copySecret} className="shrink-0 rounded-lg border border-line p-2 text-muted hover:bg-bg">
            {copied ? <Check className="h-4 w-4 text-brand-600 dark:text-brand-400" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-ink">Step 2 — Enter the 6-digit code to verify</p>
        <OTPInput value={otpCode} onChange={setOtpCode} disabled={loading} />
      </div>
      <div className="flex gap-3">
        <button onClick={() => { setStep('idle'); setOtpCode(''); setError(null); }}
          className="flex-1 rounded-lg border border-line py-2.5 text-sm font-medium text-sub hover:bg-bg">Cancel</button>
        <button onClick={() => void handleVerify()} disabled={loading || otpCode.length !== 6}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}Enable 2FA
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {error && <AuthAlert type="error" message={error} />}
      <div className="rounded-xl border border-line bg-bg px-4 py-3">
        <p className="text-sm font-medium text-sub">Two-factor authentication is not enabled</p>
        <p className="mt-0.5 text-xs text-muted">Add an extra layer of security with a TOTP authenticator app.</p>
      </div>
      <button onClick={() => void startEnrollment()} disabled={loading}
        className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
        Set up two-factor authentication
      </button>
    </div>
  );
}