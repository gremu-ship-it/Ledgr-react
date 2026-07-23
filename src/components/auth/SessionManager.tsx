import { useState, useEffect, useCallback } from 'react';
import { Loader2, Monitor, LogOut, RefreshCw, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { AuthAlert } from '@/components/auth/AuthUI';
import type { User } from '@supabase/supabase-js';

interface SessionInfo {
  issuedAt: Date;
  expiresAt: Date;
  lastSignInAt: string | null;
  email: string | null;
  provider: string;
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  try {
    const base64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64)) as Record<string, unknown>;
  } catch { return {}; }
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getBrowserName(): string {
  const ua = navigator.userAgent;
  if (ua.includes('Edg/')) return 'Microsoft Edge';
  if (ua.includes('Firefox/')) return 'Firefox';
  if (ua.includes('Chrome/')) return 'Chrome';
  if (ua.includes('Safari/')) return 'Safari';
  return 'Unknown browser';
}

function getOSName(): string {
  const ua = navigator.userAgent;
  if (ua.includes('Win')) return 'Windows';
  if (ua.includes('Mac')) return 'macOS';
  if (ua.includes('Android')) return 'Android';
  if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
  if (ua.includes('Linux')) return 'Linux';
  return 'Unknown OS';
}

export function SessionManager() {
  const [user, setUser] = useState<User | null>(null);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState<'local' | 'global' | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadSession = useCallback(async () => {
    setLoading(true); setError(null);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    const { data: sessionData } = await supabase.auth.getSession();
    setLoading(false);
    if (userError || !userData.user) { setError('Could not load session information.'); return; }
    setUser(userData.user);
    if (sessionData.session) {
      const payload = decodeJwtPayload(sessionData.session.access_token);
      setSessionInfo({
        issuedAt: new Date((payload.iat as number) * 1000),
        expiresAt: new Date((payload.exp as number) * 1000),
        lastSignInAt: userData.user.last_sign_in_at ?? null,
        email: userData.user.email ?? null,
        provider: (userData.user.app_metadata?.provider as string) ?? 'email',
      });
    }
  }, []);

  useEffect(() => { void loadSession(); }, [loadSession]);

  async function handleSignOut(scope: 'local' | 'global') {
    if (scope === 'global' && !window.confirm('This will sign you out of all devices. Continue?')) return;
    setSigningOut(scope); setError(null); setSuccess(null);
    const { error: signOutError } = await supabase.auth.signOut({ scope });
    if (signOutError) { setSigningOut(null); setError(signOutError.message); return; }
    if (scope === 'local') setSuccess('Signed out from this device.');
  }

  if (loading) return <div className="flex items-center gap-2 py-4 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />Loading session information…</div>;

  return (
    <div className="space-y-5">
      {error && <AuthAlert type="error" message={error} />}
      {success && <AuthAlert type="success" message={success} />}
      {sessionInfo && (
        <div className="rounded-xl border border-brand-100 bg-brand-500/10/50 p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/10">
              <Monitor className="h-5 w-5 text-brand-600 dark:text-brand-300" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-ink">{getBrowserName()} on {getOSName()}</p>
                <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-xs font-medium text-brand-700 dark:text-brand-300">This device</span>
              </div>
              <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-muted sm:grid-cols-2">
                {sessionInfo.lastSignInAt && <><dt className="font-medium text-sub">Last sign-in</dt><dd>{formatDate(new Date(sessionInfo.lastSignInAt))}</dd></>}
                <dt className="font-medium text-sub">Session started</dt><dd>{formatDate(sessionInfo.issuedAt)}</dd>
                <dt className="font-medium text-sub">Session expires</dt><dd>{formatDate(sessionInfo.expiresAt)}</dd>
                <dt className="font-medium text-sub">Auth provider</dt><dd className="capitalize">{sessionInfo.provider}</dd>
                <dt className="font-medium text-sub">Account</dt><dd className="truncate">{sessionInfo.email}</dd>
              </dl>
            </div>
          </div>
        </div>
      )}
      <div className="flex items-start gap-2 rounded-lg border border-warning/20 bg-warning/12 px-3 py-2.5 text-xs text-warning">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>Per-session revocation across other devices requires a server-side Admin API call. Use <strong>Sign out everywhere</strong> to terminate all active sessions.</span>
      </div>
      {user && <div className="text-xs text-muted">User ID: <code className="font-mono">{user.id}</code></div>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <button onClick={() => void loadSession()} disabled={loading || !!signingOut}
          className="flex items-center justify-center gap-2 rounded-lg border border-line px-4 py-2.5 text-sm font-medium text-sub hover:bg-bg disabled:opacity-50">
          <RefreshCw className="h-4 w-4" />Refresh
        </button>
        <button onClick={() => void handleSignOut('local')} disabled={!!signingOut}
          className="flex items-center justify-center gap-2 rounded-lg border border-line px-4 py-2.5 text-sm font-medium text-sub hover:bg-bg disabled:opacity-50">
          {signingOut === 'local' ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
          Sign out this device
        </button>
        <button onClick={() => void handleSignOut('global')} disabled={!!signingOut}
          className="flex items-center justify-center gap-2 rounded-lg border border-danger/20 px-4 py-2.5 text-sm font-medium text-danger hover:bg-danger/10 disabled:opacity-50">
          {signingOut === 'global' ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
          Sign out everywhere
        </button>
      </div>
    </div>
  );
}