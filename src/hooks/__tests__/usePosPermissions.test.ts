// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePosPermissions } from '../usePosPermissions';
import { useAppStore } from '@/store/useAppStore';
import { isPathAllowedForRole, getHomePathForRole } from '../usePermissions';

// Mock react-query
vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn().mockReturnValue({
    data: {
      max_cashier_discount_percent: 10,
      max_manager_discount_percent: 25,
      cash_variance_threshold: 500,
      enabled_payment_methods: ['cash', 'airtel_money', 'tnm_mpamba', 'bank_transfer', 'credit_sale'],
      require_manager_approval_discount: true,
      require_manager_approval_void: true,
      require_manager_approval_refund: true,
      require_manager_approval_price_override: true,
      allow_negative_stock_sales: false,
      default_tax_rate: 16.5,
    },
  }),
}));

describe('usePosPermissions & Role-Based Access Control', () => {
  beforeEach(() => {
    useAppStore.setState({
      currentUser: { id: 'user-1', email: 'cashier@ledgr.test', fullName: 'John Banda' } as any,
      currentBusiness: {
        role: 'cashier',
        business: { id: 'biz-001', name: 'Test Business' } as any,
      } as any,
    });
  });

  it('correctly restricts cashier permissions: no cost visibility, no owner analytics, capped discount', () => {
    useAppStore.setState({
      currentBusiness: {
        role: 'cashier',
        business: { id: 'biz-001', name: 'Test Business' } as any,
      } as any,
    });

    const { result } = renderHook(() => usePosPermissions());

    expect(result.current.role).toBe('cashier');
    expect(result.current.canViewCosts).toBe(false);
    expect(result.current.canViewOwnerAnalytics).toBe(false);
    expect(result.current.canEditSettings).toBe(false);
    expect(result.current.canVoidSale).toBe(false);
    expect(result.current.canRefundSale).toBe(false);
    expect(result.current.maxAllowedDiscount).toBe(10);
  });

  it('correctly grants manager permissions: cost visibility, owner analytics, void/refund authorization', () => {
    useAppStore.setState({
      currentBusiness: {
        role: 'manager',
        business: { id: 'biz-001', name: 'Test Business' } as any,
      } as any,
    });

    const { result } = renderHook(() => usePosPermissions());

    expect(result.current.role).toBe('manager');
    expect(result.current.canViewCosts).toBe(true);
    expect(result.current.canViewOwnerAnalytics).toBe(true);
    expect(result.current.canEditSettings).toBe(true);
    expect(result.current.canVoidSale).toBe(true);
    expect(result.current.canRefundSale).toBe(true);
    expect(result.current.maxAllowedDiscount).toBe(25);
  });

  it('correctly grants owner full permissions', () => {
    useAppStore.setState({
      currentBusiness: {
        role: 'owner',
        business: { id: 'biz-001', name: 'Test Business' } as any,
      } as any,
    });

    const { result } = renderHook(() => usePosPermissions());

    expect(result.current.role).toBe('owner');
    expect(result.current.canViewCosts).toBe(true);
    expect(result.current.canViewOwnerAnalytics).toBe(true);
    expect(result.current.canEditSettings).toBe(true);
    expect(result.current.canVoidSale).toBe(true);
    expect(result.current.canRefundSale).toBe(true);
    expect(result.current.maxAllowedDiscount).toBe(100);
  });

  it('enforces route permissions and home paths for cashier, manager, and stock clerk', () => {
    // Cashier routes
    expect(isPathAllowedForRole('cashier', '/pos')).toBe(true);
    expect(isPathAllowedForRole('cashier', '/accounts')).toBe(false);
    expect(isPathAllowedForRole('cashier', '/reports')).toBe(false);
    expect(isPathAllowedForRole('cashier', '/tax')).toBe(false);
    expect(getHomePathForRole('cashier')).toBe('/pos');

    // Manager routes
    expect(isPathAllowedForRole('manager', '/pos')).toBe(true);
    expect(isPathAllowedForRole('manager', '/dashboard')).toBe(true);
    expect(isPathAllowedForRole('manager', '/invoices')).toBe(true);
    expect(isPathAllowedForRole('manager', '/tax')).toBe(false);
    expect(getHomePathForRole('manager')).toBe('/pos');

    // Stock Clerk routes
    expect(isPathAllowedForRole('stock_clerk', '/products')).toBe(true);
    expect(isPathAllowedForRole('stock_clerk', '/warehouse')).toBe(true);
    expect(isPathAllowedForRole('stock_clerk', '/transfers')).toBe(true);
    expect(isPathAllowedForRole('stock_clerk', '/pos')).toBe(false);
    expect(isPathAllowedForRole('stock_clerk', '/accounts')).toBe(false);
    expect(getHomePathForRole('stock_clerk')).toBe('/products');
  });
});
