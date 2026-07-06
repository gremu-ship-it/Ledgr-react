import type { ReactNode } from 'react';
import { usePermissions, type Permissions } from '@/hooks/usePermissions';

type PermissionKey = keyof Omit<Permissions, 'role' | 'isGuest'>;

interface PermissionGateProps {
  /**
   * The permission(s) required to show/enable the children.
   * If multiple are provided, ALL must be true (AND logic).
   * For OR logic, use multiple PermissionGate components.
   *
   * @example
   * // Single permission
   * <PermissionGate require="canWrite">
   *   <button>Save</button>
   * </PermissionGate>
   *
   * // Multiple — user must have BOTH
   * <PermissionGate require={["canWrite", "canManageUsers"]}>
   *   <button>Invite member</button>
   * </PermissionGate>
   */
  require: PermissionKey | PermissionKey[];

  /**
   * What to render when permission is denied.
   *
   * - 'hide' (default): renders nothing
   * - 'disable': renders children wrapped in a disabled, non-interactive container
   * - ReactNode: renders a custom fallback
   */
  fallback?: 'hide' | 'disable' | ReactNode;

  children: ReactNode;
}

/**
 * Wraps UI elements and hides or disables them based on the current
 * user's role in the selected business.
 *
 * Uses usePermissions() which reads from the Zustand store — no
 * network call, no loading state needed.
 *
 * @example
 * // Hide the delete button from non-owners/admins
 * <PermissionGate require="canDelete">
 *   <button onClick={handleDelete}>Delete</button>
 * </PermissionGate>
 *
 * // Show a disabled Save button to read-only roles
 * <PermissionGate require="canWrite" fallback="disable">
 *   <button onClick={handleSave}>Save</button>
 * </PermissionGate>
 *
 * // Custom fallback message
 * <PermissionGate require="canManageBilling" fallback={<p>Owner access required</p>}>
 *   <BillingPanel />
 * </PermissionGate>
 */
export function PermissionGate({ require, fallback = 'hide', children }: PermissionGateProps) {
  const permissions = usePermissions();

  const keys = Array.isArray(require) ? require : [require];
  const allowed = keys.every((key) => permissions[key] === true);

  if (allowed) return <>{children}</>;

  if (fallback === 'hide') return null;

  if (fallback === 'disable') {
    return (
      <div
        className="pointer-events-none select-none opacity-40"
        aria-disabled="true"
        title="You don't have permission to perform this action"
      >
        {children}
      </div>
    );
  }

  // Custom fallback ReactNode
  return <>{fallback}</>;
}
