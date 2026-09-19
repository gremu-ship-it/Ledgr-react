import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import { hasPosPermission, type PosPermission, type PosSettings } from '@/types/pos';

export interface PosUserPermissions {
  role: string | null;
  isOwnerOrAdmin: boolean;
  isManager: boolean;
  isCashier: boolean;

  canViewSales: boolean;
  canCreateSale: boolean;
  canEditSale: boolean;
  canVoidSale: boolean;
  canVoidSales: boolean;
  canRefundSale: boolean;
  canProcessReturns: boolean;
  canApplyDiscount: boolean;
  canApplyLineDiscount: boolean;
  canApplyOrderDiscount: boolean;
  canApplyHighDiscount: boolean;
  canViewInventory: boolean;
  canAdjustInventory: boolean;
  canTransferStock: boolean;
  canReceiveStock: boolean;
  canViewReports: boolean;
  canViewProfit: boolean;
  canViewExpenses: boolean;
  canViewCashPosition: boolean;
  canManageProducts: boolean;
  canManagePrices: boolean;
  canManageUsers: boolean;
  canManageBranches: boolean;
  canManageRegisters: boolean;
  canOpenShift: boolean;
  canCloseShift: boolean;
  canOpenCloseShift: boolean;
  canViewAuditLog: boolean;
  canSellOnCredit: boolean;
  canCashDrawerMovement: boolean;
  canRecordCashMovement: boolean;
  canViewAllCashiersSales: boolean;
  canViewAllBranches: boolean;
  canViewCostPrice: boolean;
  canViewCosts: boolean;
  canViewOwnerAnalytics: boolean;
  canViewOwnerDashboard: boolean;
  canEditSettings: boolean;

  maxDiscountPercent: number;
  maxCashierDiscountPercent: number;
  maxAllowedDiscount: number;
  settings: PosSettings;
  hasPermission: (permission: PosPermission) => boolean;
}

const DEFAULT_SETTINGS_FALLBACK: PosSettings = {
  business_id: '',
  enabled_payment_methods: ['cash', 'airtel_money', 'tnm_mpamba', 'bank_transfer', 'credit_sale'],
  max_cashier_discount_percent: 10,
  max_manager_discount_percent: 25,
  cashier_max_discount_percent: 10,
  manager_max_discount_percent: 25,
  cash_variance_threshold: 500,
  require_explanation_variance_threshold: 500,
  require_manager_approval_discount: true,
  require_manager_approval_void: true,
  require_manager_approval_refund: true,
  require_manager_approval_price_override: true,
  allow_negative_stock_sales: false,
  default_tax_rate: 16.5,
  receipt_header: null,
  receipt_footer: 'Zikomo kwambiri! Thank you for your business.',
  show_tax_on_receipt: true,
};

