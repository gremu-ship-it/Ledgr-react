/**
 * Shared cryptographic primitives used by the browser app.
 *
 * The Edge Functions keep an equivalent copy in
 * `supabase/functions/_shared/crypto.ts` because Deno cannot import from
 * `src/`. Keep the two implementations bit-identical.
 */

/**
 * Constant-time string compare. Returns false when lengths differ (the
 * length is not secret for our callers: HMAC hex digests and configured
 * cron secrets are fixed-length).
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
