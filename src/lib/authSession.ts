import { supabase } from '@/lib/supabase';
import { purgeSensitiveClientState } from '@/lib/clientDataIsolation';
import { clearAuthPersistenceMode } from '@/lib/authStorage';

/**
 * The only supported application sign-out path. Sensitive browser state is
 * purged before the auth request, so even a failed/retrying network sign-out
 * cannot leave old financial data rendered in this client.
 */
export async function secureSignOut(scope: 'local' | 'global' = 'local') {
  // Keep the storage-mode marker until Supabase removes its token: session-only
  // credentials live in sessionStorage and would otherwise become invisible to
  // the adapter between purge and signOut. All rendered/business data is still
  // purged before the network request.
  await purgeSensitiveClientState({
    broadcast: true,
    preserveAuthPersistenceMode: true,
  });
  try {
    return await supabase.auth.signOut({ scope });
  } finally {
    clearAuthPersistenceMode();
  }
}
