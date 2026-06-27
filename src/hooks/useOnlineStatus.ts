import { useEffect, useState } from 'react';

/**
 * Tracks the browser's online/offline status via the `online`/`offline`
 * window events, backed by `navigator.onLine` for the initial value.
 *
 * Note: `navigator.onLine` reports network connectivity (is there a
 * network interface that's up), not actual reachability of Supabase —
 * a captive portal or a Supabase outage can leave `navigator.onLine` true
 * while requests still fail. The sync engine handles that case by simply
 * catching and recording failures per-item rather than assuming "online"
 * means "every request will succeed".
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
    }
    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}