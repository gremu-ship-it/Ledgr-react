import { repos } from '@/lib/repositories';
import { supabase } from '@/lib/supabase';
import { createLogger } from '@/lib/logger';
import type { InsertDto } from '@/dal/types/database';
import type {
  PosSalePayload,
  PosSaleResult,
  PosReturnPayload,
  PosVoidPayload,
  PosCartItem,
  PosDiscount,
  PosCartTotals,
  PosPaymentMethod,
} from '@/types/pos';
import { createInvoiceJournalEntry } from '@/services/journalService';
import { deductStockAndPostCogs } from '@/services/inventoryJournalService';
import { enqueue, generateOfflineNumber, isOfflineError } from '@/offline/queueApi';
import { newSaveClientKey } from '@/services/quickSaveService';

const log = createLogger('PosService');

const POS_OFFLINE_STORAGE_KEY = 'ledgr_pos_offline_queue';

// ── Receipt Number Generation ───────────────────────────────────────────────

export function generateReceiptNumber(prefix = 'REC'): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const time = String(d.getTime()).slice(-5);
  const rand = Math.floor(Math.random() * 900 + 100);
  return `${prefix}-${year}${month}${day}-${time}${rand}`;
}

// ── Cart Calculations ───────────────────────────────────────────────────────

export function calculateCartTotals(
  items: PosCartItem[],
  orderDiscount?: PosDiscount,
  defaultTaxRate = 0,
): PosCartTotals {
  let gross_total = 0;
  let line_discount_total = 0;
  let item_count = 0;

  items.forEach((item) => {
    const qty = Number(item.quantity) || 0;
    const price = Number(item.unit_price ?? item.unitPrice ?? 0);
    const lineGross = qty * price;
    gross_total += lineGross;
    item_count += qty;

    if (item.discount) {
      if (item.discount.type === 'percent') {
        line_discount_total += (lineGross * Math.min(100, Math.max(0, item.discount.value))) / 100;
      } else {
        line_discount_total += Math.min(lineGross, Math.max(0, item.discount.value));
      }
    } else if (item.discountPercent) {
      line_discount_total += (lineGross * Math.min(100, Math.max(0, item.discountPercent))) / 100;
    }
  });

  const subtotalAfterLineDiscounts = Math.max(0, gross_total - line_discount_total);

  let order_discount_amount = 0;
  if (orderDiscount && orderDiscount.value > 0) {
    if (orderDiscount.type === 'percent') {
      order_discount_amount = (subtotalAfterLineDiscounts * Math.min(100, orderDiscount.value)) / 100;
    } else {
      order_discount_amount = Math.min(subtotalAfterLineDiscounts, orderDiscount.value);
    }
  }

  const discount_total = Math.round((line_discount_total + order_discount_amount) * 100) / 100;
  const taxable_subtotal = Math.max(0, gross_total - discount_total);

  // Calculate tax (Malawi VAT inclusive/exclusive standard)
  let tax_total = 0;
  if (defaultTaxRate > 0) {
    tax_total = Math.round((taxable_subtotal - (taxable_subtotal / (1 + defaultTaxRate / 100))) * 100) / 100;
  }

  const net_payable = Math.round(taxable_subtotal * 100) / 100;

  return {
    gross_total: Math.round(gross_total * 100) / 100,
    discount_total,
    taxable_subtotal: Math.round(taxable_subtotal * 100) / 100,
    tax_total,
    net_payable,
    item_count,
  };
}

// ── Cart State Helpers ──────────────────────────────────────────────────────

export function addProductToCart(currentItems: PosCartItem[], product: any): PosCartItem[] {
  const pId = product.product_id || product.productId || product.id;
  const existingIdx = currentItems.findIndex((it) => (it.product_id || it.productId) === pId);

  const unitPrice = Number(product.unit_price ?? product.unitPrice ?? product.selling_price ?? 0);

  if (existingIdx >= 0) {
    return currentItems.map((it, idx) => {
      if (idx !== existingIdx) return it;
      const newQty = it.quantity + 1;
      const baseTotal = newQty * unitPrice;
      const disc = it.discount?.type === 'percent' ? (baseTotal * it.discount.value) / 100 : (it.discount?.value || 0);
      return {
        ...it,
        quantity: newQty,
        line_total: Math.max(0, baseTotal - disc),
        lineTotal: Math.max(0, baseTotal - disc),
      };
    });
  }

  const newItem: PosCartItem = {
    product_id: pId,
    productId: pId,
    name: product.name,
    sku: product.sku || null,
    barcode: product.barcode || null,
    category: product.category || null,
    quantity: 1,
    unit_price: unitPrice,
    unitPrice: unitPrice,
    unit_cost: Number(product.cost_price ?? product.unit_cost ?? 0),
    line_total: unitPrice,
    lineTotal: unitPrice,
  };

  return [...currentItems, newItem];
}

