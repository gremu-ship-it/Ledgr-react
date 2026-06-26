import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';

export function useAuthListener() {
  const setCurrentUser = useAppStore((s) => s.setCurrentUser);
  const setAuthLoading = useAppStore((s) => s.setAuthLoading);
  const setBusinesses = useAppStore((s) => s.setBusinesses);
  const setCurrentBusiness = useAppStore((s) => s.setCurrentBusiness);
  const reset = useAppStore((s) => s.reset);

  useEffect(() => {
    let isMounted = true;

    async function hydrateUser(
      userId: string,
      email: string | null,
    ) {
      try {
        const profile = await repos.business
          .findUserProfile(userId)
          .catch(() => null);

        if (!isMounted) return;

        setCurrentUser({
          id: userId,
          email,
          profile,
        });

        let memberships =
          useAppStore.getState().businesses;

        try {
          memberships =
            await repos.business.findMembershipsWithRole(
              userId,
            );

          console.log(
            'findMembershipsWithRole:',
            memberships,
          );
        } catch (err) {
          console.warn(
            'Failed to load memberships, using cached values.',
            err,
          );
        }

        if (!isMounted) return;

        const validMemberships = memberships.filter(
          (m) =>
            m &&
            m.business &&
            m.business.id,
        );

        setBusinesses(validMemberships);

        const current =
          useAppStore.getState().currentBusiness;

        const stillValid =
          current?.business?.id
            ? validMemberships.some(
                (m) =>
                  m.business.id ===
                  current.business.id,
              )
            : false;

        if (!stillValid) {
          const firstValid =
            validMemberships[0] ?? null;

          console.log(
            'Setting current business:',
            firstValid,
          );

          setCurrentBusiness(firstValid);
        }
      } catch (err) {
        console.error(
          'Failed to hydrate user:',
          err,
        );
      }
    }

    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (!isMounted) return;

        if (session?.user) {
          hydrateUser(
            session.user.id,
            session.user.email ?? null,
          ).finally(() => {
            if (isMounted) {
              setAuthLoading(false);
            }
          });
        } else {
          setAuthLoading(false);
        }
      });

    const { data: listener } =
      supabase.auth.onAuthStateChange(
        (event, session) => {
          if (!isMounted) return;

          if (
            event === 'SIGNED_OUT' ||
            !session?.user
          ) {
            reset();
            setAuthLoading(false);
            return;
          }

          if (
            event === 'SIGNED_IN' ||
            event === 'TOKEN_REFRESHED' ||
            event === 'USER_UPDATED'
          ) {
            hydrateUser(
              session.user.id,
              session.user.email ?? null,
            ).finally(() => {
              if (isMounted) {
                setAuthLoading(false);
              }
            });
          }
        },
      );

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, [
    setCurrentUser,
    setAuthLoading,
    setBusinesses,
    setCurrentBusiness,
    reset,
  ]);
}