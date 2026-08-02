import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

const DELAY_MS = 1500; // short delay so quick switches don't log out

export function useAutoSignOutOnHidden() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === 'hidden') {
        timerRef.current = setTimeout(async () => {
          try {
            await supabase.auth.signOut();
          } catch {
            // Ignore network errors on unload; local session is still removed.
          }
        }, DELAY_MS);
      } else {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);
}