export function updateCartItemQuantity(currentItems: PosCartItem[], productId: string, quantity: number): PosCartItem[] {
  if (quantity <= 0) {
    return removeProductFromCart(currentItems, productId);
  }
  return currentItems.map((it) => {
    if ((it.product_id || it.productId) !== productId) return it;
    const unitPrice = Number(it.unit_price ?? it.unitPrice ?? 0);
    const baseTotal = quantity * unitPrice;
    const disc = it.discount?.type === 'percent' ? (baseTotal * it.discount.value) / 100 : (it.discount?.value || 0);
    return {
      ...it,
      quantity,
      line_total: Math.max(0, baseTotal - disc),
      lineTotal: Math.max(0, baseTotal - disc),
    };
  });
}

export function removeProductFromCart(currentItems: PosCartItem[], productId: string): PosCartItem[] {
  return currentItems.filter((it) => (it.product_id || it.productId) !== productId);
}

export function clearCart(): PosCartItem[] {
  return [];
}

export function applyItemDiscount(currentItems: PosCartItem[], productId: string, discount?: PosDiscount): PosCartItem[] {
  return currentItems.map((it) => {
    if ((it.product_id || it.productId) !== productId) return it;
    const unitPrice = Number(it.unit_price ?? it.unitPrice ?? 0);
    const baseTotal = it.quantity * unitPrice;
    const discAmount = discount?.type === 'percent' ? (baseTotal * discount.value) / 100 : (discount?.value || 0);
    return {
      ...it,
      discount,
      discountPercent: discount?.type === 'percent' ? discount.value : undefined,
      line_total: Math.max(0, baseTotal - discAmount),
      lineTotal: Math.max(0, baseTotal - discAmount),
    };
  });
}

export function applyOrderDiscount(_currentItems: PosCartItem[], discount?: PosDiscount): PosDiscount | undefined {
  return discount;
}

// ── Complete POS Sale ───────────────────────────────────────────────────────

