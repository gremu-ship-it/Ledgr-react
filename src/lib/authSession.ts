import { supabase } from '@/lib/supabase';
import { purgeSensitiveClientState } from '@/lib/clientDataIsolation';

/**
 * The only supported application sign-out path. Sensitive browser state is
 * purged before the auth request, so even a failed/retrying network sign-out
 * cannot leave old financial data rendered in this client.
 */
export async function secureSignOut(scope: 'local' | 'global' = 'local') {
  await purgeSensitiveClientState({ broadcast: true });
  return supabase.auth.signOut({ scope });
}
