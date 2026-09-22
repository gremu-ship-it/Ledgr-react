/**
 * R09.2 device/tab identity.
 *
 * Two separate, deliberately simple identifiers:
 *
 *  - INSTALL id  — stable per browser install (localStorage). Identifies the
 *    device in provenance (`originDeviceId`, evidence only).
 *  - TAB session id — stable per tab for that tab's lifetime
 *    (sessionStorage). Two tabs of the same browser/install always differ.
 *
 * A cross-tab replay lease claimant is the pair  install + tab . A user id
 * alone is never a lease identity (§6: a different signed-in user in another
 * tab of the same browser must not look like the same processor).
 *
 * Neither identifier is business data and neither is an authorization
 * credential: they appear only as evidence in provenance and as lease
 * ownership labels. R09.1's cache wipe deliberately does not enumerate them,
 * so an identity transition never retires an install id mid-session.
 */

const INSTALL_ID_KEY = 'ledgr_install_id';
const TAB_SESSION_ID_KEY = 'ledgr_tab_session_id';

function randomToken(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `tok-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function readOrCreate(storage: Storage | null, key: string): string {
  if (!storage) return randomToken();
  try {
    const existing = storage.getItem(key);
    if (existing) return existing;
    const created = randomToken();
    storage.setItem(key, created);
    return created;
  } catch {
    // Storage blocked (private mode): in-memory token for this document's
    // lifetime. Not durable across reload — meaning provenance simply shows
    // a shorter-lived device token; authority is never derived from it.
    return randomToken();
  }
}

let memoryInstall: string | null = null;
let memoryTab: string | null = null;

/** Stable per-install device id (localStorage-backed, fallback in-memory). */
export function getInstallId(): string {
  if (memoryInstall) return memoryInstall;
  const storage = typeof window !== 'undefined' ? window.localStorage : null;
  memoryInstall = readOrCreate(storage, INSTALL_ID_KEY);
  return memoryInstall;
}

/** Stable per-tab session id (sessionStorage-backed, fallback in-memory). */
export function getTabSessionId(): string {
  if (memoryTab) return memoryTab;
  const storage = typeof window !== 'undefined' ? window.sessionStorage : null;
  memoryTab = readOrCreate(storage, TAB_SESSION_ID_KEY);
  return memoryTab;
}

/** Lease claimant identity for this tab, e.g. `install-uuid/tab-uuid`. */
export function getLeaseClaimantId(): string {
  return `${getInstallId()}/${getTabSessionId()}`;
}

/** Test hook: reset the in-memory cache (storage itself is not cleared). */
export function resetDeviceIdentityForTests(): void {
  memoryInstall = null;
  memoryTab = null;
}
