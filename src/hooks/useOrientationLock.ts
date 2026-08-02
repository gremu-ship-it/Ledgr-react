import { useEffect } from 'react';
import { useAppStore } from '@/store/useAppStore';

export function useOrientationLock() {
  const locked = useAppStore((s) => s.orientationLock);

  useEffect(() => {
    const screenAny = window.screen as unknown as {
      orientation?: {
        lock: (type: string) => Promise<void>;
        unlock: () => void;
        type?: string;
      };
    };
    if (!screenAny?.orientation) return;

    try {
      if (locked) {
        screenAny.orientation.lock('portrait').catch(() => {
          // Lock may not be supported or permitted; ignore.
        });
      } else {
        screenAny.orientation.unlock();
      }
    } catch {
      // Ignore errors on unsupported browsers.
    }
  }, [locked]);
}