export async function processSale(
  payload: PosSalePayload | any,
  options: { isOnline?: boolean; userRole?: string } = {},
): Promise<PosSaleResult> {
  const businessId = payload.businessId || payload.business_id || 'biz-default';
  const branchId = payload.branchId ?? payload.branch_id ?? null;
  const shiftId = payload.shiftId ?? payload.shift_id ?? null;
  const customerId = payload.customerId ?? payload.customer_id ?? null;
  const customerName = payload.customerName || payload.customer_name || 'Walk-in Customer';
  const customerPhone = payload.customerPhone || payload.customer_phone;
  const customerEmail = payload.customerEmail || payload.customer_email;
  const cashierId = payload.cashierId ?? payload.cashier_id ?? null;
  const cashierName = payload.cashierName || payload.cashier_name || 'Cashier';
  const items: PosCartItem[] = payload.items || [];
  const orderDiscount = payload.orderDiscount || payload.order_discount;
  const rawPayments = payload.payments || payload.payment_splits || [{ payment_method: 'cash', amount: payload.totalPaid || 0 }];
  const payments: { payment_method: PosPaymentMethod; amount: number; reference?: string; bank_account_id?: string; tendered?: number }[] =
    rawPayments.map((p: any) => ({
      payment_method: p.payment_method || p.method || 'cash',
      amount: Number(p.amount) || 0,
      reference: p.reference,
      bank_account_id: p.bank_account_id,
      tendered: p.tendered,
    }));

  const totalPaid = Number(payload.totalPaid ?? payload.total_paid ?? 0);
  const changeGiven = Number(payload.changeGiven ?? payload.change_given ?? 0);
  const notes = payload.notes;
  const dueDate = payload.dueDate || payload.due_date;
  const managerApproval = payload.managerApproval;

  if (!items || items.length === 0) {
    throw new Error('Cart is empty. Please add items to complete sale.');
  }

  const totals = payload.totals || calculateCartTotals(items, orderDiscount);
  const isCreditSale = Boolean(payload.isCreditSale || payload.is_credit_sale || payments.some((p) => p.payment_method === 'credit_sale' || p.payment_method === 'credit'));

  if (!isCreditSale && totalPaid < totals.net_payable - 0.05) {
    throw new Error(`Tendered payment (${totalPaid}) is less than net payable (${totals.net_payable}).`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const receiptNumber = generateReceiptNumber('REC');
  const clientKey = payload.clientKey || newSaveClientKey();
  const isOnline = options.isOnline !== false && (typeof navigator === 'undefined' || navigator.onLine);

  // Offline queue storage helper
  const storeOfflineSale = async (offlineNum: string) => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = localStorage.getItem(POS_OFFLINE_STORAGE_KEY);
        const list = raw ? JSON.parse(raw) : [];
        list.push({ offlineNum, receiptNumber, payload, queuedAt: new Date().toISOString() });
        localStorage.setItem(POS_OFFLINE_STORAGE_KEY, JSON.stringify(list));
      }
      await enqueue('income', businessId, {
        notes: `POS offline sale ${receiptNumber} (${offlineNum})`,
        items: items.map((i) => ({
          productId: i.product_id || i.productId,
          name: i.name,
          quantity: i.quantity,
          unitPrice: i.unit_price ?? i.unitPrice ?? 0,
          lineTotal: i.line_total ?? i.lineTotal ?? 0,
        })),
        receiptNumber,
      } as any).catch(() => {});
    } catch {
      // offline fallback
    }
  };

  // Offline branch
  if (!isOnline) {
    const offlineInvoiceNum = generateOfflineNumber('POS');
    await storeOfflineSale(offlineInvoiceNum);

    const saleResult: PosSaleResult = {
      saleId: `offline-${Date.now()}`,
      invoiceId: `offline-${Date.now()}`,
      invoiceNumber: offlineInvoiceNum,
      receiptNumber,
      timestamp: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      cashierName,
      branchName: branchId || 'Main Branch',
      customerName,
      customerPhone,
      items: items.map((i) => ({
        productId: i.product_id || i.productId,
        product_id: i.product_id || i.productId,
        name: i.name,
        product_name: i.name,
        quantity: i.quantity,
        unitPrice: i.unit_price ?? i.unitPrice ?? 0,
        unit_price: i.unit_price ?? i.unitPrice ?? 0,
        lineTotal: i.line_total ?? i.lineTotal ?? 0,
        line_total: i.line_total ?? i.lineTotal ?? 0,
      })),
      subtotal: totals.gross_total,
      discountAmount: totals.discount_total,
      taxAmount: totals.tax_total,
      netPayable: totals.net_payable,
      grandTotal: totals.net_payable,
      totalPaid,
      changeGiven,
      payments: payments.map((p) => ({
        payment_method: p.payment_method,
        amount: p.amount,
        reference: p.reference,
      })),
      notes,
      isOffline: true,
      sale: {
        id: `offline-${Date.now()}`,
        receipt_number: receiptNumber,
        created_at: new Date().toISOString(),
        customer_name: customerName,
        cashier_name: cashierName,
        net_amount: totals.net_payable,
        gross_amount: totals.gross_total,
        discount_amount: totals.discount_total,
        total_paid: totalPaid,
        change_given: changeGiven,
        status: 'completed',
      },
    };
    return saleResult;
  }

  try {
    // 1. Resolve Contact
    let finalContactId = customerId;
    if (!finalContactId) {
      const defaultContact = await repos.contact.findDefaultSaleContact(businessId).catch(() => null);
      if (defaultContact) {
        finalContactId = defaultContact.id;
      } else {
        const created = await repos.contact.createContact({
          business_id: businessId,
          name: customerName || 'Walk-in Customer',
          contact_type: 'customer',
          is_active: true,
          phone: customerPhone || null,
          email: customerEmail || null,
        } as never).catch(() => null);
        if (created) finalContactId = created.id;
      }
    }

    // 2. Reserve Document Number
    const invoiceNumber = await repos.business.reserveNextInvoiceNumber(businessId).catch(() => `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`);

    // 3. Resolve Revenue Account
    const incomeAccounts = await repos.account.findByBusiness(businessId).catch(() => []);
    const revenueAccount = incomeAccounts.find((a: any) => a.account_number === '4000' || a.account_number === '4110' || a.classification === 'revenue');

    // 4. Create Invoice Header
    const invoiceHeader: InsertDto<'invoices'> = {
      business_id: businessId,
      invoice_number: invoiceNumber,
      invoice_type: 'invoice',
      status: isCreditSale ? 'sent' : 'paid',
      contact_id: finalContactId || null,
      issue_date: today,
      due_date: isCreditSale ? (dueDate || today) : today,
      currency: 'MWK',
      exchange_rate: 1,
      subtotal: totals.gross_total,
      discount_amount: totals.discount_total,
      discount_percent: totals.gross_total > 0 ? Math.round((totals.discount_total / totals.gross_total) * 100) : 0,
      taxable_amount: totals.taxable_subtotal,
      vat_amount: totals.tax_total,
      wht_amount: 0,
      total_amount: totals.net_payable,
      amount_paid: isCreditSale ? 0 : totals.net_payable,
      revenue_account_id: revenueAccount?.id || null,
      notes: notes ? `${notes} (Receipt: ${receiptNumber})` : `POS Sale Receipt ${receiptNumber}`,
      payment_reference: receiptNumber,
      created_by: cashierName,
      branch_id: branchId || null,
      client_key: clientKey,
    } as InsertDto<'invoices'>;

    // 5. Create Invoice Lines
    const invoiceLines = items.map((item, index) => {
      const uPrice = Number(item.unit_price ?? item.unitPrice ?? 0);
      const lTotal = Number(item.line_total ?? item.lineTotal ?? (uPrice * item.quantity));
      return {
        line_number: index + 1,
        description: item.name + (item.sku ? ` [${item.sku}]` : ''),
        quantity: item.quantity,
        unit_price: uPrice,
        discount_percent: item.discount?.type === 'percent' ? item.discount.value : 0,
        discount_amount: item.discount ? (item.quantity * uPrice) - lTotal : 0,
        tax_code: 'none' as const,
        tax_rate: item.tax_rate || 0,
        tax_amount: 0,
        line_total: lTotal,
        account_id: revenueAccount?.id || null,
        product_id: item.product_id || item.productId || null,
      };
    });

    const { invoice: createdInvoice } = await repos.invoice.createWithLines(invoiceHeader, invoiceLines, clientKey);

    // 6. Record Payments for Paid Sales
    if (!isCreditSale) {
      for (const p of payments) {
        if (p.amount > 0) {
          await repos.invoice.recordPayment({
            business_id: businessId,
            invoice_id: createdInvoice.id,
            amount: p.amount,
            payment_date: today,
            payment_method: (p.payment_method === 'credit_sale' ? 'other' : p.payment_method) as any,
            bank_account_id: p.bank_account_id || null,
            notes: `POS Payment: ${p.payment_method} for ${receiptNumber}${p.reference ? ` (Ref: ${p.reference})` : ''}`,
            currency: 'MWK',
            exchange_rate: 1,
            created_by: cashierName,
          } as InsertDto<'invoice_payments'>).catch((err) => {
            log.warn('Could not record pos payment record', { error: err });
          });
        }
      }
    }

    // 7. Inventory Movements & COGS
    const trackedItems = items.filter((it) => it.product_id || it.productId);
    if (trackedItems.length > 0) {
      try {
        let locationId: string | null = null;
        if (branchId) {
          const loc = await repos.branch.findLocationByBranch(branchId).catch(() => null);
          locationId = loc?.id || null;
        }
        if (!locationId) {
          const defaultLoc = await repos.inventory.findDefaultLocation(businessId).catch(() => null);
          locationId = defaultLoc?.id || null;
        }

        if (locationId) {
          for (const item of trackedItems) {
            const pId = item.product_id || item.productId!;
            await repos.inventory.recordMovement({
              business_id: businessId,
              product_id: pId,
              location_id: locationId!,
              movement_date: today,
              movement_type: 'sale',
              quantity: -Math.abs(item.quantity),
              unit_cost: item.unit_cost || item.unitCost || 0,
              reference: receiptNumber,
              notes: `POS Sale ${receiptNumber} by ${cashierName}`,
              source_type: 'pos_sale',
              source_id: createdInvoice.id,
              created_by: cashierName,
            }).catch((e) => log.warn('Stock movement insert error', { error: e }));
          }

          // Post COGS journal entries
          await deductStockAndPostCogs(
            businessId,
            createdInvoice,
            trackedItems.map((it) => ({ productId: (it.product_id || it.productId)!, quantity: it.quantity })),
            branchId || null,
            null,
            null,
          ).catch((e) => log.warn('COGS journal deduction error', { error: e }));
        }
      } catch (invErr) {
        log.warn('Inventory update failed during POS sale', { error: invErr });
      }
    }

    // 8. Sales Double-entry Journal
    try {
      await createInvoiceJournalEntry(businessId, createdInvoice, totals.taxable_subtotal, totals.tax_total, branchId || null, null);
    } catch (jErr) {
      log.warn('Journal creation error for POS sale', { error: jErr });
    }

    // 9. Update Active Shift Totals
    if (shiftId) {
      const cashAmount = payments.filter((p) => p.payment_method === 'cash').reduce((s, p) => s + p.amount, 0);
      const otherAmount = payments.filter((p) => p.payment_method !== 'cash').reduce((s, p) => s + p.amount, 0);

      await repos.pos.updateShiftTotals(shiftId, {
        cashSales: cashAmount,
        otherSales: otherAmount,
      }).catch((e) => log.warn('Could not update shift totals', { error: e }));
    }

    // 10. Audit Trail
    const auditNotes = [
      `POS Sale #${receiptNumber} completed by ${cashierName}`,
      `Total: MK ${totals.net_payable.toLocaleString()}`,
      payments.map((p) => `${p.payment_method}: MK ${p.amount.toLocaleString()}`).join(', '),
      managerApproval ? `Manager Approval: ${managerApproval.approverName} (${managerApproval.reason})` : null,
    ].filter(Boolean).join(' | ');

    try {
      await (supabase.rpc as any)('log_manual_audit_event', {
        p_business_id: businessId,
        p_event_type: 'pos_sale',
        p_resource_type: 'invoices',
        p_resource_id: createdInvoice.id,
        p_resource_ref: receiptNumber,
        p_old_values: null,
        p_new_values: {
          invoiceId: createdInvoice.id,
          receiptNumber,
          branchId,
          cashierId,
          cashierName,
          total: totals.net_payable,
          itemsCount: items.length,
          payments,
          isCreditSale,
        },
        p_notes: auditNotes,
      });
    } catch (auditErr) {
      log.warn('Audit logging failed for POS sale', { error: auditErr });
    }

    const saleResult: PosSaleResult = {
      saleId: createdInvoice.id,
      invoiceId: createdInvoice.id,
      invoiceNumber,
      receiptNumber,
      timestamp: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      cashierName,
      branchName: branchId || 'Main Branch',
      customerName,
      customerPhone,
      items: items.map((i) => ({
        productId: i.product_id || i.productId,
        product_id: i.product_id || i.productId,
        name: i.name,
        product_name: i.name,
        quantity: i.quantity,
        unitPrice: i.unit_price ?? i.unitPrice ?? 0,
        unit_price: i.unit_price ?? i.unitPrice ?? 0,
        lineTotal: i.line_total ?? i.lineTotal ?? 0,
        line_total: i.line_total ?? i.lineTotal ?? 0,
      })),
      subtotal: totals.gross_total,
      discountAmount: totals.discount_total,
      taxAmount: totals.tax_total,
      netPayable: totals.net_payable,
      grandTotal: totals.net_payable,
      totalPaid,
      changeGiven,
      payments: payments.map((p) => ({
        payment_method: p.payment_method,
        amount: p.amount,
        reference: p.reference,
      })),
      notes,
      isOffline: false,
      sale: {
        id: createdInvoice.id,
        receipt_number: receiptNumber,
        created_at: new Date().toISOString(),
        customer_name: customerName,
        cashier_name: cashierName,
        net_amount: totals.net_payable,
        gross_amount: totals.gross_total,
        discount_amount: totals.discount_total,
        total_paid: totalPaid,
        change_given: changeGiven,
        status: 'completed',
      },
    };
    return saleResult;
  } catch (err) {
    if (isOfflineError(err)) {
      const offlineInvoiceNum = generateOfflineNumber('POS');
      await storeOfflineSale(offlineInvoiceNum);

      return {
        saleId: `offline-${Date.now()}`,
        invoiceId: `offline-${Date.now()}`,
        invoiceNumber: offlineInvoiceNum,
        receiptNumber,
        timestamp: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        cashierName,
        branchName: branchId || 'Main Branch',
        customerName,
        customerPhone,
        items: items.map((i) => ({
          productId: i.product_id || i.productId,
          product_id: i.product_id || i.productId,
          name: i.name,
          product_name: i.name,
          quantity: i.quantity,
          unitPrice: i.unit_price ?? i.unitPrice ?? 0,
          unit_price: i.unit_price ?? i.unitPrice ?? 0,
          lineTotal: i.line_total ?? i.lineTotal ?? 0,
          line_total: i.line_total ?? i.lineTotal ?? 0,
        })),
        subtotal: totals.gross_total,
        discountAmount: totals.discount_total,
        taxAmount: totals.tax_total,
        netPayable: totals.net_payable,
        grandTotal: totals.net_payable,
        totalPaid,
        changeGiven,
        payments: payments.map((p) => ({
          payment_method: p.payment_method,
          amount: p.amount,
          reference: p.reference,
        })),
        notes,
        isOffline: true,
        sale: {
          id: `offline-${Date.now()}`,
          receipt_number: receiptNumber,
          created_at: new Date().toISOString(),
          customer_name: customerName,
          cashier_name: cashierName,
          net_amount: totals.net_payable,
          gross_amount: totals.gross_total,
          discount_amount: totals.discount_total,
          total_paid: totalPaid,
          change_given: changeGiven,
          status: 'completed',
        },
      };
    }
    throw err;
  }
}

