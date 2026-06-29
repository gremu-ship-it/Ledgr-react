import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';

// Module-level flag — survives re-renders and effect re-runs
let isHydrating = false;

export function useAuthListener() {
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    async function hydrateUser(userId: string, email: string | null) {
      if (isHydrating) return;
      isHydrating = true;
      useAppStore.getState().setBusinessesLoading(true);

      try {
        const profile = await repos.business
          .findUserProfile(userId)
          .catch(() => null);

        if (!isMountedRef.current) return;

        useAppStore.getState().setCurrentUser({ id: userId, email, profile });

        let memberships = useAppStore.getState().businesses;
        try {
          const fetched = await repos.business.findMembershipsWithRole(userId);
          console.log('findMembershipsWithRole result:', fetched);
          memberships = fetched;
        } catch (err) {
          console.warn('Failed to load memberships, using cached values.', err);
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
          console.log('Setting current business:', firstValid);
          useAppStore.getState().setCurrentBusiness(firstValid);
        }
      } catch (err) {
        console.error('Failed to hydrate user:', err);
      } finally {
        isHydrating = false;
        if (isMountedRef.current) {
          useAppStore.getState().setBusinessesLoading(false);
        }
      }
    }

    // ── Initial session check ────────────────────────────────────────
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!isMountedRef.current) return;
      if (session?.user) {
        hydrateUser(session.user.id, session.user.email ?? null).finally(() => {
          if (isMountedRef.current) useAppStore.getState().setAuthLoading(false);
        });
      } else {
        useAppStore.getState().setBusinessesLoading(false);
        useAppStore.getState().setAuthLoading(false);
      }
    });

    // ── Auth state changes ───────────────────────────────────────────
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMountedRef.current) return;

      if (event === 'SIGNED_OUT' || !session?.user) {
        isHydrating = false;
        useAppStore.getState().reset();
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
        hydrateUser(session.user.id, session.user.email ?? null).finally(() => {
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
