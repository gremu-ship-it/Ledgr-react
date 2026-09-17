/**
 * Reactive demo-mode flag for components.
 *
 * Reads the same dependency-free flag as `src/lib/supabase.ts` (so the client
 * swap and the UI can never disagree) and re-renders subscribers when the
 * visitor enters or leaves the demo.
 */
import { useSyncExternalStore } from 'react';
import {
  getDemoModeServerSnapshot,
  getDemoModeSnapshot,
  subscribeDemoMode,
} from '@/lib/demo/mode';

export function useDemoMode(): boolean {
  return useSyncExternalStore(subscribeDemoMode, getDemoModeSnapshot, getDemoModeServerSnapshot);
}
