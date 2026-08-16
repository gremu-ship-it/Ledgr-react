#!/usr/bin/env node
/**
 * Phase 10 A-01 — build-time guard for required VITE_* environment variables.
 *
 * Runs automatically before `npm run build` (npm prebuild hook), so it
 * guards BOTH the GitHub Actions build step and the Vercel-side build
 * triggered by `vercel deploy`.
 *
 * WHY: src/lib/supabase.ts throws at module scope when VITE_SUPABASE_URL /
 * VITE_SUPABASE_ANON_KEY are absent — a missing secret produced a fully
 * blank production page for all users on 2026-08-16 (audit finding A-01).
 * With this guard the build FAILS LOUDLY at deploy time instead of
 * shipping a broken bundle.
 *
 * NOTE: `npm run dev` is intentionally unaffected (prebuild only runs for
 * `npm run build`). CI uses placeholder values (see .github/workflows/ci.yml).
 */
const REQUIRED = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];

const missing = REQUIRED.filter((k) => !process.env[k] || !String(process.env[k]).trim());

if (missing.length > 0) {
  console.error('\n[check-env] FAIL — build aborted: required environment variables are MISSING:');
  for (const k of missing) console.error(`  - ${k}`);
  console.error(`
The app throws at runtime when these are absent, which ships a blank page to
every user (production incident 2026-08-16, audit finding A-01). Set them in:

  GitHub Actions:  repo Settings -> Secrets and variables -> Actions
                   (use Secrets for VITE_SUPABASE_ANON_KEY*,
                    Variables  for VITE_SUPABASE_URL*)
  Vercel:          Project -> Settings -> Environment Variables

CI may use placeholder values (see .github/workflows/ci.yml).\n`);
  process.exit(1);
}

console.log(`[check-env] OK — ${REQUIRED.length} required VITE_* variables present.`);
