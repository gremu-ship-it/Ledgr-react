// supabase/functions/_shared/crypto.ts
//
// Shared cryptographic helpers for Edge Functions. Previously each function
// pasted its own copy of these (7 files had duplicates) — drift between the
// copies is how verification bugs are born. This module is the single source.
//
// IMPORTANT: this module intentionally uses ONLY Web-standard APIs
// (crypto.subtle, TextEncoder) — no `Deno.*`, no npm imports — so it runs
// identically in Deno (Supabase Edge Runtime) and in Node for unit tests
// (see _shared/__tests__/crypto.test.ts, executed by vitest).

/** Hex-encoded HMAC-SHA256 of `payload`, keyed with `secret`. */
export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return toHex(sig);
}

/** Hex-encoded SHA-256 digest of `input` (used for API-key hashing). */
export async function sha256Hex(input: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)));
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Constant-time string equality for comparing hex signatures.
 *
 * Never use `===` to compare HMAC digests: a normal string compare short-circuits
 * on the first differing character, leaking how much of the guess was correct —
 * the classic timing side-channel against webhook signatures. This instead XORs
 * every character pair and ORs the accumulator, so runtime depends only on
 * length. (Length itself is not secret: valid hex SHA-256 is always 64 chars.)
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
