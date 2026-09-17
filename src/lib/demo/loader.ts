/**
 * On-demand loading of the demo engine.
 *
 * The seeded books, the query builder and the computed views are ~33 kB
 * gzipped. Nobody who is not using the demo should download them, so the app
 * shell never imports them statically: `src/lib/supabase.ts` asks here for the
 * client, and the demo session loads it before the flag is flipped.
 *
 * Two entry points load it:
 *   - `enterDemoMode()` — a visitor clicking through from the landing page;
 *   - `main.tsx` — a page load that starts already in demo mode, so the first
 *     render can serve queries from the seeded tables.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/dal/types/database';

let loadedClient: SupabaseClient<Database> | null = null;
let inFlight: Promise<SupabaseClient<Database>> | null = null;

/** The demo client if its chunk has already been loaded, else null. */
export function getDemoClientIfLoaded(): SupabaseClient<Database> | null {
  return loadedClient;
}

/** Load (once) and return the demo client. Safe to call concurrently. */
export async function loadDemoClient(): Promise<SupabaseClient<Database>> {
  if (loadedClient) return loadedClient;
  if (!inFlight) {
    inFlight = import('@/lib/demo/client')
      .then((mod) => {
        loadedClient = mod.demoClient as unknown as SupabaseClient<Database>;
        return loadedClient;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}
