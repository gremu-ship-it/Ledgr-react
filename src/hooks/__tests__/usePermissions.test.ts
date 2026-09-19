import { describe, it, expect } from 'vitest';
import { isPathAllowedForRole, getHomePathForRole } from '../usePermissions';

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
    // POS roles (20260920000000_pos_module.sql)
    'cashier',
    'manager',
    'stock_clerk',
  ];

  describe('Sales Clerk & Data Entry restrictions', () => {
    it('only allows income, expenses, and invoices', () => {
      ['sales_clerk', 'data_entry'].forEach((role) => {
        expect(isPathAllowedForRole(role, '/income')).toBe(true);
        expect(isPathAllowedForRole(role, '/expenses')).toBe(true);
        expect(isPathAllowedForRole(role, '/invoices')).toBe(true);
        expect(isPathAllowedForRole(role, '/dashboard')).toBe(false);
        expect(isPathAllowedForRole(role, '/payroll')).toBe(false);
        expect(isPathAllowedForRole(role, '/reports')).toBe(false);
        expect(isPathAllowedForRole(role, '/products')).toBe(false);
      });
    });

    it('returns correct home path', () => {
      expect(getHomePathForRole('sales_clerk')).toBe('/income');
      expect(getHomePathForRole('data_entry')).toBe('/income');
    });
  });

  describe('Payroll Manager restrictions', () => {
    it('blocks accounting and inventory reports', () => {
      expect(isPathAllowedForRole('payroll_manager', '/payroll')).toBe(true);
      expect(isPathAllowedForRole('payroll_manager', '/dashboard')).toBe(true);
      expect(isPathAllowedForRole('payroll_manager', '/reports')).toBe(false);
      expect(isPathAllowedForRole('payroll_manager', '/products')).toBe(false);
      expect(isPathAllowedForRole('payroll_manager', '/accounts')).toBe(false);
    });
  });

  describe('Supervisor & Auditor payroll restrictions', () => {
    it('blocks payroll for supervisor and auditor', () => {
      expect(isPathAllowedForRole('supervisor', '/payroll')).toBe(false);
      expect(isPathAllowedForRole('supervisor', '/reports')).toBe(false);
      expect(isPathAllowedForRole('auditor', '/payroll')).toBe(false);
      expect(isPathAllowedForRole('viewer', '/payroll')).toBe(false);
    });
  });

  describe('Inventory Manager & Warehouse Worker', () => {
    it('restricts to inventory and products', () => {
      ['inventory_manager', 'warehouse_worker'].forEach((role) => {
        expect(isPathAllowedForRole(role, '/products')).toBe(true);
        expect(isPathAllowedForRole(role, '/warehouse')).toBe(true);
        expect(isPathAllowedForRole(role, '/transfers')).toBe(true);
        expect(isPathAllowedForRole(role, '/inventory')).toBe(true);
        expect(isPathAllowedForRole(role, '/payroll')).toBe(false);
      });
    });

    it('returns correct home path', () => {
      expect(getHomePathForRole('inventory_manager')).toBe('/products');
      expect(getHomePathForRole('warehouse_worker')).toBe('/products');
    });
  });

  describe('Specialized Roles path validation', () => {
    it('purchasing officer has correct access', () => {
      expect(isPathAllowedForRole('purchasing_officer', '/expenses')).toBe(true);
      expect(isPathAllowedForRole('purchasing_officer', '/products')).toBe(true);
      expect(isPathAllowedForRole('purchasing_officer', '/payroll')).toBe(false);
    });

    it('board member has high-level read access excluding payroll and settings', () => {
      expect(isPathAllowedForRole('board_member', '/reports')).toBe(true);
      expect(isPathAllowedForRole('board_member', '/dashboard')).toBe(true);
      expect(isPathAllowedForRole('board_member', '/payroll')).toBe(false);
      expect(isPathAllowedForRole('board_member', '/settings')).toBe(false);
    });
  });

  describe('POS roles', () => {
    it('cashier is confined to the till, sales documents and support', () => {
      expect(isPathAllowedForRole('cashier', '/pos')).toBe(true);
      expect(isPathAllowedForRole('cashier', '/income')).toBe(true);
      expect(isPathAllowedForRole('cashier', '/invoices')).toBe(true);
      expect(isPathAllowedForRole('cashier', '/support')).toBe(true);
      // No back-office surfaces: these bounce to the role's home (/pos).
      expect(isPathAllowedForRole('cashier', '/settings')).toBe(false);
      expect(isPathAllowedForRole('cashier', '/reports')).toBe(false);
      expect(isPathAllowedForRole('cashier', '/expenses')).toBe(false);
      expect(isPathAllowedForRole('cashier', '/payroll')).toBe(false);
      expect(getHomePathForRole('cashier')).toBe('/pos');
    });

    it('manager keeps the till plus the back-office pages it supervises', () => {
      ['/pos', '/dashboard', '/products', '/warehouse', '/transfers', '/reports'].forEach((path) => {
        expect(isPathAllowedForRole('manager', path)).toBe(true);
      });
      expect(isPathAllowedForRole('manager', '/settings')).toBe(false);
      expect(isPathAllowedForRole('manager', '/payroll')).toBe(false);
      expect(getHomePathForRole('manager')).toBe('/pos');
    });

    it('stock clerk handles stock only and gets no POS access', () => {
      ['/products', '/warehouse', '/transfers', '/inventory'].forEach((path) => {
        expect(isPathAllowedForRole('stock_clerk', path)).toBe(true);
      });
      expect(isPathAllowedForRole('stock_clerk', '/pos')).toBe(false);
      expect(isPathAllowedForRole('stock_clerk', '/dashboard')).toBe(false);
      expect(getHomePathForRole('stock_clerk')).toBe('/products');
    });

    it('gives every POS role at least one primary tab for the mobile bar', () => {
      // BottomNav filters its tabs through isPathAllowedForRole; a role with
      // nothing allowed would render a bar with only the FAB and "More".
      const primaryPaths = ['/dashboard', '/pos', '/income', '/products', '/reports'];
      ['cashier', 'manager', 'stock_clerk'].forEach((role) => {
        expect(primaryPaths.some((p) => isPathAllowedForRole(role, p))).toBe(true);
      });
    });
  });

  describe('All roles have home paths defined', () => {
    it('does not return undefined home path', () => {
      allRoles.forEach((role) => {
        const home = getHomePathForRole(role);
        expect(home).toBeTypeOf('string');
        expect(home.startsWith('/')).toBe(true);
      });
    });
  });
});
