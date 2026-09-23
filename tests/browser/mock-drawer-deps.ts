/**
 * R09.4 stand-ins for the drawer's context dependencies.
 * - usePermissions: role is scenario-injected; the component's own gating
 *   expression (owner/admin/manager) is the real shipped code.
 * - useOfflineSync: inert provider-free stub (status/method shape only).
 * - useOnlineStatus: scenario-injected real navigator-independent value.
 */
declare global { interface Window { R094_ROLE?: string | null; R094_ONLINE?: boolean } }

export function usePermissions() {
  return { role: window.R094_ROLE ?? null } as { role: string | null };
}

export function useOfflineSync() {
  return {
    isSyncing: false,
    progress: { total: 0, processed: 0, succeeded: 0, failed: 0, skipped: 0 },
    syncNow: async () => {},
  };
}

export function useOnlineStatus() {
  return window.R094_ONLINE ?? true;
}