export const createSale = processSale;

// ── Process POS Return / Refund ─────────────────────────────────────────────

export async function processReturn(
  payload: PosReturnPayload | any,
  _options: { isOnline?: boolean; userRole?: string } = {},
): Promise<{ returnInvoiceId: string; returnNumber: string }> {
  const businessId = payload.businessId || payload.business_id || 'biz-default';
  const branchId = payload.branchId ?? payload.branch_id ?? null;
  const shiftId = payload.shiftId ?? payload.shift_id ?? null;
  const originalInvoiceId = payload.originalInvoiceId || payload.sale_id || '';
  const receiptNumber = payload.receiptNumber || 'REC';
  const cashierName = payload.cashierName || payload.returned_by || 'Cashier';
  const approverName = payload.approverName;
  const reason = payload.reason || 'Customer return';
  const refundMethod = payload.refundMethod || payload.refund_payment_method || 'cash';
  const rawItems = payload.items || [];
  const items = rawItems.map((it: any) => ({
    productId: it.productId || it.product_id,
    productName: it.productName || it.product_name || 'Product',
    quantity: Number(it.quantity) || 1,
    unitPrice: Number(it.unitPrice ?? it.unit_price ?? 0),
    refundAmount: Number(it.refundAmount ?? it.refund_amount ?? ((it.unitPrice ?? it.unit_price ?? 0) * it.quantity)),
  }));

  const totalRefund = Number(payload.totalRefund || items.reduce((s: number, i: any) => s + i.refundAmount, 0));

  const today = new Date().toISOString().slice(0, 10);
  const returnNumber = generateReceiptNumber('RET');

  // 1. Fetch original invoice
  const original = await repos.invoice.findById(originalInvoiceId);

  // 2. Create Credit Note Invoice
  const creditNoteHeader: InsertDto<'invoices'> = {
    business_id: businessId,
    invoice_number: `CN-${original.invoice_number}`,
    invoice_type: 'credit_note',
    status: 'paid',
    contact_id: original.contact_id,
    issue_date: today,
    due_date: today,
    currency: 'MWK',
    exchange_rate: 1,
    subtotal: -Math.abs(totalRefund),
    discount_amount: 0,
    discount_percent: 0,
    taxable_amount: -Math.abs(totalRefund),
    vat_amount: 0,
    wht_amount: 0,
    total_amount: -Math.abs(totalRefund),
    amount_paid: -Math.abs(totalRefund),
    credit_note_for: original.id,
    notes: `Refund for Receipt #${receiptNumber}. Reason: ${reason}${approverName ? ` (Approved by: ${approverName})` : ''}`,
    created_by: cashierName,
    branch_id: branchId || original.branch_id,
  } as InsertDto<'invoices'>;

  const creditLines = items.map((it: any, idx: number) => ({
    line_number: idx + 1,
    description: `Return: ${it.productName}`,
    quantity: -Math.abs(it.quantity),
    unit_price: it.unitPrice,
    discount_percent: 0,
    tax_code: 'none' as const,
    tax_rate: 0,
    tax_amount: 0,
    line_total: -Math.abs(it.refundAmount),
    product_id: it.productId || null,
  }));

  const { invoice: createdCreditNote } = await repos.invoice.createWithLines(creditNoteHeader, creditLines);

  // 3. Return stock to warehouse/branch location
  try {
    let locationId: string | null = null;
    if (branchId) {
      const loc = await repos.branch.findLocationByBranch(branchId).catch(() => null);
      locationId = loc?.id || null;
    }
    if (!locationId) {
      const defaultLoc = await repos.inventory.findDefaultLocation(businessId).catch(() => null);
      locationId = defaultLoc?.id || null;
    }

    if (locationId) {
      for (const it of items) {
        if (it.productId) {
          await repos.inventory.recordMovement({
            business_id: businessId,
            product_id: it.productId,
            location_id: locationId!,
            movement_date: today,
            movement_type: 'return_in',
            quantity: Math.abs(it.quantity),
            unit_cost: it.unitPrice,
            reference: returnNumber,
            notes: `POS Return for ${receiptNumber} (${reason})`,
            source_type: 'pos_return',
            source_id: createdCreditNote.id,
            created_by: cashierName,
          }).catch((e) => log.warn('Return stock movement error', { error: e }));
        }
      }
    }
  } catch (invErr) {
    log.warn('Inventory return error', { error: invErr });
  }

  // 4. Update Shift Refunds if cash refund
  if (shiftId && refundMethod === 'cash') {
    await repos.pos.updateShiftTotals(shiftId, {
      refunds: Math.abs(totalRefund),
    }).catch((e) => log.warn('Could not update shift refunds', { error: e }));
  }

  // 5. Audit log
  try {
    await (supabase.rpc as any)('log_manual_audit_event', {
      p_business_id: businessId,
      p_event_type: 'pos_refund',
      p_resource_type: 'invoices',
      p_resource_id: createdCreditNote.id,
      p_resource_ref: receiptNumber,
      p_old_values: { invoiceId: originalInvoiceId, receiptNumber },
      p_new_values: {
        returnNumber,
        refundAmount: totalRefund,
        refundMethod,
        items,
        cashierName,
        approverName,
        reason,
      },
      p_notes: `POS Refund of MK ${totalRefund.toLocaleString()} for #${receiptNumber}. Reason: ${reason} (Approved: ${approverName || 'N/A'})`,
    });
  } catch (auditErr) {
    log.warn('Audit log failed for POS refund', { error: auditErr });
  }

  return { returnInvoiceId: createdCreditNote.id, returnNumber };
}

