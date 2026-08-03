// supabase/functions/_shared/crypto.ts
//
// AES-GCM encryption for secrets stored at rest (e.g. Facebook Page access
// tokens in social_connections). The key is the base64 of 32 random bytes,
// configured as the SOCIAL_TOKEN_ENC_KEY secret:
//
//   openssl rand -base64 32 | supabase secrets set SOCIAL_TOKEN_ENC_KEY=-
//
// Never expose the key or decrypted tokens to the browser. The browser only
// ever sees whether a connection exists and the (non-sensitive) page name/id.

const subtle = globalThis.crypto.subtle;

function env(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function getKey(): Promise<CryptoKey> {
  const raw = env('SOCIAL_TOKEN_ENC_KEY');
  if (!raw) {
    throw new Error('SOCIAL_TOKEN_ENC_KEY secret is not set');
  }
  const bytes = b64ToBytes(raw.trim());
  if (bytes.length !== 32) {
    throw new Error('SOCIAL_TOKEN_ENC_KEY must be the base64 of 32 bytes (256-bit)');
  }
  return subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Encrypt a plaintext string → base64(iv ‖ ciphertext). */
export async function encryptSecret(plain: string): Promise<string> {
  const key = await getKey();
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain)));
  const combined = new Uint8Array(iv.length + ct.length);
  combined.set(iv, 0);
  combined.set(ct, iv.length);
  return bytesToB64(combined);
}

/** Decrypt a base64(iv ‖ ciphertext) → plaintext string. Returns '' on failure. */
export async function decryptSecret(blob: string): Promise<string> {
  if (!blob) return '';
  try {
    const key = await getKey();
    const combined = b64ToBytes(blob);
    const iv = combined.slice(0, 12);
    const ct = combined.slice(12);
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(pt);
  } catch {
    return '';
  }
}

/** True when an encryption key is configured (i.e. token storage is available). */
export function encryptionConfigured(): boolean {
  return Boolean(env('SOCIAL_TOKEN_ENC_KEY'));
}
