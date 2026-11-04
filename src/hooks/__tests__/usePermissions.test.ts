import { describe, expect, it } from 'vitest';
import { getHomePathForRole, isPathAllowedForRole } from '../usePermissions';

describe('Role-Based Access Control (RBAC)', () => {
  const allRoles = [
    'owner',
    'admin',
    'accountant',
    'payroll_manager',
    'supervisor',
    'data_entry',
    'inventory_manager',
    'sales_clerk',
    'auditor',
    'viewer',
    'purchasing_officer',
    'warehouse_worker',
    'sales_manager',
    'customer_service_rep',
    'tax_compliance_officer',
    'treasury_manager',
    'asset_manager',
    'board_member',
    'branch_manager',
    'cashier',
    'manager',
    'stock_clerk',
  ];

  describe('Sales Clerk & Data Entry restrictions', () => {
    it('allows sales documents and denies back-office routes', () => {
      for (const role of ['sales_clerk', 'data_entry']) {
        expect(isPathAllowedForRole(role, '/income')).toBe(true);
        expect(isPathAllowedForRole(role, '/expenses')).toBe(true);
        expect(isPathAllowedForRole(role, '/invoices')).toBe(true);
        expect(isPathAllowedForRole(role, '/dashboard')).toBe(false);
        expect(isPathAllowedForRole(role, '/payroll')).toBe(false);
        expect(isPathAllowedForRole(role, '/reports/trial-balance')).toBe(false);
        expect(isPathAllowedForRole(role, '/products')).toBe(false);
      }
    });

    it('returns the correct home path', () => {
      expect(getHomePathForRole('sales_clerk')).toBe('/income');
      expect(getHomePathForRole('data_entry')).toBe('/income');
    });
  });

  describe('Construction workspace routing', () => {
    it('allows operational roles and excludes sales-only roles', () => {
      const allowedRoles = [
        'owner',
        'admin',
        'manager',
        'stock_clerk',
        'inventory_manager',
        'warehouse_worker',
        'purchasing_officer',
      ];

      for (const role of allowedRoles) {
        expect(isPathAllowedForRole(role, '/construction')).toBe(true);
        expect(isPathAllowedForRole(role, '/construction/subcontractors')).toBe(true);
      }

      const deniedRoles = [
        'cashier',
        'sales_clerk',
        'data_entry',
        'sales_manager',
        'customer_service_rep',
      ];

      for (const role of deniedRoles) {
        expect(isPathAllowedForRole(role, '/construction')).toBe(false);
      }
    });
  });

  describe('Payroll Manager restrictions', () => {
    it('allows payroll routes while blocking accounting and inventory routes', () => {
      expect(isPathAllowedForRole('payroll_manager', '/payroll')).toBe(true);
      expect(isPathAllowedForRole('payroll_manager', '/payroll/employees')).toBe(true);
      expect(isPathAllowedForRole('payroll_manager', '/payroll/employees/new')).toBe(true);
      expect(isPathAllowedForRole('payroll_manager', '/payroll/employees/employee-1')).toBe(true);
      expect(isPathAllowedForRole('payroll_manager', '/payroll/leave')).toBe(true);
      expect(isPathAllowedForRole('payroll_manager', '/dashboard')).toBe(true);
      expect(isPathAllowedForRole('payroll_manager', '/reports/trial-balance')).toBe(false);
      expect(isPathAllowedForRole('payroll_manager', '/products')).toBe(false);
      expect(isPathAllowedForRole('payroll_manager', '/accounts')).toBe(false);
    });
  });

  describe('Payroll route restrictions', () => {
    it('blocks the payroll route and its subroutes for restricted roles', () => {
      const restrictedRoles = ['board_member', 'auditor', 'viewer', 'branch_manager'];
      const payrollPaths = ['/payroll', '/payroll/employees', '/payroll/leave'];

      for (const role of restrictedRoles) {
        for (const path of payrollPaths) {
          expect(isPathAllowedForRole(role, path)).toBe(false);
        }
      }
    });

    it('does not treat similarly prefixed non-payroll routes as payroll routes', () => {
      expect(isPathAllowedForRole('board_member', '/payrollish')).toBe(true);
    });
  });

  describe('Supervisor & Auditor restrictions', () => {
    it('blocks payroll for supervisors, auditors, and viewers', () => {
      expect(isPathAllowedForRole('supervisor', '/payroll')).toBe(false);
      expect(isPathAllowedForRole('supervisor', '/reports/trial-balance')).toBe(false);
      expect(isPathAllowedForRole('auditor', '/payroll')).toBe(false);
      expect(isPathAllowedForRole('auditor', '/payroll/employees')).toBe(false);
      expect(isPathAllowedForRole('viewer', '/payroll')).toBe(false);
      expect(isPathAllowedForRole('viewer', '/payroll/employees')).toBe(false);
    });
  });

  describe('Inventory Manager & Warehouse Worker', () => {
    it('allows inventory routes and denies payroll', () => {
      for (const role of ['inventory_manager', 'warehouse_worker']) {
        expect(isPathAllowedForRole(role, '/products')).toBe(true);
        expect(isPathAllowedForRole(role, '/warehouse')).toBe(true);
        expect(isPathAllowedForRole(role, '/transfers')).toBe(true);
        expect(isPathAllowedForRole(role, '/payroll')).toBe(false);
      }
    });

    it('returns the correct home path', () => {
      expect(getHomePathForRole('inventory_manager')).toBe('/products');
      expect(getHomePathForRole('warehouse_worker')).toBe('/products');
    });
  });

  describe('Specialized role path validation', () => {
    it('gives purchasing officers the expected access', () => {
      expect(isPathAllowedForRole('purchasing_officer', '/expenses')).toBe(true);
      expect(isPathAllowedForRole('purchasing_officer', '/products')).toBe(true);
      expect(isPathAllowedForRole('purchasing_officer', '/payroll')).toBe(false);
    });

    it('gives board members read access while excluding payroll and settings', () => {
      expect(isPathAllowedForRole('board_member', '/reports/trial-balance')).toBe(true);
      expect(isPathAllowedForRole('board_member', '/dashboard')).toBe(true);
      expect(isPathAllowedForRole('board_member', '/payroll')).toBe(false);
      expect(isPathAllowedForRole('board_member', '/settings')).toBe(false);
    });
  });

  describe('POS roles', () => {
    it('confines cashiers to the till, sales documents, and support', () => {
      expect(isPathAllowedForRole('cashier', '/pos')).toBe(true);
      expect(isPathAllowedForRole('cashier', '/income')).toBe(true);
      expect(isPathAllowedForRole('cashier', '/invoices')).toBe(true);
      expect(isPathAllowedForRole('cashier', '/support')).toBe(true);
      expect(isPathAllowedForRole('cashier', '/settings')).toBe(false);
      expect(isPathAllowedForRole('cashier', '/reports/trial-balance')).toBe(false);
      expect(isPathAllowedForRole('cashier', '/expenses')).toBe(false);
      expect(isPathAllowedForRole('cashier', '/payroll')).toBe(false);
      expect(getHomePathForRole('cashier')).toBe('/pos');
    });

    it('allows managers the till and their supervised back-office routes', () => {
      const allowedPaths = [
        '/pos',
        '/dashboard',
        '/products',
        '/warehouse',
        '/transfers',
        '/reports/trial-balance',
      ];

      for (const path of allowedPaths) {
        expect(isPathAllowedForRole('manager', path)).toBe(true);
      }

      expect(isPathAllowedForRole('manager', '/settings')).toBe(false);
      expect(isPathAllowedForRole('manager', '/payroll')).toBe(false);
      expect(getHomePathForRole('manager')).toBe('/pos');
    });

    it('limits stock clerks to stock routes and denies POS access', () => {
      for (const path of ['/products', '/warehouse', '/transfers']) {
        expect(isPathAllowedForRole('stock_clerk', path)).toBe(true);
      }

      expect(isPathAllowedForRole('stock_clerk', '/pos')).toBe(false);
      expect(isPathAllowedForRole('stock_clerk', '/dashboard')).toBe(false);
      expect(getHomePathForRole('stock_clerk')).toBe('/products');
    });

    it('gives each POS role at least one primary mobile navigation tab', () => {
      const primaryPaths = [
        '/dashboard',
        '/pos',
        '/income',
        '/products',
        '/reports/trial-balance',
      ];

      for (const role of ['cashier', 'manager', 'stock_clerk']) {
        expect(primaryPaths.some((path) => isPathAllowedForRole(role, path))).toBe(true);
      }
    });
  });

  describe('Home paths', () => {
    it('defines a valid home path for every role', () => {
      for (const role of allRoles) {
        const home = getHomePathForRole(role);
        expect(home).toBeTypeOf('string');
        expect(home.startsWith('/')).toBe(true);
      }
    });
  });
});
