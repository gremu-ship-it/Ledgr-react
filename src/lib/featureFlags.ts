/**
 * Phase 10.4 — lightweight, env-based feature flags.
 *
 * Flags are read from VITE_FEATURE_* build-time env vars so a deploy can
 * toggle behaviour without a code change, while keeping the source of truth
 * visible in the repo. Usage:
 *
 *   if (isFeatureEnabled('ai_agent')) { ... }
 *
 * Vercel / GitHub Actions can set VITE_FEATURE_<NAME>=true|false per
 * environment. Defaults live here so the app works with no configuration.
 */
const FLAG_PREFIX = 'VITE_FEATURE_';

const DEFAULTS: Record<string, boolean> = {
  /** AI Insights / support agent surface (set false to hide). */
  ai_agent: true,
  /** Experimental features gated behind a flag. */
  experimental: false,
};

function envName(flag: string): string {
  return `${FLAG_PREFIX}${flag.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`;
}

export function isFeatureEnabled(flag: string): boolean {
  const raw = (import.meta.env as Record<string, string | undefined>)[envName(flag)];
  if (raw === undefined) return DEFAULTS[flag] ?? false;
  return raw === 'true' || raw === '1';
}

export function featureFlagValue(flag: string, fallback = ''): string {
  return (import.meta.env as Record<string, string | undefined>)[envName(flag)] ?? fallback;
}
