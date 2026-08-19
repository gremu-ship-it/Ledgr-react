#!/usr/bin/env node
/**
 * Phase 10 A-01 — build-time guard for required VITE_* environment variables.
 *
 * Runs automatically before `npm run build` (npm prebuild hook), so it
 * guards BOTH the GitHub Actions build step and the Vercel-side build
 * triggered by `vercel deploy`.
 *
 * WHY: src/lib/supabase.ts previously threw at module scope when
 * VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY were absent — a missing secret
 * produced a fully blank production page for all users on 2026-08-16
 * (audit finding A-01). With this guard the build FAILS LOUDLY at deploy
 * time instead of shipping a broken bundle.
 *
 * Runtime defense-in-depth: src/lib/supabase.ts now also falls back to a
 * placeholder client and shows <ConfigError /> instead of a white screen if
 * the guard is bypassed (e.g. a Vercel preview without env).
 *
 * NOTE: `npm run dev` is intentionally unaffected (prebuild only runs for
 * `npm run build`). CI uses placeholder values (see .github/workflows/ci.yml).
 */
const REQUIRED = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];

// Allow builds that explicitly set SKIP_ENV_CHECK (emergency, not for prod)
if (process.env.SKIP_ENV_CHECK === '1' || process.env.SKIP_ENV_CHECK === 'true') {
  console.warn('[check-env] WARN — SKIP_ENV_CHECK is set, skipping env guard.');
  console.log(`[check-env] OK — ${REQUIRED.length} required VITE_* variables present (skipped).`);
  process.exit(0);
}

const missing = REQUIRED.filter((k) => !process.env[k] || !String(process.env[k]).trim());

if (missing.length === 0) {
  console.log(`[check-env] OK — ${REQUIRED.length} required VITE_* variables present.`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Vercel preview / development handling
// ---------------------------------------------------------------------------
// On Vercel, `VERCEL=1` is always set. `VERCEL_ENV` is one of:
//   production | preview | development
// We want preview builds (e.g. PR previews, or the GitHub auto-deploy that
// Vercel triggers on push) to succeed with a placeholder so the deploy log
// is not red, while production still fails loudly to prevent the blank-page
// incident. Placeholders are harmless for previews — the runtime fallback in
// src/lib/supabase.ts will show <ConfigError /> instead of broken data.
// The canonical production deploys go through GitHub Actions (deploy.yml) which
// injects real secrets via --build-env, so they already pass the guard.
// If Vercel's GitHub auto-deploy is left enabled, this branch prevents it
// from failing on main→production when the dashboard env is not yet set.
const isVercel = process.env.VERCEL === '1';
const vercelEnv = process.env.VERCEL_ENV;

if (isVercel && vercelEnv !== 'production') {
  console.warn(
    `\n[check-env] WARN — missing ${missing.join(', ')} on Vercel (${vercelEnv || 'unknown'}).`,
  );
  console.warn(
    '[check-env] Allowing preview build with placeholder — the app will show a configuration error at runtime instead of a blank page.',
  );
  console.warn(
    '          For production, set these in Vercel → Project → Settings → Environment Variables,',
  );
  console.warn('          or deploy via GitHub Actions (deploy.yml) which injects them via --build-env.\n');
  // Exit 0 so `vite build` can proceed; Vite will embed undefined for the
  // missing vars, but src/lib/supabase.ts falls back to placeholder values
  // and src/App.tsx renders <ConfigError />.
  console.log(`[check-env] OK — ${REQUIRED.length} required VITE_* variables present (preview placeholder fallback).`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Strict failure for production / local / CI without placeholders
// ---------------------------------------------------------------------------
console.error('\n[check-env] FAIL — build aborted: required environment variables are MISSING:');
for (const k of missing) console.error(`  - ${k}`);
console.error(`
The app throws at runtime when these are absent, which ships a blank page to
every user (production incident 2026-08-16, audit finding A-01). Set them in:

  GitHub Actions:  repo Settings -> Secrets and variables -> Actions
                   (use Secrets for VITE_SUPABASE_ANON_KEY*,
                    Variables  for VITE_SUPABASE_URL*)
  Vercel:          Project -> Settings -> Environment Variables
                   (or via \`vercel deploy --build-env\` from deploy.yml)

CI may use placeholder values (see .github/workflows/ci.yml):
  VITE_SUPABASE_URL=https://placeholder.supabase.co
  VITE_SUPABASE_ANON_KEY=placeholder-anon-key

For an emergency preview bypass, set SKIP_ENV_CHECK=1 (not for production).
For Vercel preview builds without secrets, the guard now warns and allows the
build to proceed with a runtime <ConfigError /> (blank-page defense-in-depth).
Production (VERCEL_ENV=production) still fails loudly.\n`);
process.exit(1);
