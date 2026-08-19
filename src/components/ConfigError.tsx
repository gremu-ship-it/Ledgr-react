import { AlertTriangle, ExternalLink } from 'lucide-react';

/**
 * Shown when the Supabase env vars are missing at runtime.
 * This is the defense-in-depth fallback for audit A-01: instead of the
 * module-scope throw in src/lib/supabase.ts blanking the page (incident
 * 2026-08-16), we render a readable error that tells the operator how to fix
 * the deployment. The build-time guard (scripts/check-env.mjs) already fails
 * production builds without secrets — this component only appears if that guard
 * was bypassed or a preview build ran without env.
 */
export function ConfigError() {
  return (
    <div
      className="flex min-h-screen w-full flex-col items-center justify-center bg-gray-50 p-8 text-center"
      role="alert"
      data-testid="config-error"
    >
      <div className="max-w-lg rounded-2xl border border-amber-200 bg-white p-8 shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50">
          <AlertTriangle className="h-6 w-6 text-amber-600" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-gray-900">Configuration error</h1>
        <p className="mt-2 text-sm leading-6 text-gray-700">
          Ledgr could not connect to Supabase because the required environment variables are
          missing:
        </p>
        <code className="mt-3 block rounded bg-gray-900 px-3 py-2 text-left text-xs font-mono text-gray-100">
          VITE_SUPABASE_URL
          <br />
          VITE_SUPABASE_ANON_KEY
        </code>
        <p className="mt-3 text-sm leading-6 text-gray-700">
          If you see this in production, the deployment shipped without secrets and would
          previously have shown a blank page (incident 2026-08-16, audit A-01). The build
          should have failed — check the deploy logs.
        </p>
        <div className="mt-6 space-y-2 text-left text-sm">
          <p className="font-medium text-gray-900">Fix it:</p>
          <ul className="list-disc space-y-1 pl-5 text-gray-700">
            <li>
              <span className="font-mono">Vercel</span> → Project → Settings → Environment
              Variables
            </li>
            <li>
              <span className="font-mono">GitHub Actions</span> → repo Settings → Secrets and
              variables → Actions
              <br />
              <span className="text-xs text-gray-500">
                Use <em>Secrets</em> for <code>VITE_SUPABASE_ANON_KEY</code>, <em>Variables</em>{' '}
                for <code>VITE_SUPABASE_URL</code>. CI may use placeholders (
                <code>https://placeholder.supabase.co</code>).
              </span>
            </li>
            <li>
              Local dev → copy <code>.env.example</code> to <code>.env</code> and fill the
              values.
            </li>
          </ul>
        </div>
        <a
          href="https://github.com/gremu-ship-it/Ledgr-react/blob/main/DEPLOYMENT.md"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:text-brand-800"
        >
          Deployment docs <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
      </div>
      <p className="mt-6 max-w-lg text-xs text-gray-500">
        This page is shown instead of a blank screen so the misconfiguration is obvious. Once the
        variables are set, redeploy the app.
      </p>
    </div>
  );
}
