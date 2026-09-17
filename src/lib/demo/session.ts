/**
 * Entering and leaving the demo account.
 *
 * `enterDemoMode()` is the whole "sign in without credentials" flow:
 *
 *   1. flip the demo flag (so `src/lib/supabase.ts` starts serving the demo
 *      client instead of the real one),
 *   2. make sure a seeded dataset exists — `getDemoState()` reseeds when the
 *      snapshot is older than the reset window,
 *   3. write the demo identity into the app store exactly the way
 *      `useAuthListener` would after a real sign-in, so `ProtectedRoute`,
 *      `usePermissions` and every business-scoped hook see a normal session,
 *   4. clear the React Query cache so no rows from a previous (real or demo)
 *      account can bleed into the tour.
 *
 * `exitDemoMode()` reverses it and purges per-user state, mirroring the
 * sign-out path in `useAuthListener.purgeAllUserData()`.
 */

import { useAppStore } from '@/store/useAppStore';
import { useNotificationStore } from '@/store/useNotificationStore';
import { queryClient } from '@/lib/queryClient';
import { createLogger } from '@/lib/logger';
import { DEMO_BUSINESS_ID, DEMO_ROLE, DEMO_USER_ID } from './constants';
import { loadDemoClient } from './loader';
import { isDemoMode, setDemoMode } from './mode';
import type { DemoRow, DemoTables } from './dataset';

const log = createLogger('demoSession');

export { isDemoMode };

/** Read the demo business row from the seeded tables. */
function demoBusinessRow(tables: DemoTables): DemoRow {
  return (
    (tables.businesses ?? []).find((b) => b.id === DEMO_BUSINESS_ID) ?? {
      id: DEMO_BUSINESS_ID,
      name: 'Ledgr Demo',
      base_currency: 'MWK',
      plan_tier: 'pro',
    }
  );
}

/**
 * Push the demo identity into the app store. Idempotent — safe to call on
 * every mount while the flag is set (e.g. after a hard refresh deep inside
 * the demo).
 *
 * Async because the seeded tables live in a lazily loaded chunk; the demo
 * engine is ready by the time this resolves, which is what makes it safe for
 * `ProtectedRoute` to let the app render and start querying.
 */
export async function hydrateDemoSession(): Promise<void> {
  const [{ getDemoState }] = await Promise.all([import('./store'), loadDemoClient()]);
  const tables = getDemoState().tables;

  const store = useAppStore.getState();
  const business = demoBusinessRow(tables);
  const profile = (tables.user_profiles ?? []).find((p) => p.id === DEMO_USER_ID);

  const membership = {
    id: undefined,
    role: DEMO_ROLE,
    business: {
      id: String(business.id),
      name: String(business.name ?? 'Ledgr Demo'),
      base_currency: (business.base_currency as string | undefined) ?? 'MWK',
      plan_tier: (business.plan_tier as string | undefined) ?? 'pro',
    },
  };

  store.setCurrentUser({
    id: DEMO_USER_ID,
    email: profile ? String(profile.email ?? 'demo@ledgr.test') : 'demo@ledgr.test',
    profile: {
      full_name: profile ? String(profile.full_name ?? 'Demo Owner') : 'Demo Owner',
      avatar_url: null,
      preferred_language: (profile?.preferred_language as 'en' | undefined) ?? 'en',
      is_platform_admin: false,
    },
  });
  store.setBusinesses([membership]);
  store.setCurrentBusiness(membership);
  store.setBusinessesLoading(false);
  store.setAuthLoading(false);
}

/** Enter the demo account. Resolves once local state is ready to render. */
export async function enterDemoMode(): Promise<void> {
  // Load the engine BEFORE the flag flips: while the flag is off every query
  // still goes to the real client, and once it is on the demo client is
  // guaranteed to be there to answer them.
  const [{ getDemoState }] = await Promise.all([import('./store'), loadDemoClient()]);
  setDemoMode(true);

  // Seed (or auto-reset) before hydrating so the store reads real rows.
  getDemoState();

  // A real session must not survive into the demo and vice versa: clear the
  // query cache so nothing cached for another account can be rendered.
  try {
    queryClient.clear();
  } catch (err) {
    log.warn('Could not clear query cache when entering demo mode', { error: err });
  }

  await hydrateDemoSession();

  // No auth event is emitted here on purpose: the demo session is written
  // straight into the store, and firing SIGNED_IN on the demo auth would race
  // the very hydration we just did. Listeners that care about sign-out are
  // handled in exitDemoMode().
  log.info('Entered demo mode', { businessId: DEMO_BUSINESS_ID });
}

/** Leave the demo and purge everything the demo put in memory. */
export function exitDemoMode(): void {
  if (!isDemoMode()) return;
  setDemoMode(false);

  try {
    useAppStore.getState().reset();
  } catch (err) {
    log.warn('Store reset on demo exit failed', { error: err });
  }
  try {
    useNotificationStore.getState().clearAll();
  } catch (err) {
    log.warn('Notification purge on demo exit failed', { error: err });
  }
  try {
    queryClient.clear();
  } catch (err) {
    log.warn('Query cache clear on demo exit failed', { error: err });
  }

  log.info('Exited demo mode');
}

/**
 * `true` when the signed-in user is the demo account. Used by guardrails
 * (billing, invites, account deletion) that make no sense in a sandbox.
 * Works off the store rather than the flag so it is reactive in components.
 */
export function isDemoUserEmail(email: string | null | undefined): boolean {
  return String(email ?? '').toLowerCase() === 'demo@ledgr.test';
}
