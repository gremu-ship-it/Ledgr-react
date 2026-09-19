/**
 * Deterministic client keys — the idempotency tokens the offline queue and the
 * repository de-dupe lookups compare by equality.
 *
 * ## Why this module exists
 *
 * A sale is not one row: it is an invoice, one payment row per tender, and one
 * stock movement per line. Each of those needs its own key so that a replay
 * (queue retry, lost response, `retryNonCritical` second attempt) returns the
 * row instead of inserting a second one — but the keys must all derive from
 * the one key the queue item owns, because that is the only value that is
 * stable across attempts.
 *
 * The obvious spelling of that — `` `${clientKey}:pmt:${i}` `` — cannot be
 * stored: `client_key` is a **uuid** column
 * (20260813000003_add_client_key_idempotency.sql), and Postgres does not
 * implicitly cast text to uuid, so a compound string fails the insert with
 * 22P02 (`invalid input syntax for type uuid`) and the sale's payment or
 * stock row is never written. Casting is not an option either: the column
 * type wins, and there is no valid uuid whose text form contains `:pmt:`.
 *
 * So sub-keys are derived: `deriveClientKey(parentKey, ordinal)` returns a
 * real, valid uuid that is stable for the same inputs and different for every
 * ordinal. The parent key stays the readable, meaningful value; the derived
 * one is an opaque token whose only job is equality.
 *
 * ## Construction
 *
 * `hash(parentKey)` fills the first 18 hex digits (72 bits) and the ordinal
 * fills the last 12 — so two sub-keys of the *same* document can never collide
 * (distinct ordinals), and two documents can only collide if 72 bits of hash
 * agree (a birthday-bound far beyond any business's row count, and a collision
 * would surface as a loud unique-constraint violation rather than silent
 * corruption). The version/variant nibbles are set so the result is a
 * well-formed v4-shaped uuid, which keeps it acceptable to anything that
 * validates uuid shape.
 *
 * The parent key does not have to be a uuid (an import or a future caller may
 * mint something else) — the hash accepts any string, so the derivation never
 * depends on the parent's format.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether `value` is a hyphenated uuid — the only shape `client_key` accepts. */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** FNV-1a over a 32-bit lane. Cheap, dependency-free, and deterministic. */
function fnv1a32(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** The 12 hex digits the ordinal occupies: [0, 2^48). */
const MAX_ORDINAL = 0xffffffffffff;

/**
 * Fold anything into a usable ordinal. Ordinals are line/payment indices, so
 * the inputs are tiny integers — but a key derivation must never be the reason
 * a sale fails, so a bad input degrades to `0` (or to the top of the range)
 * rather than throwing or producing a malformed key.
 */
function clampOrdinal(ordinal: number): number {
  if (!Number.isFinite(ordinal)) return 0;
  return Math.min(Math.max(Math.trunc(ordinal), 0), MAX_ORDINAL);
}

/** `length` hex digits of a deterministic digest of `input`. */
function digestHex(input: string, length: number): string {
  let digest = '';
  for (let lane = 0; digest.length < length; lane += 1) {
    // Each lane re-hashes the same input under a different seed, so successive
    // lanes are independent enough to fill the digest rather than repeating a
    // truncated single-lane value.
    const seed = (0x811c9dc5 ^ Math.imul(lane + 1, 0x9e3779b9)) >>> 0;
    digest += fnv1a32(input, seed).toString(16).padStart(8, '0');
  }
  return digest.slice(0, length);
}

/**
 * A stable uuid for the `ordinal`-th row belonging to `parentKey`.
 *
 * Same inputs always produce the same key (that is what makes a retry safe),
 * and different ordinals always produce different keys (that is what keeps a
 * sale's second tender from colliding with its first).
 *
 * @param parentKey - the stable key of the owning document (a queue item's
 *   client key, an invoice id, …).
 * @param ordinal - which row of that document this is: a payment-leg index, a
 *   sale-line index. Must be a non-negative integer below 2^48; anything else
 *   is clamped rather than thrown, because a key derivation must never be the
 *   reason a sale fails.
 */
export function deriveClientKey(parentKey: string, ordinal = 0): string {
  const digest = digestHex(parentKey, 18);
  const tail = clampOrdinal(ordinal).toString(16).padStart(12, '0');

  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `4${digest.slice(12, 15)}`,
    `8${digest.slice(15, 18)}`,
    tail,
  ].join('-');
}
