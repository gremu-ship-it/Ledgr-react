export type PosPaymentMethod =
  | 'cash'
  | 'airtel_money'
  | 'tnm_mpamba'
  | 'bank_transfer'
  | 'card'
  | 'credit'
  | 'credit_sale'
  | 'other';

export type PosPermission =
  | 'view_sales'
  | 'create_sale'
  | 'edit_sale'
  | 'void_sale'
  | 'refund_sale'
  | 'apply_discount'
  | 'apply_high_discount'
  | 'view_inventory'
  | 'adjust_inventory'
  | 'transfer_stock'
  | 'receive_stock'
  | 'view_reports'
  | 'view_profit'
  | 'view_expenses'
  | 'view_cash_position'
  | 'manage_products'
  | 'manage_prices'
  | 'manage_users'
  | 'manage_branches'
  | 'open_shift'
  | 'close_shift'
  | 'view_audit_log'
  | 'sell_on_credit'
  | 'cash_drawer_movement'
  | 'view_all_cashiers_sales'
  | 'view_all_branches';

export const DEFAULT_ROLE_PERMISSIONS: Record<string, PosPermission[]> = {
  owner: [
    'view_sales', 'create_sale', 'edit_sale', 'void_sale', 'refund_sale',
    'apply_discount', 'apply_high_discount', 'view_inventory', 'adjust_inventory',
    'transfer_stock', 'receive_stock', 'view_reports', 'view_profit',
    'view_expenses', 'view_cash_position', 'manage_products', 'manage_prices',
    'manage_users', 'manage_branches', 'open_shift', 'close_shift',
    'view_audit_log', 'sell_on_credit', 'cash_drawer_movement',
    'view_all_cashiers_sales', 'view_all_branches',
  ],
  admin: [
    'view_sales', 'create_sale', 'edit_sale', 'void_sale', 'refund_sale',
    'apply_discount', 'apply_high_discount', 'view_inventory', 'adjust_inventory',
    'transfer_stock', 'receive_stock', 'view_reports', 'view_profit',
    'view_expenses', 'view_cash_position', 'manage_products', 'manage_prices',
    'manage_users', 'manage_branches', 'open_shift', 'close_shift',
    'view_audit_log', 'sell_on_credit', 'cash_drawer_movement',
    'view_all_cashiers_sales', 'view_all_branches',
  ],
  manager: [
    'view_sales', 'create_sale', 'edit_sale', 'void_sale', 'refund_sale',
    'apply_discount', 'apply_high_discount', 'view_inventory', 'adjust_inventory',
    'transfer_stock', 'receive_stock', 'view_reports', 'open_shift', 'close_shift',
    'sell_on_credit', 'cash_drawer_movement', 'view_all_cashiers_sales',
    'view_all_branches',
  ],
  branch_manager: [
    'view_sales', 'create_sale', 'edit_sale', 'void_sale', 'refund_sale',
    'apply_discount', 'apply_high_discount', 'view_inventory', 'adjust_inventory',
    'transfer_stock', 'receive_stock', 'view_reports', 'open_shift', 'close_shift',
    'sell_on_credit', 'cash_drawer_movement', 'view_all_cashiers_sales',
  ],
  sales_manager: [
    'view_sales', 'create_sale', 'edit_sale', 'void_sale', 'refund_sale',
    'apply_discount', 'apply_high_discount', 'view_inventory', 'view_reports',
    'open_shift', 'close_shift', 'sell_on_credit', 'cash_drawer_movement',
    'view_all_cashiers_sales',
  ],
  cashier: [
    'view_sales', 'create_sale', 'view_inventory', 'apply_discount',
    'open_shift', 'close_shift', 'cash_drawer_movement', 'refund_sale',
  ],
  sales_clerk: [
    'view_sales', 'create_sale', 'view_inventory', 'apply_discount',
    'open_shift', 'close_shift', 'cash_drawer_movement', 'refund_sale',
  ],
  stock_clerk: [
    'view_inventory', 'adjust_inventory', 'transfer_stock', 'receive_stock',
  ],
  warehouse_worker: [
    'view_inventory', 'adjust_inventory', 'transfer_stock', 'receive_stock',
  ],
  inventory_manager: [
    'view_inventory', 'adjust_inventory', 'transfer_stock', 'receive_stock', 'manage_products',
  ],
  accountant: [
    'view_sales', 'view_reports', 'view_profit', 'view_expenses',
    'view_cash_position', 'view_inventory', 'view_audit_log',
  ],
  auditor: [
    'view_sales', 'view_reports', 'view_profit', 'view_expenses',
    'view_cash_position', 'view_inventory', 'view_audit_log',
  ],
  viewer: [
    'view_sales', 'view_reports',
  ],
};

