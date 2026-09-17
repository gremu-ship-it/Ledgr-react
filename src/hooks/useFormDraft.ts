import { useEffect, useRef, useState } from 'react';

/**
 * Auto-save a form's draft state to sessionStorage so the user does not
 * lose partially-entered data if the tab crashes, they navigate away, or
 * they hit refresh mid-entry.
 *
 * SECURITY & PRIVACY:
 *  - Uses sessionStorage (not localStorage) so drafts do NOT survive a
 *    browser restart or a signed-out session. Closing the tab discards
 *    them, which prevents a second person on a shared device from opening
 *    the form days later and seeing the previous user's draft.
 *  - Key is namespaced by businessId so drafts do not leak between tenants
 *    if the user switches businesses.
 *  - Draft is cleared EXPLICITLY when the form submits successfully (via
 *    the returned `clearDraft()`) and also automatically when the user
 *    signs out (main.tsx clears sessionStorage on SIGNED_OUT).
 *  - Storage access is wrapped in try/catch: private-browsing / disabled-
 *    storage modes must silently no-op rather than crash the form.
 *  - JSON size is capped at ~64KB per draft to prevent self-XSS via a
 *    bloated saved object (defense-in-depth — all callers use plain
 *    form-shaped objects, never raw HTML or user-controlled markup).
 *  - On read we validate that the stored value is a plain object matching
 *    the expected TypeScript shape via a type-guard callback supplied by
 *    the caller; non-matching data is discarded to avoid injecting stale
 *    or maliciously-tampered values.
 */

const MAX_DRAFT_BYTES = 64 * 1024; // 64 KB per draft

function storageKey(businessId: string | undefined, formId: string): string {
  return `ledgr_draft_${formId}_${businessId ?? 'nobiz'}`;
}

/** Read a draft safely, returning undefined if anything is wrong. */
function readDraft<T>(key: string, validate: (v: unknown) => v is T): T | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return undefined;
    if (raw.length > MAX_DRAFT_BYTES) {
      window.sessionStorage.removeItem(key);
      return undefined;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!validate(parsed)) {
      window.sessionStorage.removeItem(key);
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export interface UseFormDraftOptions<T> {
  formId: string;               // Stable id, e.g. 'quick-expense' / 'new-invoice'
  businessId: string | undefined;
  initialValue: T;
  validate: (v: unknown) => v is T;
  /** Save only after this many ms of inactivity (debounce). Default 500. */
  debounceMs?: number;
}

export interface UseFormDraftResult<T> {
  draft: T;
  setDraft: (updater: T | ((prev: T) => T)) => void;
  clearDraft: () => void;
  /** True when a recovered draft (not initialValue) is being shown. Useful
   *  to show a "Recovered unsaved draft" banner. */
  recovered: boolean;
}

export function useFormDraft<T>(opts: UseFormDraftOptions<T>): UseFormDraftResult<T> {
  const { formId, businessId, initialValue, validate, debounceMs = 500 } = opts;
  const key = storageKey(businessId, formId);

  // Restore synchronously on first render. If storage throws or contains
  // garbage, fall back to initialValue and recovered=false.
  const [draft, setDraftState] = useState<T>(() => {
    const restored = readDraft<T>(key, validate);
    return restored ?? initialValue;
  });
  const [recovered, setRecovered] = useState<boolean>(() => {
    return readDraft<T>(key, validate) !== undefined;
  });

  // Debounced write: don't hammer sessionStorage on every keystroke.
  const timerRef = useRef<number | null>(null);
  const firstRun = useRef(true);

  useEffect(() => {
    // Don't overwrite storage with initialValue on mount when there was no
    // prior draft (and no edits yet) — that would create noise.
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      try {
        const serialized = JSON.stringify(draft);
        if (serialized.length <= MAX_DRAFT_BYTES) {
          window.sessionStorage.setItem(key, serialized);
        }
      } catch {
        // storage full / disabled — silently drop.
      }
    }, debounceMs);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [draft, key, debounceMs]);

  // When businessId or formId changes (user switches tenants), drop the draft
  // state from the previous tenant rather than loading a different business's
  // numbers into the form.
  //
  // Adjusted during render — React's "adjusting state when a prop changes"
  // pattern — rather than in an effect. Effects run after commit, so the old
  // version painted one frame of the previous tenant's draft before clearing
  // it, which is precisely the leak this guard exists to prevent. Setting
  // state here is safe because it is conditional on the key having actually
  // changed and only ever writes this component's own state.
  const [draftKey, setDraftKey] = useState(key);
  if (draftKey !== key) {
    setDraftKey(key);
    setDraftState(initialValue);
    setRecovered(false);
  }

  function setDraft(updater: T | ((prev: T) => T)) {
    setDraftState((prev) => (typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater));
    setRecovered(false);
  }

  function clearDraft() {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // ignore
    }
    setDraftState(initialValue);
    setRecovered(false);
  }

  return { draft, setDraft, clearDraft, recovered };
}
