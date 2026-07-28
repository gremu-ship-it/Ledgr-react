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

  canViewPayroll: boolean;
  canViewReports: boolean;
  canViewInventory: boolean;
  canViewFinance: boolean;

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
  canViewPayroll: false,
  canViewReports: false,
  canViewInventory: false,
  canViewFinance: false,
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
        canViewPayroll: true,
        canViewReports: true,
        canViewInventory: true,
        canViewFinance: true,
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
        canViewPayroll: true,
        canViewReports: true,
        canViewInventory: true,
        canViewFinance: true,
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
        canWritePayroll: false,
        canViewPayroll: false,
        canViewReports: false,
        canViewInventory: true,
        canViewFinance: true,
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
        canViewPayroll: false,
        canViewReports: false,
        canViewInventory: true,
        canViewFinance: false,
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
        canViewPayroll: false,
        canViewReports: false,
        canViewInventory: false,
        canViewFinance: true,
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
        canViewPayroll: false,
        canViewReports: false,
        canViewInventory: false,
        canViewFinance: true,
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
        canViewPayroll: true,
        canViewReports: true,
        canViewInventory: true,
        canViewFinance: true,
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
        canViewPayroll: true,
        canViewReports: false,
        canViewInventory: false,
        canViewFinance: false,
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
        canViewPayroll: false,
        canViewReports: true,
        canViewInventory: true,
        canViewFinance: true,
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
        canViewPayroll: false,
        canViewReports: true,
        canViewInventory: true,
        canViewFinance: true,
        role,
        isGuest: false,
      };

    case 'purchasing_officer':
      return {
        canRead: true,
        canWrite: true,
        canDelete: false,
        canManageUsers: false,
        canManageBilling: false,
        canExport: true,
        canWritePayroll: false,
        canViewPayroll: false,
        canViewReports: false,
        canViewInventory: true,
        canViewFinance: true,
        role,
        isGuest: false,
      };

    case 'warehouse_worker':
      return {
        canRead: true,
        canWrite: true,
        canDelete: false,
        canManageUsers: false,
        canManageBilling: false,
        canExport: false,
        canWritePayroll: false,
        canViewPayroll: false,
        canViewReports: false,
        canViewInventory: true,
        canViewFinance: false,
        role,
        isGuest: false,
      };

    case 'sales_manager':
      return {
        canRead: true,
        canWrite: true,
        canDelete: false,
        canManageUsers: false,
        canManageBilling: false,
        canExport: true,
        canWritePayroll: false,
        canViewPayroll: false,
        canViewReports: true,
        canViewInventory: true,
        canViewFinance: true,
        role,
        isGuest: false,
      };

    case 'customer_service_rep':
      return {
        canRead: true,
        canWrite: true,
        canDelete: false,
        canManageUsers: false,
        canManageBilling: false,
        canExport: false,
        canWritePayroll: false,
        canViewPayroll: false,
        canViewReports: false,
        canViewInventory: false,
        canViewFinance: true,
        role,
        isGuest: false,
      };

    case 'tax_compliance_officer':
      return {
        canRead: true,
        canWrite: true,
        canDelete: false,
        canManageUsers: false,
        canManageBilling: false,
        canExport: true,
        canWritePayroll: false,
        canViewPayroll: false,
        canViewReports: true,
        canViewInventory: false,
        canViewFinance: true,
        role,
        isGuest: false,
      };

    case 'treasury_manager':
      return {
        canRead: true,
        canWrite: true,
        canDelete: false,
        canManageUsers: false,
        canManageBilling: false,
        canExport: true,
        canWritePayroll: false,
        canViewPayroll: false,
        canViewReports: true,
        canViewInventory: false,
        canViewFinance: true,
        role,
        isGuest: false,
      };

    case 'asset_manager':
      return {
        canRead: true,
        canWrite: true,
        canDelete: false,
        canManageUsers: false,
        canManageBilling: false,
        canExport: true,
        canWritePayroll: false,
        canViewPayroll: false,
        canViewReports: true,
        canViewInventory: false,
        canViewFinance: false,
        role,
        isGuest: false,
      };

    case 'board_member':
      return {
        canRead: true,
        canWrite: false,
        canDelete: false,
        canManageUsers: false,
        canManageBilling: false,
        canExport: true,
        canWritePayroll: false,
        canViewPayroll: false,
        canViewReports: true,
        canViewInventory: true,
        canViewFinance: true,
        role,
        isGuest: false,
      };

    case 'branch_manager':
      return {
        canRead: true,
        canWrite: true,
        canDelete: false,
        canManageUsers: false,
        canManageBilling: false,
        canExport: true,
        canWritePayroll: false,
        canViewPayroll: false,
        canViewReports: true,
        canViewInventory: true,
        canViewFinance: true,
        role,
        isGuest: false,
      };

    default:
      return GUEST;
  }
}

export function isPathAllowedForRole(role: string | null, path: string): boolean {
  if (!role) return false;

  switch (role) {
    case 'owner':
    case 'admin':
      return true;

    case 'sales_clerk':
    case 'data_entry':
      return ['/income', '/expenses', '/invoices'].includes(path);

    case 'purchasing_officer':
      return ['/expenses', '/contacts', '/products', '/warehouse', '/transfers', '/inventory', '/dashboard'].includes(path);

    case 'warehouse_worker':
      return ['/dashboard', '/products', '/warehouse', '/transfers', '/inventory'].includes(path);

    case 'sales_manager':
      return ['/dashboard', '/income', '/expenses', '/invoices', '/contacts', '/products', '/warehouse', '/transfers', '/inventory', '/reports'].includes(path);

    case 'customer_service_rep':
      return ['/dashboard', '/income', '/expenses', '/invoices', '/contacts', '/products'].includes(path);

    case 'tax_compliance_officer':
      return ['/dashboard', '/tax', '/reports', '/journals', '/accounts', '/income', '/expenses', '/invoices', '/contacts'].includes(path);

    case 'treasury_manager':
      return ['/dashboard', '/bank-reconcile', '/accounts', '/capital', '/assets', '/income', '/expenses', '/invoices', '/contacts', '/reports'].includes(path);

    case 'asset_manager':
      return ['/dashboard', '/assets', '/capital', '/accounts', '/reports'].includes(path);

    case 'board_member':
      if (path === '/payroll' || path === '/settings') return false;
      return true;

    case 'inventory_manager':
      return ['/products', '/warehouse', '/transfers', '/inventory'].includes(path);

    case 'supervisor':
      if (path === '/payroll' || path === '/reports') return false;
      return true;

    case 'auditor':
    case 'viewer':
      if (path === '/payroll') return false;
      return true;

    case 'payroll_manager':
      if (['/reports', '/products', '/warehouse', '/transfers', '/accounts', '/tax', '/assets', '/capital', '/journals', '/bank-reconcile', '/periods', '/audit', '/branches', '/departments'].includes(path)) {
        return false;
      }
      return true;

    case 'branch_manager':
      if (path === '/payroll') return false;
      return true;

    default:
      return true;
  }
}

export function getHomePathForRole(role: string | null): string {
  if (role === 'sales_clerk' || role === 'data_entry') return '/income';
  if (role === 'inventory_manager' || role === 'warehouse_worker') return '/products';
  if (role === 'purchasing_officer') return '/expenses';
  if (role === 'sales_manager' || role === 'customer_service_rep') return '/invoices';
  if (role === 'tax_compliance_officer') return '/tax';
  if (role === 'treasury_manager') return '/bank-reconcile';
  if (role === 'asset_manager') return '/assets';
  if (role === 'board_member') return '/reports';
  return '/dashboard';
}