// ── Process POS Void ────────────────────────────────────────────────────────

export async function processVoid(
  payload: PosVoidPayload | any,
  _options: { isOnline?: boolean; userRole?: string } = {},
): Promise<{ success: boolean }> {
  const businessId = payload.businessId || payload.business_id || 'biz-default';
  const branchId = payload.branchId ?? payload.branch_id ?? null;
  const invoiceId = payload.invoiceId || payload.sale_id || '';
  const receiptNumber = payload.receiptNumber || 'REC';
  const cashierName = payload.cashierName || payload.voided_by || 'Cashier';
  const approverName = payload.approverName;
  const reason = payload.reason || 'Transaction voided';
  const today = new Date().toISOString().slice(0, 10);

  // 1. Fetch invoice and lines
  const { invoice, lines } = await repos.invoice.findByIdWithLines(invoiceId);

  // 2. Mark invoice as void
  await repos.invoice.update(invoiceId, {
    status: 'void',
    notes: `${invoice.notes || ''} [VOIDED: ${reason} by ${cashierName}${approverName ? `, approved by ${approverName}` : ''}]`,
  } as never);

  // 3. Reverse stock movements
  try {
    let locationId: string | null = null;
    if (branchId || invoice.branch_id) {
      const loc = await repos.branch.findLocationByBranch(branchId || invoice.branch_id!).catch(() => null);
      locationId = loc?.id || null;
    }
    if (!locationId) {
      const defaultLoc = await repos.inventory.findDefaultLocation(businessId).catch(() => null);
      locationId = defaultLoc?.id || null;
    }

    if (locationId) {
      for (const l of lines) {
        if (l.product_id) {
          await repos.inventory.recordMovement({
            business_id: businessId,
            product_id: l.product_id!,
            location_id: locationId!,
            movement_date: today,
            movement_type: 'adjustment_in',
            quantity: Math.abs(Number(l.quantity)),
            unit_cost: Number(l.unit_price),
            reference: `VOID-${receiptNumber}`,
            notes: `Void reversal for ${receiptNumber} (${reason})`,
            source_type: 'pos_void',
            source_id: invoiceId,
            created_by: cashierName,
          }).catch((e) => log.warn('Void stock reversal error', { error: e }));
        }
      }
    }
  } catch (invErr) {
    log.warn('Inventory void reversal error', { error: invErr });
  }

  // 4. Reverse Journal Entry if posted
  if (invoice.journal_entry_id) {
    try {
      await repos.journal.reverse(
        invoice.journal_entry_id,
        `REV-${invoice.invoice_number}`,
        today,
        cashierName,
        `Void of ${receiptNumber} (${reason})`,
      );
    } catch (jErr) {
      log.warn('Journal reversal failed during void', { error: jErr });
    }
  }

  // 5. Audit Log
  try {
    await (supabase.rpc as any)('log_manual_audit_event', {
      p_business_id: businessId,
      p_event_type: 'pos_void',
      p_resource_type: 'invoices',
      p_resource_id: invoiceId,
      p_resource_ref: receiptNumber,
      p_old_values: { status: invoice.status, total: invoice.total_amount },
      p_new_values: {
        status: 'void',
        voidReason: reason,
        cashierName,
        approverName,
      },
      p_notes: `POS Void of #${receiptNumber} (MK ${Number(invoice.total_amount).toLocaleString()}). Reason: ${reason} (Approved by: ${approverName || 'N/A'})`,
    });
  } catch (auditErr) {
    log.warn('Audit log failed for POS void', { error: auditErr });
  }

  return { success: true };
}