export function hasPosPermission(
  role: string | null | undefined,
  permission: PosPermission,
  customRolePermissions?: Record<string, PosPermission[]>,
): boolean {
  if (!role) return false;
  if (role === 'owner' || role === 'admin') return true;
  if (customRolePermissions && customRolePermissions[role]) {
    return customRolePermissions[role].includes(permission);
  }
  const perms = DEFAULT_ROLE_PERMISSIONS[role] || [];
  return perms.includes(permission);
}

export interface PosRegister {
  id: string;
  business_id?: string;
  branch_id?: string | null;
  name: string;
  code?: string;
  is_active?: boolean;
  created_at?: string;
}

export interface PosProduct {
  id: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  unit_price?: number;
  unitPrice?: number;
  selling_price?: number;
  cost_price?: number;
  costPrice?: number;
  stock_quantity?: number;
  stockQuantity?: number;
  category?: string | null;
  category_id?: string | null;
  tax_rate?: number;
  is_active?: boolean;
}

export interface PosShift {
  id: string;
  business_id: string;
  branch_id: string | null;
  shift_number?: string;
  terminal_id?: string;
  cashier_id: string | null;
  cashier_name: string | null;
  opened_at: string;
  start_time?: string;
  closed_at: string | null;
  end_time?: string | null;
  opening_float?: number;
  opening_cash?: number;
  expected_cash: number;
  expectedCash?: number;
  closing_cash_actual?: number | null;
  actual_cash?: number | null;
  variance?: number | null;
  cash_variance?: number | null;
  variance_reason: string | null;
  total_sales_amount: number;
  cash_sales_amount: number;
  other_sales_amount: number;
  refunds_amount: number;
  cash_in_amount: number;
  cash_out_amount: number;
  status: 'open' | 'closed';
  notes: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface PosCashMovement {
  id: string;
  business_id: string;
  branch_id: string | null;
  shift_id: string | null;
  cashier_id?: string | null;
  cashier_name?: string | null;
  user_id?: string | null;
  user_name?: string | null;
  movement_type: 'cash_in' | 'cash_out' | 'petty_cash' | 'safe_drop' | 'safe_deposit';
  amount: number;
  reason: string;
  notes?: string | null;
  authorized_by?: string | null;
  created_at?: string;
}

export interface PosSettings {
  id?: string;
  business_id: string;
  enabled_payment_methods: string[];
  max_cashier_discount_percent: number;
  max_manager_discount_percent: number;
  cashier_max_discount_percent?: number;
  manager_max_discount_percent?: number;
  require_manager_approval_discount?: boolean;
  require_manager_approval_void?: boolean;
  require_manager_approval_refund?: boolean;
  require_manager_approval_price_override?: boolean;
  require_approval_for_void?: boolean;
  require_approval_for_refund?: boolean;
  cash_variance_threshold: number;
  require_explanation_variance_threshold?: number;
  allow_negative_stock_sales?: boolean;
  default_tax_rate: number;
  receipt_header?: string | null;
  receipt_footer?: string;
  receipt_phone?: string | null;
  receipt_tax_number?: string | null;
  show_tax_on_receipt?: boolean;
  custom_role_permissions?: Record<string, PosPermission[]>;
}

export interface PosDiscount {
  type: 'percent' | 'fixed';
  value: number;
  reason?: string;
}

export interface PosCustomer {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  address_line1?: string | null;
  credit_limit?: number | null;
  balance?: number | null;
}

export interface PosCartItem {
  id?: string;
  product_id: string;
  productId?: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  category?: string | null;
  quantity: number;
  unit_price: number;
  unitPrice?: number;
  unit_cost?: number;
  unitCost?: number;
  stock_on_hand?: number;
  availableStock?: number | null;
  discount?: PosDiscount;
  discountPercent?: number;
  discountAmount?: number;
  taxCode?: string;
  tax_rate?: number;
  taxRate?: number;
  taxAmount?: number;
  line_total: number;
  lineTotal?: number;
}

export interface PosCartTotals {
  gross_total: number;
  discount_total: number;
  taxable_subtotal: number;
  tax_total: number;
  net_payable: number;
  item_count: number;
}

export interface PosPaymentSplit {
  method?: PosPaymentMethod;
  payment_method?: PosPaymentMethod;
  amount: number;
  reference?: string;
  bank_account_id?: string;
  tendered?: number;
  change?: number;
  note?: string;
}

export interface PosParkedOrder {
  id: string;
  reference: string;
  items: PosCartItem[];
  customer: any;
  order_discount?: PosDiscount;
  orderDiscountPercent?: number;
  total_amount: number;
  grandTotal?: number;
  parked_at: string;
  parkedAt?: string;
  cashier_id?: string;
}

export interface PosSaleItem {
  id?: string;
  sale_id?: string;
  product_id: string;
  productId?: string;
  product_name?: string;
  name?: string;
  sku?: string | null;
  quantity: number;
  unit_price: number;
  unitPrice?: number;
  unit_cost?: number;
  line_total: number;
  lineTotal?: number;
  discount_amount?: number;
  tax_amount?: number;
}

export interface PosSale {
  id: string;
  business_id?: string;
  branch_id?: string | null;
  branchId?: string | null;
  branch_name?: string;
  branchName?: string;
  shift_id?: string | null;
  shiftId?: string | null;
  receipt_number?: string;
  receiptNumber?: string;
  invoice_number?: string;
  customer_id?: string | null;
  customerId?: string | null;
  customer_name?: string | null;
  customerName?: string | null;
  cashier_id?: string | null;
  cashierId?: string | null;
  cashier_name?: string | null;
  cashierName?: string | null;
  gross_amount?: number;
  grossAmount?: number;
  discount_amount?: number;
  discountAmount?: number;
  tax_amount?: number;
  taxAmount?: number;
  net_amount?: number;
  netAmount?: number;
  total_amount?: number;
  total_paid?: number;
  totalPaid?: number;
  amount_paid?: number;
  change_given?: number;
  changeGiven?: number;
  payment_status?: string;
  status: 'completed' | 'voided' | 'refunded' | 'returned';
  items?: PosSaleItem[];
  pos_sale_items?: PosSaleItem[];
  created_at?: string;
  createdAt?: string;
  updated_at?: string;
}

export interface PosSalePayload {
  businessId?: string;
  business_id?: string;
  branchId?: string | null;
  branch_id?: string | null;
  shiftId?: string | null;
  shift_id?: string | null;
  registerId?: string | null;
  register_id?: string | null;
  customerId?: string | null;
  customer_id?: string | null;
  customerName?: string;
  customer_name?: string;
  customerPhone?: string;
  customer_phone?: string;
  customerEmail?: string;
  customer_email?: string;
  cashierId?: string | null;
  cashier_id?: string | null;
  cashierName?: string;
  cashier_name?: string;
  cashierEmail?: string;
  items: PosCartItem[];
  orderDiscount?: PosDiscount;
  order_discount?: PosDiscount;
  totals?: PosCartTotals;
  payments?: PosPaymentSplit[];
  payment_splits?: PosPaymentSplit[];
  totalPaid?: number;
  total_paid?: number;
  changeGiven?: number;
  change_given?: number;
  isCreditSale?: boolean;
  is_credit_sale?: boolean;
  notes?: string;
  dueDate?: string;
  due_date?: string;
  managerApproval?: {
    approverName: string;
    reason: string;
  } | null;
  clientKey?: string;
}

export interface PosSaleResult {
  sale?: any;
  saleId?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  receiptNumber?: string;
  timestamp?: string;
  issueDate?: string;
  createdAt?: string;
  cashierName?: string;
  branchName?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  items?: {
    productId?: string | null;
    product_id?: string | null;
    product_name?: string;
    name?: string;
    quantity: number;
    unitPrice?: number;
    unit_price?: number;
    lineTotal?: number;
    line_total?: number;
    discountPercent?: number;
    discountAmount?: number;
    taxAmount?: number;
  }[];
  subtotal?: number;
  discountAmount?: number;
  discountTotal?: number;
  taxAmount?: number;
  taxTotal?: number;
  netPayable?: number;
  grandTotal?: number;
  totalPaid?: number;
  changeGiven?: number;
  payments?: {
    method?: string;
    payment_method?: string;
    amount: number;
    reference?: string;
    tendered?: number;
  }[];
  notes?: string | null;
  isCreditSale?: boolean;
  isOffline?: boolean;
  dueDate?: string;
}

export interface PosReturnItem {
  productId?: string;
  product_id?: string;
  productName?: string;
  product_name?: string;
  name?: string;
  quantity: number;
  unitPrice?: number;
  unit_price?: number;
  refundAmount?: number;
  refund_amount?: number;
  condition?: string;
}

export interface PosReturnPayload {
  businessId?: string;
  business_id?: string;
  branchId?: string | null;
  branch_id?: string | null;
  shiftId?: string | null;
  shift_id?: string | null;
  originalInvoiceId?: string;
  sale_id?: string;
  receiptNumber?: string;
  cashierId?: string | null;
  cashier_id?: string | null;
  cashierName?: string;
  approverName?: string;
  returned_by?: string;
  reason?: string;
  refundMethod?: PosPaymentMethod;
  refund_payment_method?: PosPaymentMethod;
  items: PosReturnItem[];
  totalRefund?: number;
}

export interface PosVoidPayload {
  businessId?: string;
  business_id?: string;
  branchId?: string | null;
  branch_id?: string | null;
  shiftId?: string | null;
  shift_id?: string | null;
  invoiceId?: string;
  sale_id?: string;
  receiptNumber?: string;
  cashierId?: string | null;
  cashier_id?: string | null;
  cashierName?: string;
  approverName?: string;
  reason: string;
  voided_by?: string;
}
