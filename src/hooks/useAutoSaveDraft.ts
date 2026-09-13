import { useEffect, useRef, useState } from 'react';

/**
 * Lightweight auto-save/restore for already-existing multi-state forms
 * without forcing callers to refactor to a single state object.
 *
 * Callers provide a `capture` function that returns the JSON-serializable
 * snapshot to persist, plus an array of the values that should trigger a
 * save (typically every state field). On mount, if a stored draft exists
 * the `restore` callback receives it so callers can rehydrate their state.
 * When `clear()` is called (on successful submit / explicit close), the
 * saved draft is wiped.
 *
 * See useFormDraft for the security model — this is the same approach
 * (sessionStorage, businessId-namespaced, JSON-validated, bounded size,
 * cleared on SIGNED_OUT in main.tsx).
 */

const MAX_DRAFT_BYTES = 64 * 1024;

function keyOf(businessId: string | undefined, formId: string): string {
  return `ledgr_draft_${formId}_${businessId ?? 'nobiz'}`;
}

export interface AutoSaveDraftOptions<T> {
  formId: string;
  businessId: string | undefined;
  /** Should the draft be restored? Callers can pass false when data is
   *  not yet loaded (e.g. reference selects not ready) to avoid restoring
   *  a partial draft. */
  enabled?: boolean;
  /** Return a JSON-serializable snapshot of the current form state. */
  capture: () => T;
  /** Invoked once on mount with the restored snapshot. Caller is responsible
   *  for re-applying to individual state setters. */
  restore: (snapshot: T) => void;
  /** Values that, when changed, trigger a save. Pass every state field
   *  that you want persisted. */
  deps: unknown[];
  validate: (v: unknown) => v is T;
  debounceMs?: number;
}

export interface AutoSaveDraftResult {
  clear: () => void;
  recovered: boolean;
}

export function useAutoSaveDraft<T extends object>(
  opts: AutoSaveDraftOptions<T>,
): AutoSaveDraftResult {
  const { formId, businessId, enabled = true, capture, restore, deps, validate, debounceMs = 500 } = opts;
  const key = keyOf(businessId, formId);
  const timerRef = useRef<number | null>(null);
  const restoredRef = useRef(false);
  const [recovered, setRecovered] = useState(false);

  // Restore once when enabled becomes true.
  useEffect(() => {
    if (!enabled || restoredRef.current) return;
    restoredRef.current = true;
    try {
      const raw = window.sessionStorage.getItem(key);
      if (!raw) return;
      if (raw.length > MAX_DRAFT_BYTES) {
        window.sessionStorage.removeItem(key);
        return;
      }
      const parsed = JSON.parse(raw) as unknown;
      if (validate(parsed)) {
        restore(parsed);
        setRecovered(true);
      } else {
        window.sessionStorage.removeItem(key);
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);

  // Save on dep changes.
  useEffect(() => {
    if (!enabled) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      try {
        const snap = capture();
        const serialized = JSON.stringify(snap);
        if (serialized.length <= MAX_DRAFT_BYTES) {
          window.sessionStorage.setItem(key, serialized);
        }
      } catch {
        // ignore
      }
    }, debounceMs);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, debounceMs, ...deps]);

  function clear() {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // ignore
    }
    setRecovered(false);
  }

  return { clear, recovered };
}
