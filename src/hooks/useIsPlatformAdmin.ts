import { useAppStore } from '@/store/useAppStore';

/**
 * True when the signed-in user has user_profiles.is_platform_admin = true.
 * Backed by the profile already loaded into the store by useAuthListener —
 * no extra network call. The real enforcement lives server-side (RLS +
 * the grant-manual-subscription Edge Function re-checks this on the
 * server), so this is purely for showing/hiding the admin UI.
 */
export function useIsPlatformAdmin(): boolean {
  return useAppStore((s) => s.currentUser?.profile?.is_platform_admin === true);
}
