import { useAppStore } from '@/store/useAppStore';

/**
 * All permission booleans derived from the current user's role
 * in the currently selected business.
 *
 * Role hierarchy (highest → lowest):
 *   owner > admin > accountant > payroll_manager > auditor > viewer
 *
 * Reads directly from the Zustand store — no network call needed
 * because the role is already loaded into currentBusiness.role
 * by useAuthListener on login.
 */
export interface Permissions {
  /** True for all roles — every member can read */
  canRead: boolean;

  /** True for owner, admin, accountant. payroll_manager can write payroll only — check canWritePayroll. */
  canWrite: boolean;

  /** True for owner and admin only */
  canDelete: boolean;

  /** True for owner and admin only */
  canManageUsers: boolean;

  /** True for owner only */
  canManageBilling: boolean;

  /** True for all except viewer */
  canExport: boolean;

  /** True for owner, admin, accountant, payroll_manager */
  canWritePayroll: boolean;

  /** The raw role string — use for role-specific UI labels */
  role: string | null;

  /** True when no business is selected or user has no membership */
  isGuest: boolean;
}

const GUEST: Permissions = {
  canRead: false,
  canWrite: false,
  canDelete: false,
  canManageUsers: false,
  canManageBilling: false,
  canExport: false,
  canWritePayroll: false,
  role: null,
  isGuest: true,
};

export function usePermissions(): Permissions {
  const currentBusiness = useAppStore((s) => s.currentBusiness);

  if (!currentBusiness) return GUEST;

  const role = currentBusiness.role;

  switch (role) {
    case 'owner':
      return {
        canRead: true,
        canWrite: true,
        canDelete: true,
        canManageUsers: true,
        canManageBilling: true,
        canExport: true,
        canWritePayroll: true,
        role,
        isGuest: false,
      };

    case 'admin':
      return {
        canRead: true,
        canWrite: true,
        canDelete: true,
        canManageUsers: true,
        canManageBilling: false,
        canExport: true,
        canWritePayroll: true,
        role,
        isGuest: false,
      };

    case 'accountant':
      return {
        canRead: true,
        canWrite: true,
        canDelete: false,
        canManageUsers: false,
        canManageBilling: false,
        canExport: true,
        canWritePayroll: true,
        role,
        isGuest: false,
      };

    case 'payroll_manager':
      return {
        canRead: true,
        canWrite: false,       // write restricted to payroll only
        canDelete: false,
        canManageUsers: false,
        canManageBilling: false,
        canExport: true,
        canWritePayroll: true, // this is the exception
        role,
        isGuest: false,
      };

    case 'auditor':
      return {
        canRead: true,
        canWrite: false,
        canDelete: false,
        canManageUsers: false,
        canManageBilling: false,
        canExport: true,
        canWritePayroll: false,
        role,
        isGuest: false,
      };

    case 'viewer':
      return {
        canRead: true,
        canWrite: false,
        canDelete: false,
        canManageUsers: false,
        canManageBilling: false,
        canExport: false,
        canWritePayroll: false,
        role,
        isGuest: false,
      };

    case 'supervisor':
      return {
        canRead: true,
        canWrite: true,
        canDelete: false,
        canManageUsers: false,
        canManageBilling: false,
        canExport: true,
        canWritePayroll: true,
        role,
        isGuest: false,
      };

    case 'data_entry':
      return {
        canRead: true,
        canWrite: true,
        canDelete: false,
        canManageUsers: false,
        canManageBilling: false,
        canExport: false,
        canWritePayroll: false,
        role,
        isGuest: false,
      };

    case 'inventory_manager':
      return {
        canRead: true,
        canWrite: true,
        canDelete: false,
        canManageUsers: false,
        canManageBilling: false,
        canExport: true,
        canWritePayroll: false,
        role,
        isGuest: false,
      };

    case 'sales_clerk':
      return {
        canRead: true,
        canWrite: true,
        canDelete: false,
        canManageUsers: false,
        canManageBilling: false,
        canExport: false,
        canWritePayroll: false,
        role,
        isGuest: false,
      };

    default:
      return GUEST;
  }
}