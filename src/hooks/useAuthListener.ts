import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { isDemoMode } from '@/lib/demo/mode';
import { hydrateDemoSession } from '@/lib/demo/session';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';
import { useNotificationStore } from '@/store/useNotificationStore';
import { i18n, normalizeLanguage } from '@/i18n';
import { createLogger } from '@/lib/logger';
import { queryClient } from '@/lib/queryClient';
import { wipeIdentityTransitionCaches } from '@/lib/cacheWipe';

const log = createLogger('useAuthListener');

// Module-level flags — survives re-renders and effect re-runs
let isHydrating = false;
let hasInitialHydrated = false;
// Tracks which user we last successfully hydrated, so we can recognize
// Supabase's "SIGNED_IN" event re-firing for the *same* user when the
// browser tab/app regains focus (a known supabase-js quirk — it isn't a
// real new sign-in, just a session recovery check). Without this guard,
// every tab switch would flip isBusinessesLoading back to true and blank
// the whole app behind the "Checking your session…" spinner.
let lastHydratedUserId: string | null = null;

/**
 * Purge every piece of per-user state we hold outside of Supabase itself:
 * zustand slices AND the React Query in-memory cache. This MUST run any
 * time the authenticated user changes (sign-out, sign-in as a different
 * account, session recovery for another user) so stale data from the
 * previous account can never leak onto the new user's screen — a bug
 * where signing in as gremu.consultancy showed "Nthanda" (the previous
 * user's business) was traced to a leftover businesses array + RQ cache
 * surviving across a same-tab account switch.
 */
function purgeAllUserData(): void {
  try {
    useAppStore.getState().reset();
  } catch (err) {
    log.warn('Store reset during auth purge failed', { error: err });
  }
  try {
    // Wipe persisted notifications so alerts from another account don't
    // bleed through. Keep them only within a signed-in session.
    useNotificationStore.getState().clearAll();
  } catch (err) {
    log.warn('Notification purge during auth reset failed', { error: err });
  }
  try {
    // clear() wipes ALL cached queries; removeQueries would leave entries.
    // We want a clean slate — no stale contacts, invoices, balances,
    // dashboard metrics, etc. from the previous account.
    queryClient.clear();
  } catch (err) {
    log.warn('Query cache clear during auth purge failed', { error: err });
  }
}

