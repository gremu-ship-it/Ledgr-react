import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';
import { i18n, normalizeLanguage } from '@/i18n';
import { createLogger } from '@/lib/logger';
import { purgeSensitiveClientState } from '@/lib/clientDataIsolation';
import { secureSignOut } from '@/lib/authSession';
import {
  AUTH_PERSISTENCE_MODE_KEY,
  SESSION_ONLY_TAB_MARKER,
} from '@/lib/authStorage';

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

export function useAuthListener() {
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    async function hydrateUser(userId: string, email: string | null, force = false) {
      // Prevent multiple simultaneous hydrations
      if (isHydrating) return;
      
      // Skip if already hydrated and not forced (prevents re-loading on route changes)
      if (hasInitialHydrated && !force) return;

      isHydrating = true;
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

        // Only fetch memberships if we don't already have them (performance optimization)
        let memberships = useAppStore.getState().businesses;
        if (!memberships.length || force) {
          try {
            const fetched = await repos.business.findMembershipsWithRole(userId);
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
        const refreshedCurrent = current?.business?.id
          ? validMemberships.find((membership) => membership.business.id === current.business.id)
          : null;

        // Replace the membership object even when the business id is unchanged,
        // so role/permission changes cannot keep an old cache context alive.
        useAppStore.getState().setCurrentBusiness(refreshedCurrent ?? validMemberships[0] ?? null);

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
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!isMountedRef.current) return;
      if (session?.user) {
        const sessionOnly = window.localStorage.getItem(AUTH_PERSISTENCE_MODE_KEY) === 'session';
        const tabMarkerPresent = window.sessionStorage.getItem(SESSION_ONLY_TAB_MARKER) === '1';
        if (sessionOnly && !tabMarkerPresent) {
          await secureSignOut('local');
          if (isMountedRef.current) useAppStore.getState().setAuthLoading(false);
          return;
        }

        await hydrateUser(session.user.id, session.user.email ?? null, true);
        if (isMountedRef.current) useAppStore.getState().setAuthLoading(false);
      } else {
        await purgeSensitiveClientState({ broadcast: false });
        if (!isMountedRef.current) return;
        useAppStore.getState().setBusinessesLoading(false);
        useAppStore.getState().setAuthLoading(false);
      }
    });

    // ── Auth state changes ───────────────────────────────────────────
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMountedRef.current) return;

      if (event === 'SIGNED_OUT' || !session?.user) {
        isHydrating = false;
        hasInitialHydrated = false;
        lastHydratedUserId = null;
        useAppStore.getState().reset();
        useAppStore.getState().setAuthLoading(false);
        void purgeSensitiveClientState({ broadcast: true });
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
        const isDifferentAuthenticatedUser =
          lastHydratedUserId !== null && lastHydratedUserId !== session.user.id;
        if (isDifferentAuthenticatedUser) {
          hasInitialHydrated = false;
          lastHydratedUserId = null;
          void purgeSensitiveClientState({
            broadcast: true,
            preserveAuthPersistenceMode: true,
          }).then(() =>
            hydrateUser(session.user.id, session.user.email ?? null, true).finally(() => {
              if (isMountedRef.current) useAppStore.getState().setAuthLoading(false);
            }),
          );
          return;
        }

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
