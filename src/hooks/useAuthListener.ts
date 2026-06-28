import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';

export function useAuthListener() {
  const setCurrentUser     = useAppStore((s) => s.setCurrentUser);
  const setAuthLoading     = useAppStore((s) => s.setAuthLoading);
  const setBusinesses      = useAppStore((s) => s.setBusinesses);
  const setCurrentBusiness = useAppStore((s) => s.setCurrentBusiness);
  const reset              = useAppStore((s) => s.reset);

  useEffect(() => {
    let isMounted     = true;
    let isHydrating   = false; // prevent concurrent hydration calls

    async function hydrateUser(userId: string, email: string | null) {
      // If already hydrating, skip — avoids race condition where
      // getSession() and onAuthStateChange fire simultaneously on load.
      if (isHydrating) return;
      isHydrating = true;

      try {
        const profile = await repos.business
          .findUserProfile(userId)
          .catch(() => null);

        if (!isMounted) return;

        setCurrentUser({ id: userId, email, profile });

        // Keep existing cached businesses while fetching —
        // prevents ProtectedRoute seeing length === 0 mid-fetch.
        let memberships = useAppStore.getState().businesses;

        try {
          const fetched = await repos.business.findMembershipsWithRole(userId);
          console.log('findMembershipsWithRole result:', fetched);
          memberships = fetched;
        } catch (err) {
          console.warn('Failed to load memberships, using cached values.', err);
        }

        if (!isMounted) return;

        const validMemberships = memberships.filter(
          (m) => m && m.business && m.business.id,
        );

        setBusinesses(validMemberships);

        const current = useAppStore.getState().currentBusiness;
        const stillValid = current?.business?.id
          ? validMemberships.some((m) => m.business.id === current.business.id)
          : false;

        if (!stillValid) {
          const firstValid = validMemberships[0] ?? null;
          console.log('Setting current business:', firstValid);
          setCurrentBusiness(firstValid);
        }
      } catch (err) {
        console.error('Failed to hydrate user:', err);
      } finally {
        isHydrating = false;
      }
    }

    // ── Initial session check ──────────────────────────────────────────
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!isMounted) return;
      if (session?.user) {
        hydrateUser(session.user.id, session.user.email ?? null).finally(() => {
          if (isMounted) setAuthLoading(false);
        });
      } else {
        setAuthLoading(false);
      }
    });

    // ── Auth state changes ─────────────────────────────────────────────
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return;

      if (event === 'SIGNED_OUT' || !session?.user) {
        reset();
        setAuthLoading(false);
        return;
      }

      // TOKEN_REFRESHED: don't re-fetch memberships, just update identity quietly
      if (event === 'TOKEN_REFRESHED') {
        setCurrentUser({
          id: session.user.id,
          email: session.user.email ?? null,
          profile: useAppStore.getState().currentUser?.profile ?? null,
        });
        setAuthLoading(false);
        return;
      }

      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        hydrateUser(session.user.id, session.user.email ?? null).finally(() => {
          if (isMounted) setAuthLoading(false);
        });
      }
    });

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, [setCurrentUser, setAuthLoading, setBusinesses, setCurrentBusiness, reset]);
}