export const voidSale = processVoid;

// ── Offline Queue Helpers ───────────────────────────────────────────────────

export function getOfflineQueue(): any[] {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = localStorage.getItem(POS_OFFLINE_STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
      }
    }
  } catch {}
  return [];
}

export function getOfflineQueueLength(): number {
  return getOfflineQueue().length;
}

export async function syncOfflineQueue(): Promise<number> {
  const queue = getOfflineQueue();
  if (queue.length === 0) return 0;

  let synced = 0;
  const remaining: any[] = [];

  for (const item of queue) {
    try {
      await processSale(item.payload, { isOnline: true });
      synced++;
    } catch (err) {
      log.warn('Failed to sync offline sale:', { error: err, item });
      remaining.push(item);
    }
  }

  if (typeof window !== 'undefined' && window.localStorage) {
    localStorage.setItem(POS_OFFLINE_STORAGE_KEY, JSON.stringify(remaining));
  }

  return synced;
}

export const posService = {
  calculateCartTotals,
  generateReceiptNumber,
  processSale,
  createSale,
  processReturn,
  processVoid,
  voidSale,
  getOfflineQueue,
  getOfflineQueueLength,
  syncOfflineQueue,
  addProductToCart,
  updateCartItemQuantity,
  removeProductFromCart,
  clearCart,
  applyItemDiscount,
  applyOrderDiscount,
};
