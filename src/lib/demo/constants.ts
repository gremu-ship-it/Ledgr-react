/**
 * Demo-mode constants.
 *
 * The demo is a **client-side** sandbox: `demo@ledgr.test` is not a Supabase
 * user and no request ever leaves the browser. Everything a demo visitor sees
 * is generated locally from `dataset.ts` and persisted in their own
 * localStorage (see `store.ts`), so:
 *
 *   - the marketing site (any origin, any Vercel project) only needs to link
 *     to `DEMO_ENTRY_PATH`;
 *   - no credentials ship in the bundle;
 *   - two visitors can never see each other's demo writes.
 *
 * These ids are stable, valid-shaped UUIDs so foreign keys, React keys and
 * `.eq('id', …)` filters all behave like the real thing.
 */

/** The demo account's email — shown in the header and user menu. */
export const DEMO_EMAIL = 'demo@ledgr.test';

/** Display name for the demo user (user_profiles.full_name). */
export const DEMO_USER_NAME = 'Demo Owner';

/** auth.users-shaped id of the demo user (also user_profiles.id). */
export const DEMO_USER_ID = 'de110000-0000-4000-8000-0000000000a1';

/** businesses.id of the demo tenant. */
export const DEMO_BUSINESS_ID = 'de110000-0000-4000-8000-0000000000b1';

/** business_users.id linking the demo user to the demo business. */
export const DEMO_MEMBERSHIP_ID = 'de110000-0000-4000-8000-0000000000c1';

/** Role the demo user holds — owner unlocks every module in the UI. */
export const DEMO_ROLE = 'owner';

/** Plan tier of the demo business, so plan gates never hide features. */
export const DEMO_PLAN_TIER = 'pro';

/** Route that puts the visitor straight into the demo account. */
export const DEMO_ENTRY_PATH = '/demo/enter';

/** Route of the static, no-backend product tour. */
export const DEMO_TOUR_PATH = '/demo';

/** localStorage key holding the "am I in demo mode" flag. */
export const DEMO_MODE_KEY = 'ledgr-demo-mode';

/**
 * localStorage key holding the mutable demo dataset. Versioned on purpose:
 * bump `DEMO_STATE_VERSION` whenever the seed shape changes so returning
 * visitors are reseeded instead of loading rows that no longer match the
 * schema the UI expects.
 */
export const DEMO_STATE_KEY = 'ledgr-demo-state';
export const DEMO_STATE_VERSION = 1;

/**
 * How long a seeded demo stays usable before it is automatically reset to the
 * pristine seed ("nightly reset" for a per-browser sandbox). 24h matches the
 * marketing copy and keeps localStorage from accreting visitor experiments.
 */
export const DEMO_RESET_AFTER_MS = 24 * 60 * 60 * 1000;

/** Human-readable label for the auto-reset window (used in the banner). */
export const DEMO_RESET_LABEL = '24 hours';

/**
 * Bump this whenever the *shape* of the seed changes in a way that would make
 * an older persisted snapshot render incorrectly (new required column, renamed
 * table, different ids). Changing only amounts/dates does not need a bump —
 * the auto-reset covers that.
 */
export function demoStateStorageKey(): string {
  return `${DEMO_STATE_KEY}:v${DEMO_STATE_VERSION}`;
}

/**
 * Deterministic, UUID-v4-shaped id. The same `(namespace, n)` pair always
 * yields the same id, which keeps relations inside the seed stable across
 * reseeds (invoice → lines → payments → journals) and makes debugging easy.
 */
export function demoUuid(namespace: string, n: number | string): string {
  const bytes: number[] = [];
  for (let i = 0; i < 16; i += 2) {
    // FNV-1a over the namespace + index + byte position.
    const s = `${namespace}:${n}#${i}`;
    let h = 0x811c9dc5;
    for (let j = 0; j < s.length; j++) {
      h ^= s.charCodeAt(j);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    bytes.push(h & 0xff, (h >>> 8) & 0xff);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** `true` for strings that look like a UUID — used by tests and by `.eq` filters. */
export function isUuidShaped(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}
