import { useAppStore } from '@/store/useAppStore';
import type { OrganisationCapability } from '@/lib/capabilities/profile';

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

    case 'cashier':
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
        canViewFinance: false,
        role,
        isGuest: false,
      };

    case 'manager':
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
        canViewFinance: false,
        role,
        isGuest: false,
      };

    case 'stock_clerk':
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

    default:
      return GUEST;
  }
}

export function isPathAllowedForRole(role: string | null, path: string): boolean {
  if (!role) return false;

  // The Support assistant is available to every authenticated role.
  if (path === '/support') return true;
  const isBankReconciliationPath = path === '/bank-reconciliation/accounts'
    || path === '/bank-reconciliation/statements'
    || path.startsWith('/bank-reconciliation/statements/')
    || path.startsWith('/bank-reconciliation/reconcile/');

  switch (role) {
    case 'owner':
    case 'admin':
      return true;

    case 'cashier':
      return ['/pos', '/pos/shifts', '/income', '/invoices'].includes(path);

    case 'sales_clerk':
    case 'data_entry':
      return ['/income', '/expenses', '/invoices', '/pos', '/pos/shifts'].includes(path);

    case 'manager':
      // `/manufacturing` is manager-and-above: production planning is a
      // supervisory surface, so stock clerks and cashiers do not get it even
      // though they keep the Supply Chain children they already had.
      // BOM routes (/manufacturing/bom, /manufacturing/production, etc.) share
      // the same authority as the workspace itself.
      if (path.startsWith('/manufacturing')) return true;
      return ['/pos', '/pos/shifts', '/pos/reports', '/dashboard', '/income', '/expenses', '/invoices', '/contacts', '/products', '/warehouse', '/transfers', '/inventory', '/reports', '/reports/trial-balance', '/reports/profit-loss', '/reports/balance-sheet', '/reports/cash-flow', '/manufacturing'].includes(path);

    case 'stock_clerk':
      return ['/products', '/warehouse', '/transfers', '/inventory'].includes(path);

    case 'purchasing_officer':
      return ['/expenses', '/contacts', '/products', '/warehouse', '/transfers', '/inventory', '/dashboard'].includes(path);

    case 'warehouse_worker':
      return ['/dashboard', '/products', '/warehouse', '/transfers', '/inventory'].includes(path);

    case 'sales_manager':
      return ['/dashboard', '/income', '/expenses', '/invoices', '/contacts', '/products', '/warehouse', '/transfers', '/inventory', '/reports', '/reports/trial-balance', '/reports/profit-loss', '/reports/balance-sheet', '/reports/cash-flow', '/pos', '/pos/shifts', '/pos/reports'].includes(path);

    case 'customer_service_rep':
      return ['/dashboard', '/income', '/expenses', '/invoices', '/contacts', '/products', '/pos'].includes(path);

    case 'tax_compliance_officer':
      return ['/dashboard', '/tax', '/reports', '/reports/trial-balance', '/reports/profit-loss', '/reports/balance-sheet', '/reports/cash-flow', '/journals', '/accounts', '/income', '/expenses', '/invoices', '/contacts'].includes(path);

    case 'treasury_manager':
      return isBankReconciliationPath || ['/dashboard', '/bank-reconcile', '/accounts', '/capital', '/assets', '/income', '/expenses', '/invoices', '/contacts', '/reports', '/reports/trial-balance', '/reports/profit-loss', '/reports/balance-sheet', '/reports/cash-flow'].includes(path);

    case 'asset_manager':
      return ['/dashboard', '/assets', '/capital', '/accounts', '/reports', '/reports/trial-balance', '/reports/profit-loss', '/reports/balance-sheet', '/reports/cash-flow'].includes(path);

    case 'board_member':
      if (path === '/payroll' || path === '/settings') return false;
      return true;

    case 'inventory_manager':
      return ['/products', '/warehouse', '/transfers', '/inventory'].includes(path);

    case 'supervisor':
      if (path === '/payroll' || path === '/reports' || path.startsWith('/reports/')) return false;
      return true;

    case 'auditor':
    case 'viewer':
      if (path === '/payroll') return false;
      return true;

    case 'payroll_manager':
      if (isBankReconciliationPath || ['/reports', '/products', '/warehouse', '/transfers', '/accounts', '/tax', '/assets', '/capital', '/journals', '/bank-reconcile', '/periods', '/audit', '/branches', '/locations', '/departments', '/reports/trial-balance', '/reports/profit-loss', '/reports/balance-sheet', '/reports/cash-flow'].includes(path)) {
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

/**
 * Home path for a role, optionally narrowed by the business's organisation
 * capabilities.
 *
 * The till roles (`cashier`, `manager`) default to `/pos` — but POS is a
 * retail workflow: a construction or service-only business has
 * `pos: false`, so its cashier/manager was being sent home to a page the
 * capability gate immediately rejected. When the caller supplies the
 * organisation-capability predicate (the same one navigation uses,
 * `useOrganisationCapabilityVisibility`), a `/pos` home is downgraded for a
 * business without the `pos` capability. Callers that pass no predicate
 * keep the legacy role-only mapping, byte for byte.
 *
 * The downgrade lands on `/dashboard` only when the role may actually open
 * it. A `manager` can; a `cashier` cannot (`isPathAllowedForRole` confines
 * cashiers to the till, sales documents and support), so sending a cashier
 * "home" to `/dashboard` would make `RoleRoute` bounce them straight back
 * to their home path — `/dashboard` — forever. Cashiers therefore fall
 * back to `/income`, the first surface their role is allowed to use. Role
 * definitions are untouched: cashier and manager stay valid roles for a
 * construction business; only where they land changes.
 *
 * Because the predicate runs through `resolveCapability`, and POS is in
 * ALWAYS_PROFILE_GATED, the downgrade activates on exactly the same terms
 * as the POS nav item and the `/pos` route gate on both kill-switch
 * states: a business whose profile gives it POS keeps `/pos` as a working
 * home page, and one without it never lands there.
 */
export function getHomePathForRole(
  role: string | null,
  isOrgCapabilityEnabled?: (capability: OrganisationCapability) => boolean,
): string {
  const roleHome = roleHomePath(role);

  if (
    roleHome === '/pos'
    && isOrgCapabilityEnabled
    && !isOrgCapabilityEnabled('pos')
  ) {
    return isPathAllowedForRole(role, '/dashboard') ? '/dashboard' : '/income';
  }

  return roleHome;
}

/** The legacy role-only home mapping, unchanged. */
function roleHomePath(role: string | null): string {
  if (role === 'cashier') return '/pos';
  if (role === 'manager') return '/pos';
  if (role === 'stock_clerk') return '/products';
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
