import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { PasswordStrengthMeter, measureStrength } from '@/components/auth/AuthUI';

export function RegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnToParam = searchParams.get('returnTo');
  const getSafeReturnUrl = (): string | null => {
    if (!returnToParam) return null;
    try {
      const decoded = decodeURIComponent(returnToParam);
      if (decoded.startsWith('http')) {
        const url = new URL(decoded);
        if (url.origin === window.location.origin) {
          return url.pathname + url.search + url.hash;
        }
        return null;
      }
      if (decoded.startsWith('/')) return decoded;
      return null;
    } catch {
      return null;
    }
  };
  const safeReturnTo = getSafeReturnUrl();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function validate(): boolean {
    if (measureStrength(password).score < 2) {
      setError('Password is too weak. Use at least 8 characters with letters and numbers.');
      return false;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
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
    if (signUpError) { setError(signUpError.message); return; }
    if (data.session) {
      if (safeReturnTo) {
        navigate(safeReturnTo, { replace: true });
      } else {
        navigate('/create-business', { replace: true });
      }
    } else { setSuccess(true); }
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-soft">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50">
            <CheckCircle2 className="h-6 w-6 text-brand-500" />
          </div>
          <h1 className="text-lg font-semibold text-gray-900">Check your inbox</h1>
          <p className="mt-2 text-sm text-gray-500">
            We've sent a confirmation link to <span className="font-medium">{email}</span>.
            Confirm your email to finish setting up your account.
          </p>
          {safeReturnTo && (
            <p className="mt-2 text-xs text-gray-400">After confirming, you’ll be able to sign in and accept your invitation, or ask the business owner to add you via Settings → Team Members.</p>
          )}
          <Link to={safeReturnTo ? `/login?returnTo=${encodeURIComponent(safeReturnTo)}` : '/login'} className="mt-5 inline-block text-sm font-medium text-brand-600 hover:text-brand-700">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500 text-lg font-bold text-white">L</div>
          <h1 className="text-xl font-semibold text-gray-900">Create your Ledgr account</h1>
          <p className="mt-1 text-sm text-gray-500">{safeReturnTo ? 'Create an account to accept your invitation' : 'Start managing your business finances'}</p>
          {safeReturnTo && (
            <div className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700">
              You were invited to join a business. After creating your account you’ll be taken back to accept the invitation. The business owner can also add you via email in Settings → Team Members once you’ve registered.
            </div>
          )}
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-soft">
          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
            </div>
          )}
          <div>
            <label htmlFor="fullName" className="mb-1.5 block text-sm font-medium text-gray-700">Full name</label>
            <input id="fullName" type="text" required autoComplete="name" value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              placeholder="Alexander Gremu" />
          </div>
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-gray-700">Email</label>
            <input id="email" type="email" required autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              placeholder="you@business.mw" />
          </div>
          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-gray-700">Password</label>
            <div className="relative">
              <input id="password" type={showPassword ? 'text' : 'password'} required minLength={8}
                autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                placeholder="At least 8 characters" />
              <button type="button" onClick={() => setShowPassword((v) => !v)} tabIndex={-1}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-xs text-gray-400 hover:text-gray-600">
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <PasswordStrengthMeter password={password} />
          </div>
          <div>
            <label htmlFor="confirmPassword" className="mb-1.5 block text-sm font-medium text-gray-700">Confirm password</label>
            <input id="confirmPassword" type={showPassword ? 'text' : 'password'} required
              autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              placeholder="Same password again" />
          </div>
          <button type="submit" disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-gray-500">
          Already have an account?{' '}
          <Link to={safeReturnTo ? `/login?returnTo=${encodeURIComponent(safeReturnTo)}` : '/login'} className="font-medium text-brand-600 hover:text-brand-700">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