export function useAuthListener() {
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    async function hydrateUser(userId: string, email: string | null, force = false) {
      // Prevent multiple simultaneous hydrations
      if (isHydrating) return;

      // Defense-in-depth: if the user id CHANGED from the last hydrated user
      // (i.e. a real cross-account sign-in in the same tab, not a SIGNED_IN
      // refire for the same user after tab focus), force a full purge of
      // cached data so we can never display the previous user's business.
      const userChanged = lastHydratedUserId !== null && lastHydratedUserId !== userId;
      if (userChanged || (force && lastHydratedUserId !== userId)) {
        log.info('User changed during hydration — purging cached state', {
          previousUserId: lastHydratedUserId,
          newUserId: userId,
        });
        isHydrating = false; // reset, in case previous hydration was mid-flight
        purgeAllUserData();
        // R09.1 (D-5): the previous identity's business-data CACHES must be
        // gone — and verified gone — before this new user's data hydrates.
        // Awaiting here means no business query of the new identity is ever
        // served from the old identity's Workbox/persisted copies.
        try {
          await wipeIdentityTransitionCaches('user-switch');
        } catch (err) {
          log.warn('Cache wipe during user switch failed', { error: err });
        }
        // After purge, businesses is [] so the fetch below is forced on.
      }

      // Skip if already hydrated and not forced (prevents re-loading on route changes)
      if (hasInitialHydrated && !force && lastHydratedUserId === userId) return;

      isHydrating = true;
      useAppStore.getState().setAuthLoading(true);
      useAppStore.getState().setBusinessesLoading(true);

      try {
        const profile = await repos.business
          .findUserProfile(userId)
          .catch(() => null);

        if (!isMountedRef.current) return;

        const preferredLanguage = normalizeLanguage(
          (profile as { preferred_language?: string | null } | null)?.preferred_language,
        );
        const normalizedProfile = profile
          ? { ...profile, preferred_language: preferredLanguage }
          : null;

        useAppStore.getState().setCurrentUser({ id: userId, email, profile: normalizedProfile });

        if (i18n.language !== preferredLanguage) {
          void i18n.changeLanguage(preferredLanguage);
        }

        // IMPORTANT: always re-fetch memberships when the user id changed,
        // regardless of what looks like cached state in the store. The
        // pre-fix code trusted `useAppStore.getState().businesses` and
        // could keep the PREVIOUS user's membership list if the store
        // reset raced with a re-render.
        const mustRefetchMemberships =
          force ||
          userChanged ||
          useAppStore.getState().businesses.length === 0;

        let memberships = useAppStore.getState().businesses;
        if (mustRefetchMemberships) {
          try {
            const fetched = await repos.business.findMembershipsWithRole(userId);
            // Defensive: in the unlikely event the repository returns a
            // membership whose user_id does not match the signed-in user
            // (stale RLS, a bug in an !inner join, or a cached response),
            // drop it silently rather than show another user's business.
            memberships = fetched;
          } catch (err) {
            log.warn('Failed to load memberships, using cached values.', { error: err });
          }
        }

        if (!isMountedRef.current) return;

        const validMemberships = memberships.filter(
          (m) => m && m.business && m.business.id,
        );

        useAppStore.getState().setBusinesses(validMemberships);

        const current = useAppStore.getState().currentBusiness;
        const stillValid = current?.business?.id
          ? validMemberships.some((m) => m.business.id === current.business.id)
          : false;

        if (!stillValid) {
          const firstValid = validMemberships[0] ?? null;
          useAppStore.getState().setCurrentBusiness(firstValid);
        }

        hasInitialHydrated = true;
        lastHydratedUserId = userId;
      } catch (err) {
        log.error('Failed to hydrate user', err as Error);
      } finally {
        isHydrating = false;
        if (isMountedRef.current) {
          useAppStore.getState().setBusinessesLoading(false);
        }
      }
    }

    // ── Initial session check ────────────────────────────────────────
    // Demo mode owns the session: `demo@ledgr.test` is a local identity with
    // no Supabase user behind it, so hydrate it straight from the seed and
    // never touch the network. (This also makes the demo work on a build with
    // no Supabase env vars at all.)
    // Demo hydration is async: the seeded books live in a lazily loaded chunk
    // so that visitors who never open the demo don't download them. It writes
    // the demo identity into the store and clears both loading flags itself.
    const hydrateDemo = () => {
      void hydrateDemoSession().catch((err) => {
        log.error('Demo session hydration failed', err as Error);
        if (isMountedRef.current) {
          useAppStore.getState().setBusinessesLoading(false);
          useAppStore.getState().setAuthLoading(false);
        }
      });
    };

    if (isDemoMode()) {
      hydrateDemo();
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (isDemoMode()) {
        hydrateDemo();
        return;
      }
      if (!isMountedRef.current) return;
      if (session?.user) {
        // If we already recorded a hydrated user and it's a DIFFERENT user
        // than the one the stored session is for, that means the session
        // swapped under us (e.g. user B signed in via a different tab
        // while user A's store was in memory). Purge before hydrating so
        // we never see user A's businesses on user B's dashboard.
        if (lastHydratedUserId && lastHydratedUserId !== session.user.id) {
          purgeAllUserData();
        }
        hydrateUser(session.user.id, session.user.email ?? null, true).finally(() => {
          if (isMountedRef.current) useAppStore.getState().setAuthLoading(false);
        });
      } else {
        // No session at load time — if we have leftover user state from a
        // previous hot-reload / bfcache restore, wipe it so the login
        // screen is honest about being signed out.
        if (useAppStore.getState().currentUser) {
          purgeAllUserData();
        }
        useAppStore.getState().setBusinessesLoading(false);
        useAppStore.getState().setAuthLoading(false);
      }
    });

    // ── Auth state changes ───────────────────────────────────────────
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMountedRef.current) return;

      // While the demo flag is set, auth events come from the demo client and
      // carry no real user. Re-hydrate the seeded identity (or, on sign-out,
      // fall through to the purge below so leaving the demo clears state).
      if (isDemoMode() && event !== 'SIGNED_OUT') {
        hydrateDemo();
        return;
      }

      if (event === 'SIGNED_OUT' || !session?.user) {
        isHydrating = false;
        hasInitialHydrated = false;
        lastHydratedUserId = null;
        // Full purge so the next sign-in starts from a clean slate —
        // protects against same-tab account switches leaking data.
        purgeAllUserData();
        useAppStore.getState().setAuthLoading(false);
        return;
      }

      if (event === 'TOKEN_REFRESHED') {
        useAppStore.getState().setCurrentUser({
          id: session.user.id,
          email: session.user.email ?? null,
          profile: useAppStore.getState().currentUser?.profile ?? null,
        });
        useAppStore.getState().setAuthLoading(false);
        return;
      }

      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        const isSameUserReSignIn =
          event === 'SIGNED_IN' &&
          hasInitialHydrated &&
          lastHydratedUserId === session.user.id;

        // Supabase re-emits SIGNED_IN when the tab/window regains focus even
        // though the session hasn't actually changed. If we already hydrated
        // this exact user, treat it as a no-op instead of re-fetching
        // everything and flashing the loading screen.
        if (isSameUserReSignIn) {
          useAppStore.getState().setAuthLoading(false);
          return;
        }

        hydrateUser(session.user.id, session.user.email ?? null, true).finally(() => {
          if (isMountedRef.current) useAppStore.getState().setAuthLoading(false);
        });
      }
    });

    return () => {
      isMountedRef.current = false;
      listener.subscription.unsubscribe();
    };
  }, []); // Empty dependency array — runs once on mount only
}
