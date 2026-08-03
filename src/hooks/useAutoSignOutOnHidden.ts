/**
 * DISABLED / DEPRECATED:
 * Signing out when document.visibilityState === 'hidden' was destroying user
 * sessions whenever a user switched windows, switched browser tabs, or
 * minimized the app for >1.5s. This forced users to log in again on page
 * refresh or window re-focus and caused full re-hydration loading spinners.
 *
 * Session security and idle timeout is handled safely by `useInactivityTimeout`
 * (which tracks user interactions and warns before logging out after idle duration).
 */
export function useAutoSignOutOnHidden() {
  // No-op: do not sign out on tab/window switch
}
