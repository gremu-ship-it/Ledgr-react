// supabase/functions/_shared/cronAuth.ts
//
// Fail-closed, constant-time auth for scheduled Edge Functions.
//
// Rules:
//   - If no secret is configured, reject every request (including empty
//     x-cron-secret). An unconfigured cron job must never become public.
//   - Compare with timingSafeEqual so the shared secret is not leaked by
//     response-time variation.
//   - Accept the first configured env var from `envNames` so invoice
//     automation (INVOICE_CRON_SECRET) can fall back to CRON_SECRET —
//     deploy.yml currently only sets CRON_SECRET.

import { timingSafeEqual } from './crypto.ts';

export function readConfiguredSecret(envNames: string[] = ['CRON_SECRET']): string | null {
  for (const name of envNames) {
    let value: string | undefined;
    try {
      value = Deno.env.get(name);
    } catch {
      value = undefined;
    }
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

export function isCronRequest(req: Request, envNames?: string[]): boolean {
  const configured = readConfiguredSecret(envNames);
  if (!configured) return false;
  const provided = req.headers.get('x-cron-secret') ?? '';
  return timingSafeEqual(provided, configured);
}

/** 401 response when the request is not an authorised cron invocation. */
export function unauthorizedCronResponse(req: Request, envNames?: string[]): Response | null {
  if (isCronRequest(req, envNames)) return null;
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