export function usePosPermissions(): PosUserPermissions {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business?.id;
  const role = currentBusiness?.role || null;

  const { data: dbSettings } = useQuery({
    queryKey: ['pos_settings', businessId],
    queryFn: () => (businessId ? repos.pos.getSettings(businessId) : Promise.resolve(DEFAULT_SETTINGS_FALLBACK)),
    enabled: Boolean(businessId),
    staleTime: 1000 * 60 * 5,
  });

  const settings: PosSettings = dbSettings || DEFAULT_SETTINGS_FALLBACK;

  const check = (p: PosPermission): boolean => {
    return hasPosPermission(role, p, settings?.custom_role_permissions as any);
  };

  const isOwnerOrAdmin = role === 'owner' || role === 'admin';
  const isManager = role === 'manager' || role === 'sales_manager' || role === 'branch_manager';
  const isCashier = role === 'cashier' || role === 'sales_clerk';

  // Calculate maximum authorized discount percentage without needing manager approval
  let maxDiscount = 0;
  if (isOwnerOrAdmin) {
    maxDiscount = 100;
  } else if (isManager) {
    maxDiscount = settings.max_manager_discount_percent ?? settings.manager_max_discount_percent ?? 25;
  } else if (isCashier || check('apply_discount')) {
    maxDiscount = settings.max_cashier_discount_percent ?? settings.cashier_max_discount_percent ?? 10;
  }

  const cashierMax = settings.max_cashier_discount_percent ?? settings.cashier_max_discount_percent ?? 10;

  // Cost price / profit margin visibility check (Owner, Manager, Accountant only - NEVER Cashier)
  const canViewCosts = isOwnerOrAdmin || role === 'accountant' || role === 'auditor' || isManager;

  // Owner analytics view check
  const canViewOwnerAnalytics = isOwnerOrAdmin || isManager || role === 'accountant';

  // Settings modification check
  const canEditSettings = isOwnerOrAdmin || isManager;

  const requireApprovalVoid = settings.require_manager_approval_void ?? settings.require_approval_for_void ?? true;
  const requireApprovalRefund = settings.require_manager_approval_refund ?? settings.require_approval_for_refund ?? true;

  const canVoid = isOwnerOrAdmin || isManager || (!requireApprovalVoid && check('void_sale'));
  const canRefund = isOwnerOrAdmin || isManager || (!requireApprovalRefund && check('refund_sale'));

  return {
    role,
    isOwnerOrAdmin,
    isManager,
    isCashier,

    canViewSales: check('view_sales'),
    canCreateSale: check('create_sale'),
    canEditSale: check('edit_sale'),
    canVoidSale: canVoid,
    canVoidSales: canVoid,
    canRefundSale: canRefund,
    canProcessReturns: canRefund,
    canApplyDiscount: check('apply_discount') || isCashier || isManager || isOwnerOrAdmin,
    canApplyLineDiscount: check('apply_discount') || isCashier || isManager || isOwnerOrAdmin,
    canApplyOrderDiscount: check('apply_discount') || isCashier || isManager || isOwnerOrAdmin,
    canApplyHighDiscount: check('apply_high_discount') || isManager || isOwnerOrAdmin,
    canViewInventory: check('view_inventory'),
    canAdjustInventory: check('adjust_inventory'),
    canTransferStock: check('transfer_stock'),
    canReceiveStock: check('receive_stock'),
    canViewReports: check('view_reports'),
    canViewProfit: check('view_profit'),
    canViewExpenses: check('view_expenses'),
    canViewCashPosition: check('view_cash_position'),
    canManageProducts: check('manage_products'),
    canManagePrices: check('manage_prices'),
    canManageUsers: check('manage_users'),
    canManageBranches: check('manage_branches'),
    canManageRegisters: check('manage_branches') || isOwnerOrAdmin,
    canOpenShift: check('open_shift') || isCashier || isManager || isOwnerOrAdmin,
    canCloseShift: check('close_shift') || isCashier || isManager || isOwnerOrAdmin,
    canOpenCloseShift: check('open_shift') || isCashier || isManager || isOwnerOrAdmin,
    canViewAuditLog: check('view_audit_log') || isOwnerOrAdmin,
    canSellOnCredit: check('sell_on_credit') || isManager || isOwnerOrAdmin,
    canCashDrawerMovement: check('cash_drawer_movement') || isCashier || isManager || isOwnerOrAdmin,
    canRecordCashMovement: check('cash_drawer_movement') || isCashier || isManager || isOwnerOrAdmin,
    canViewAllCashiersSales: check('view_all_cashiers_sales') || isOwnerOrAdmin || isManager,
    canViewAllBranches: check('view_all_branches') || isOwnerOrAdmin,
    canViewCostPrice: canViewCosts,
    canViewCosts,
    canViewOwnerAnalytics,
    canViewOwnerDashboard: canViewOwnerAnalytics,
    canEditSettings,

    maxDiscountPercent: maxDiscount,
    maxCashierDiscountPercent: cashierMax,
    maxAllowedDiscount: maxDiscount,
    settings,
    hasPermission: check,
  };
}
