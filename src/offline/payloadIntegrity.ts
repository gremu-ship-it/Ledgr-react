/**
 * R09.3 integrity hardening — capture-time payload hash.
 *
 * The offline queue lives in a browser-visible store. R09.2 protects WHO an
 * item belongs to (provenance), but provenance cannot notice when the
 * PAYLOAD itself is edited after capture (DevTools, extension, corrupted
 * store). A tampered financial payload that reaches replay would still face
 * every server authority (membership, branch, shift, stock, quota), but it
 * would no longer be the transaction the user actually performed — so it
 * must never leave the device at all.
 *
 * Mechanism: enqueue computes SHA-256 over the payload's canonical JSON
 * (keys sorted recursively, array order preserved — JSON.stringify
 * semantics, deterministic across engines). Every replay decision point
 * (sync loop, deferred replay, reconciliation) re-hashes the stored row and
 * compares. Mismatch ⇒ quarantine 'payload-tampered' — an integrity class:
 * durable, visible, never retried, never reconcilable.
 *
 * Deliberate boundary: rows captured before v3 carry no hash and are
 * verified as "unknown" (allowed), keeping R09.2 behaviour for them; only
 * v3+ rows are hash-enforced. Verification is EVIDENCE, not authority — the
 * server's own validation remains the final word on every replay.
 */
import type { QueueItem } from './db';

/** Recursively sort object keys so equal payloads hash identically anywhere. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const input = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      const v = input[key];
      if (v === undefined) continue; // JSON.stringify drops undefined props
      out[key] = canonicalize(v);
    }
    return out;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return null; // JSON semantics
  return value;
}

/** Canonical JSON string for a queue payload (deterministic key order). */
export function canonicalPayloadJson(payload: unknown): string {
  return JSON.stringify(canonicalize(payload));
}

/** SHA-256 (lowercase hex) of the canonical payload JSON. */
export async function hashQueuePayload(payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalPayloadJson(payload));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * False when the stored payload no longer matches its capture-time hash.
 * Items WITHOUT a hash (pre-v3 rows) verify as OK: nothing was ever recorded
 * to compare against, and inventing one now would fabricate evidence.
 */
export async function verifyPayloadIntegrity(item: QueueItem): Promise<boolean> {
  if (!item.payloadHash) return true;
  return (await hashQueuePayload(item.payload)) === item.payloadHash;
}
