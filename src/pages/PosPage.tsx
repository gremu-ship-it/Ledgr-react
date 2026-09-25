import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { usePosPermissions } from '@/hooks/usePosPermissions';
import {
  calculateCartTotals,
  createSale,
  processReturn,
  processVoid,
  addProductToCart,
  updateCartItemQuantity,
  removeProductFromCart,
  clearCart,
  applyItemDiscount,
} from '@/services/posService';
import { requestPosApproval, type PosCorrectionAction } from '@/services/posCorrectionRpc';
import { repos } from '@/lib/repositories';
import { weightedAverageCost } from '@/services/inventoryValuation';
import { useBrandTheme } from '@/hooks/useBrandTheme';
import { VAT_STANDARD_RATE } from '@/lib/vat';
import { useOfflineQueue } from '@/hooks/useOfflineQueue';
import { useOfflineSync } from '@/offline/offlineSyncContext';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import type {
  PosCartItem,
  PosCustomer,
  PosDiscount,
  PosShift,
  PosSale,
  PosSaleResult,
  PosPaymentSplit,
  PosRegister,
  PosProduct,
  PosPaymentMethod,
  PosStockAvailability,
  PosStockStatus,
} from '@/types/pos';

// Components
import { PosHeader } from '@/components/pos/PosHeader';
import { PosProductCatalog } from '@/components/pos/PosProductCatalog';
import { PosStockStatusBanner } from '@/components/pos/PosStockStatusBanner';
import { PosCart } from '@/components/pos/PosCart';
import { PosPaymentModal } from '@/components/pos/PosPaymentModal';
import { PosReceiptModal } from '@/components/pos/PosReceiptModal';
import { PosShiftModal } from '@/components/pos/PosShiftModal';
import { PosCashMovementModal } from '@/components/pos/PosCashMovementModal';
import { PosSalesHistoryModal } from '@/components/pos/PosSalesHistoryModal';
import { PosManagerApprovalModal } from '@/components/pos/PosManagerApprovalModal';
import { PosOwnerAnalytics } from '@/components/pos/PosOwnerAnalytics';
import { PosBarcodeLabelGenerator } from '@/components/pos/PosBarcodeLabelGenerator';
import { PosZReportModal } from '@/components/pos/PosZReportModal';

export function PosPage() {
  const currentUser = useAppStore((s) => s.currentUser);
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const permissions = usePosPermissions();

  // Empty rather than a fabricated 'biz-default': a queued offline sale is
  // filed under this id, and inventing one puts the sale in a tenant that does
  // not exist (posService rejects the sale with a clear message instead).
  const businessId = currentBusiness?.business?.id || '';
  // A till with no branch posts every sale against the default warehouse, so
  // Airwing and Area 49 stock never moved when those shops sold. The cashier's
  // assigned branch wins; otherwise they pick the shop in the header.
  const [branchId, setBranchId] = useState<string | null>(null);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  // A membership with a shop is the till. Don't offer a switch — that is how
  // an Airwing sale was posted against the default warehouse.
  const [assignedBranchId, setAssignedBranchId] = useState<string | null>(null);
  const assignedBranchRef = useRef<string | null>(null);
  const branchTouched = useRef(false);
  const branchName = branches.find((b) => b.id === branchId)?.name
    || currentBusiness?.business?.name
    || 'Shop';

  // Navigation / View state
  const [viewMode, setViewMode] = useState<'sales' | 'analytics' | 'history' | 'settings'>('sales');

  // Network & sync state. Both the queue and the sync pass are the app-wide
  // ones: the POS screen used to keep its own localStorage list and its own
  // sync loop, which is why offline sales it queued never showed up in the
  // header's offline drawer.
  const isOnline = useOnlineStatus();
  const { pendingCount: pendingOfflineCount, failedCount: failedOfflineCount } = useOfflineQueue();
  const { isSyncing, syncNow } = useOfflineSync();

  // Shifts & Register
  const [activeRegister] = useState<PosRegister | null>({
    id: 'reg-01',
    name: 'POS Register 01',
  });
  const [currentShift, setCurrentShift] = useState<PosShift | null>(null);

  // Products & Inventory
  const [products, setProducts] = useState<PosProduct[]>([]);
  const [customers, setCustomers] = useState<PosCustomer[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(true);
  const [dataVersion, setDataVersion] = useState(0);
  // IC 2026-09-25 P4: server stock-read state (never silently zero).
  const [stockStatus, setStockStatus] = useState<PosStockStatus>({ state: 'loading' });

  // Active Sale Cart
  const [cartItems, setCartItems] = useState<PosCartItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<PosCustomer | null>(null);
  const [orderDiscount, setOrderDiscount] = useState<PosDiscount | undefined>(undefined);
  const [cartNotes, setCartNotes] = useState<string>('');
  const [parkedOrders, setParkedOrders] = useState<Array<{ id: string; timestamp: Date; items: PosCartItem[]; customer: PosCustomer | null; discount?: PosDiscount }>>([]);

  // Modals state
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [lastSaleResult, setLastSaleResult] = useState<PosSaleResult | null>(null);
  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);
  const [isCashMovementModalOpen, setIsCashMovementModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isApprovalModalOpen, setIsApprovalModalOpen] = useState(false);
  const [approvalServerContext, setApprovalServerContext] = useState<{ action: PosCorrectionAction; documentId: string } | null>(null);
  const [isBarcodeModalOpen, setIsBarcodeModalOpen] = useState(false);
  const [isZReportModalOpen, setIsZReportModalOpen] = useState(false);
  // R08.4/5: the Z-report number is minted by the signed close, never client-side.
  const [zReportServerNumber, setZReportServerNumber] = useState<string | null>(null);
  const [approvalActionDescription, setApprovalActionDescription] = useState('');
  const [pendingApprovalCallback, setPendingApprovalCallback] = useState<((approvalToken?: string) => void) | null>(null);

  // Sales History List
  const [salesHistory, setSalesHistory] = useState<PosSale[]>([]);
  const [isProcessingSale, setIsProcessingSale] = useState(false);

  // VAT. The till used to total every sale at 0%, whatever the business's VAT
  // status: a VAT-registered shop's POS sales therefore booked no output VAT
  // (no 2121 line) while its Income-screen invoices did, so the two halves of
  // the same month disagreed on the VAT return. Same rule as the other sale
  // and expense screens — the standard rate when the business is registered,
  // nothing otherwise.
  //
  // POS prices are VAT-inclusive, so `calculateCartTotals` extracts the tax
  // from the price the customer pays rather than adding it on top.
  const { business: businessData } = useBrandTheme();
  const isVatRegistered = businessData?.vat_registered ?? false;
  const posVatRatePercent = isVatRegistered ? VAT_STANDARD_RATE * 100 : 0;

  // Compute Cart Totals
  const cartTotals = useMemo(() => {
    return calculateCartTotals(cartItems, orderDiscount, posVatRatePercent);
  }, [cartItems, orderDiscount, posVatRatePercent]);

  // Cart Management Handlers
  const handleAddToCart = useCallback((product: PosProduct) => {
    setCartItems((prev) => addProductToCart(prev, product));
  }, []);

  const handleUpdateQuantity = useCallback((productId: string, quantity: number) => {
    setCartItems((prev) => updateCartItemQuantity(prev, productId, quantity));
  }, []);

  const handleRemoveItem = useCallback((productId: string) => {
    setCartItems((prev) => removeProductFromCart(prev, productId));
  }, []);

  const handleClearCart = useCallback(() => {
    setCartItems(clearCart());
    setSelectedCustomer(null);
    setOrderDiscount(undefined);
  }, []);

  const handleUpdateLineDiscount = useCallback((productId: string, discount?: PosDiscount) => {
    setCartItems((prev) => applyItemDiscount(prev, productId, discount));
  }, []);

  const handleUpdateOrderDiscount = useCallback((discount?: PosDiscount) => {
    setOrderDiscount(discount);
  }, []);

  const handleParkOrder = useCallback(() => {
    if (cartItems.length === 0) return;
    const parked = {
      id: 'PARK-' + Date.now().toString().slice(-4),
      timestamp: new Date(),
      items: cartItems,
      customer: selectedCustomer,
      discount: orderDiscount,
    };
    setParkedOrders((prev) => [parked, ...prev]);
    handleClearCart();
  }, [cartItems, selectedCustomer, orderDiscount, handleClearCart]);

  const handleRestoreParkedOrder = useCallback((parkedId: string) => {
    const found = parkedOrders.find((p) => p.id === parkedId);
    if (!found) return;
    setCartItems(found.items);
    setSelectedCustomer(found.customer);
    setOrderDiscount(found.discount);
    setParkedOrders((prev) => prev.filter((p) => p.id !== parkedId));
  }, [parkedOrders]);

  // Keyboard Shortcuts (F4: Checkout, F8: Park)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F4') {
        e.preventDefault();
        if (cartItems.length > 0 && !isPaymentModalOpen) {
          setIsPaymentModalOpen(true);
        }
      } else if (e.key === 'F8') {
        e.preventDefault();
        if (cartItems.length > 0) {
          handleParkOrder();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cartItems, isPaymentModalOpen, handleParkOrder]);

  // Fetch initial data: Products, Customers, Shifts, real shop stock
  const currentUserId = currentUser?.id;

  useEffect(() => {
    let ignore = false;
    async function loadBranches() {
      if (!businessId) return;
      try {
        const [active, membership] = await Promise.all([
          repos.branch.findActive(businessId).catch(() => []),
          currentUserId
            ? repos.branch.db
                .from('business_users')
                .select('branch_id')
                .eq('business_id', businessId)
                .eq('user_id', currentUserId)
                .eq('is_active', true)
                .maybeSingle()
            : Promise.resolve({ data: null }),
        ]);
        if (ignore) return;
        setBranches(active.map((b) => ({ id: b.id, name: b.name })));
        const assigned = (membership.data as { branch_id?: string | null } | null)?.branch_id ?? null;
        assignedBranchRef.current = assigned;
        setAssignedBranchId(assigned);
        if (assigned) {
          setBranchId(assigned);
        } else if (!branchTouched.current) {
          setBranchId((current) => current ?? (active.length === 1 ? active[0].id : null));
        }
      } catch {
        // The till still opens. Stock follows the default warehouse until a shop is known.
      }
    }
    void loadBranches();
    return () => { ignore = true; };
  }, [businessId, currentUserId]);

  useEffect(() => {
    let ignore = false;
    async function loadData() {
      if (!businessId) return;
      try {
        // Cost only (RLS-scoped, best effort): quantities no longer come from
        // this read. See pos_stock_availability below.
        const loadBalances = async (): Promise<{
          product_id: string;
          location_id: string;
          quantity_on_hand: number;
          average_cost: number;
        }[]> => {
          const { data, error } = await repos.inventory['client']
            .from('inventory_balances')
            .select('product_id, location_id, quantity_on_hand, average_cost')
            .eq('business_id', businessId);
          if (error) throw new Error(error.message);
          return data ?? [];
        };
        // IC 2026-09-25 P4: the displayed stock comes from the SAME server
        // resolver the sale deducts from (_ledgr_stock_location), gated like
        // selling there. A failed read is surfaced as an error + "stock
        // unknown" — never as 0 / "Out".
        const loadAvailability = async (): Promise<PosStockAvailability> => {
          const { data, error } = await (repos.inventory['client'] as unknown as {
            rpc: (fn: 'pos_stock_availability', args: { p_business_id: string; p_branch_id: string | null }) =>
              Promise<{ data: PosStockAvailability | null; error: { message?: string } | null }>;
          }).rpc('pos_stock_availability', { p_business_id: businessId, p_branch_id: branchId ?? null });
          if (error) throw new Error(error.message || 'Stock levels could not be loaded.');
          if (!data) throw new Error('Stock levels could not be loaded.');
          return data;
        };
        const [prods, custs, shift, recentInvoices, balanceRows, availability] = await Promise.all([
          repos.inventory.findAllProducts(businessId).catch(() => []),
          repos.contact.findByBusiness(businessId, 'customer').catch(() => []),
          currentUserId ? repos.pos.findActiveShift(businessId, currentUserId, branchId).catch(() => null) : Promise.resolve(null),
          repos.invoice.findByBusiness(businessId, undefined, 30).catch(() => []),
          loadBalances().catch(() => [] as Awaited<ReturnType<typeof loadBalances>>),
          loadAvailability().then(
            (value) => ({ ok: true as const, value }),
            (error: unknown) => ({ ok: false as const, message: error instanceof Error ? error.message : String(error) }),
          ),
        ]);

        if (ignore) return;

        // No assigned shop: an open shift still names the till. Never override
        // an assignment — that ref is set before this effect can win the race.
        if (shift?.branch_id && !assignedBranchRef.current && !branchTouched.current) {
          setBranchId((current) => current ?? shift.branch_id);
        }

        const stockKnown = availability.ok;
        const serverLocationId = availability.ok ? availability.value.location?.id ?? null : null;
        const onHandByProduct = new Map<string, number>(
          availability.ok
            ? availability.value.balances.map((b) => [b.product_id, Number(b.quantity_on_hand || 0)] as [string, number])
            : [],
        );
        const costRowsHere = serverLocationId
          ? balanceRows.filter((b) => b.location_id === serverLocationId)
          : [];
        setStockStatus(
          availability.ok
            ? {
                state: 'ok',
                locationName: availability.value.location?.name ?? null,
                isFallback: availability.value.is_fallback,
                noLocation: availability.value.location == null,
              }
            : { state: 'error', message: availability.message },
        );

        if (prods && prods.length > 0) {
          const mapped: PosProduct[] = prods.map((p) => {
            const rows = costRowsHere.filter((b) => b.product_id === p.id);
            const onHand = onHandByProduct.get(p.id) ?? 0;
            const avgCost = weightedAverageCost(rows);
            const tracks = p.track_inventory !== false;
            return {
              id: p.id,
              name: p.name,
              sku: p.sku || '',
              barcode: p.barcode || '',
              unit_price: Number(p.sale_price) || 0,
              unitPrice: Number(p.sale_price) || 0,
              selling_price: Number(p.sale_price) || 0,
              cost_price: avgCost > 0 ? avgCost : (Number(p.purchase_price) || 0),
              track_inventory: p.track_inventory !== false,
              stock_quantity: !tracks || !stockKnown ? undefined : onHand,
              stockQuantity: !tracks || !stockKnown ? undefined : onHand,
              stock_unknown: tracks && !stockKnown,
              category: p.category_id || 'General',
              category_id: p.category_id || 'General',
            };
          });
          setProducts(mapped);
          const rawCats = mapped.map((p) => p.category || 'General');
          const cats = Array.from(new Set(rawCats)).filter((c): c is string => typeof c === 'string');
          setCategories(cats);
        }

        if (custs && custs.length > 0) {
          setCustomers(
            custs.map((c) => ({
              id: c.id,
              name: c.name,
              phone: c.phone || undefined,
              email: c.email || undefined,
              address: c.address_line1 || undefined,
            })),
          );
        }

        if (shift) {
          setCurrentShift(shift);
        }

        if (recentInvoices && recentInvoices.length > 0) {
          setSalesHistory(
            recentInvoices.map((inv) => ({
              id: inv.id,
              receipt_number: inv.payment_reference || inv.invoice_number,
              invoice_number: inv.invoice_number,
              created_at: inv.created_at || inv.issue_date,
              customer_name: (inv as { contact?: { name?: string } }).contact?.name || 'Walk-in',
              cashier_name: inv.created_by || 'Cashier',
              // `subtotal` is stored net of discount (app-wide convention),
              // so the pre-discount figure is subtotal + discount.
              gross_amount: (Number(inv.subtotal) || 0) + (Number(inv.discount_amount) || 0),
              discount_amount: Number(inv.discount_amount) || 0,
              net_amount: Number(inv.total_amount) || 0,
              total_paid: Number(inv.amount_paid) || 0,
              change_given: 0,
              payment_status: inv.status === 'paid' ? 'completed' : inv.status,
              status: inv.status === 'void' ? 'voided' : 'completed',
              items: [],
            })),
          );
        }
      } catch (err) {
        console.warn('Could not load all POS data:', err);
      } finally {
        if (!ignore) {
          setIsLoadingProducts(false);
        }
      }
    }

    void loadData();

    return () => {
      ignore = true;
    };
  }, [businessId, currentUserId, branchId, dataVersion]);

  // Approval interceptor (R07): financial corrections route through a
  // server-minted approval (workflows call with a document context); the
  // callback then runs WITH the token and the SERVER decides whether it is
  // live, bound and unconsumed. Display-mode nudges (over-cap discounts)
  // carry no document context and confirm locally — they authorize nothing.
  const handleRequestManagerApproval = useCallback((
    actionDescription: string,
    onApproved: (approvalToken?: string) => void,
    serverContext?: { action: PosCorrectionAction; documentId: string },
  ) => {
    setApprovalActionDescription(actionDescription);
    setPendingApprovalCallback(() => onApproved);
    setApprovalServerContext(serverContext ?? null);
    setIsApprovalModalOpen(true);
  }, []);

  const handleManagerApproved = useCallback((approvalToken?: string) => {
    setIsApprovalModalOpen(false);
    if (pendingApprovalCallback) {
      pendingApprovalCallback(approvalToken);
      setPendingApprovalCallback(null);
    }
    setApprovalServerContext(null);
  }, [pendingApprovalCallback]);

  // Checkout Execution
  const handleCompleteSale = async (
    paymentData: {
      payments: PosPaymentSplit[];
      totalPaid: number;
      changeGiven: number;
      notes?: string;
      dueDate?: string;
    },
    isCreditSale = false,
    dueDate?: string,
  ) => {
    try {
      setIsProcessingSale(true);

      const salePayload = {
        businessId,
        branchId,
        shiftId: currentShift?.id,
        cashierId: currentUser?.id || 'cashier-1',
        cashierName: currentUser?.profile?.full_name || currentUser?.email || 'Cashier',
        customerId: selectedCustomer?.id,
        customerName: selectedCustomer?.name,
        customerPhone: selectedCustomer?.phone || undefined,
        customerEmail: selectedCustomer?.email || undefined,
        items: cartItems,
        // The totals the till just showed, VAT included: the queued/offline
        // path stores the invoice from these numbers, so recomputing them
        // later (at a different rate, or after a product price changed) would
        // make the receipt disagree with the document.
        totals: cartTotals,
        orderDiscount,
        payments: paymentData.payments,
        totalPaid: paymentData.totalPaid,
        changeGiven: paymentData.changeGiven,
        notes: paymentData.notes || cartNotes,
        isCreditSale,
        dueDate: isCreditSale ? dueDate : undefined,
      };

      const result = await createSale(salePayload);
      setLastSaleResult(result);
      setIsPaymentModalOpen(false);
      setIsReceiptModalOpen(true);

      // Reset cart and update history. The offline queue count is live
      // (Dexie live query), so a queued sale raises it without a manual refresh.
      handleClearCart();

      // Refresh sales history list and the shop's on-hand, which the sale just moved.
      if (result.sale) {
        setSalesHistory((prev) => [result.sale as PosSale, ...prev]);
      }
      setDataVersion((v) => v + 1);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('Sale completion error:', err);
      alert(`Sale failed: ${message}`);
    } finally {
      setIsProcessingSale(false);
    }
  };

  // Shift Actions
  const handleOpenShift = async (openingFloat: number, notes?: string) => {
    try {
      const shift = await repos.pos.openShift({
        businessId,
        branchId,
        cashierId: currentUser?.id || 'cashier-1',
        cashierName: currentUser?.profile?.full_name || currentUser?.email || 'Cashier',
        opening_float: openingFloat,
        notes,
      });
      setCurrentShift(shift);
      setIsShiftModalOpen(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      alert(`Could not open shift: ${message}`);
    }
  };

  const handleCloseShift = async (closingCash: number, notes?: string) => {
    if (!currentShift) return;
    try {
      const shift = await repos.pos.closeShift(currentShift.id, {
        closingCashActual: closingCash,
        notes,
      });
      setCurrentShift(shift);
      setIsShiftModalOpen(false);
      // Best-effort: surface the immutable Z-report number signed by the server.
      const report = await repos.pos.getShiftReport(shift.id);
      const closeBlock = (report?.close ?? null) as { report_number?: string } | null;
      setZReportServerNumber(closeBlock?.report_number ?? null);
      // Offer opening Z-Report
      setIsZReportModalOpen(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      alert(`Could not close shift: ${message}`);
    }
  };

  // Cash Movement
  const handleRecordCashMovement = async (
    type: 'cash_in' | 'cash_out',
    amount: number,
    reason: string,
  ) => {
    if (!currentShift) return;
    try {
      await repos.pos.recordCashMovement({
        businessId,
        shift_id: currentShift.id,
        movement_type: type,
        amount,
        reason,
        cashierId: currentUser?.id || 'cashier-1',
        cashierName: currentUser?.profile?.full_name || currentUser?.email || 'Cashier',
      });
      setIsCashMovementModalOpen(false);
      // Reload shift details
      const refreshed = await repos.pos.findActiveShift(businessId, currentUser?.id, branchId);
      setCurrentShift(refreshed);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      alert(`Could not record cash movement: ${message}`);
    }
  };

  // Sync offline changes through the app-wide sync engine, so the POS screen
  // and the offline drawer always report the same numbers.
  const handleSyncOfflineSales = async () => {
    const result = await syncNow();
    if (!result) return; // a sync pass was already running

    if (result.failed > 0) {
      alert(
        `Synced ${result.completed} of ${result.total} offline change(s). ` +
          `${result.failed} still need attention — open the offline queue in the header for details.`,
      );
    } else if (result.completed > 0) {
      alert(`Successfully synced ${result.completed} offline change(s) to the server.`);
    }
  };

  // Quick Customer Creation
  const handleQuickCreateCustomer = async (cust: { name: string; phone?: string; email?: string }) => {
    try {
      const created = await repos.contact.createContact({
        business_id: businessId,
        name: cust.name,
        contact_type: 'customer',
        phone: cust.phone || null,
        email: cust.email || null,
        is_active: true,
      } as never);

      if (created) {
        const newC: PosCustomer = {
          id: created.id,
          name: created.name,
          phone: created.phone || undefined,
          email: created.email || undefined,
        };
        setCustomers((prev) => [newC, ...prev]);
        setSelectedCustomer(newC);
      }
    } catch {
      const fallbackCustomer: PosCustomer = {
        id: 'cust-' + Date.now(),
        name: cust.name,
        phone: cust.phone,
        email: cust.email,
      };
      setCustomers((prev) => [fallbackCustomer, ...prev]);
      setSelectedCustomer(fallbackCustomer);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden bg-gray-100">
      {/* ── Top Header Bar ── */}
      <PosHeader
        currentShift={currentShift}
        activeRegister={activeRegister}
        branchName={branchName}
        branches={assignedBranchId ? [] : branches}
        selectedBranchId={branchId}
        onBranchChange={assignedBranchId ? undefined : (id) => {
          branchTouched.current = true;
          setBranchId(id || null);
        }}
        isOnline={isOnline}
        pendingOfflineCount={pendingOfflineCount}
        failedOfflineCount={failedOfflineCount}
        isSyncing={isSyncing}
        canViewOwnerDashboard={permissions.canViewOwnerDashboard}
        canManageRegisters={permissions.canManageRegisters}
        onOpenShiftModal={() => setIsShiftModalOpen(true)}
        onOpenCashMovementModal={() => setIsCashMovementModalOpen(true)}
        onOpenHistoryModal={() => setIsHistoryModalOpen(true)}
        onOpenOwnerAnalytics={() => setViewMode('analytics')}
        onOpenLabelGenerator={() => setIsBarcodeModalOpen(true)}
        onOpenZReport={() => setIsZReportModalOpen(true)}
        onSyncOfflineSales={handleSyncOfflineSales}
        viewMode={viewMode}
        onSelectViewMode={(m) => setViewMode(m)}
      />

      {/* ── Main POS Workspace ── */}
      {viewMode === 'analytics' ? (
        <div className="flex-1 overflow-y-auto bg-gray-50">
          <PosOwnerAnalytics
            sales={salesHistory}
            shifts={currentShift ? [currentShift] : []}
            currentBranchId={branchId || undefined}
            branches={[]}
          />
        </div>
      ) : (
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Left Column: Product Catalog & Barcode Scanner */}
          <div className="flex-1 flex flex-col overflow-hidden border-r border-gray-200 bg-white">
            <PosStockStatusBanner status={stockStatus} onRetry={() => setDataVersion((v) => v + 1)} />
            <div className="flex-1 overflow-hidden">
            <PosProductCatalog
              products={products}
              categories={categories}
              isLoading={isLoadingProducts}
              onAddToCart={handleAddToCart}
            />
            </div>
          </div>

          {/* Right Column: Dynamic Cart & Quick Actions */}
          <div className="w-full md:w-96 lg:w-[420px] flex flex-col bg-white shrink-0 shadow-lg z-10">
            {/* Parked orders pill if any */}
            {parkedOrders.length > 0 && (
              <div className="bg-amber-50 px-3 py-1.5 border-b border-amber-200 flex items-center justify-between text-xs">
                <span className="font-bold text-amber-900">
                  {parkedOrders.length} Parked Order(s)
                </span>
                <div className="flex gap-1.5">
                  {parkedOrders.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleRestoreParkedOrder(p.id)}
                      className="rounded bg-amber-200 px-1.5 py-0.5 text-[11px] font-bold text-amber-900 hover:bg-amber-300"
                    >
                      Restore {p.id}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <PosCart
              items={cartItems}
              totals={cartTotals}
              orderDiscount={orderDiscount}
              selectedCustomer={selectedCustomer}
              customers={customers}
              maxCashierDiscountPercent={permissions.maxCashierDiscountPercent}
              canApplyLineDiscount={permissions.canApplyLineDiscount}
              canApplyOrderDiscount={permissions.canApplyOrderDiscount}
              notes={cartNotes}
              onUpdateQuantity={handleUpdateQuantity}
              onRemoveItem={handleRemoveItem}
              onClearCart={handleClearCart}
              onParkOrder={handleParkOrder}
              onUpdateLineDiscount={handleUpdateLineDiscount}
              onUpdateOrderDiscount={handleUpdateOrderDiscount}
              onSelectCustomer={setSelectedCustomer}
              onQuickCreateCustomer={handleQuickCreateCustomer}
              onProceedToPayment={() => setIsPaymentModalOpen(true)}
              onSetNotes={setCartNotes}
              onRequestManagerApproval={handleRequestManagerApproval}
            />
          </div>
        </div>
      )}

      {/* ── Modals ── */}
      <PosPaymentModal
        open={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        grandTotal={cartTotals.net_payable}
        netPayable={cartTotals.net_payable}
        enabledMethods={permissions.settings?.enabled_payment_methods || ['cash', 'airtel_money', 'tnm_mpamba', 'bank_transfer', 'credit_sale']}
        selectedCustomer={selectedCustomer}
        onCompleteSale={handleCompleteSale}
        isProcessing={isProcessingSale}
        canSellOnCredit={permissions.canSellOnCredit}
      />

      <PosReceiptModal
        open={isReceiptModalOpen}
        onClose={() => setIsReceiptModalOpen(false)}
        saleResult={lastSaleResult}
        settings={permissions.settings}
        onNewSale={handleClearCart}
      />

      <PosShiftModal
        open={isShiftModalOpen}
        onClose={() => setIsShiftModalOpen(false)}
        currentShift={currentShift}
        onOpenShift={handleOpenShift}
        onCloseShift={handleCloseShift}
      />

      <PosCashMovementModal
        open={isCashMovementModalOpen}
        onClose={() => setIsCashMovementModalOpen(false)}
        currentShift={currentShift}
        onRecordMovement={handleRecordCashMovement}
      />

      <PosSalesHistoryModal
        open={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
        sales={salesHistory}
        canProcessReturns={permissions.canProcessReturns}
        canVoidSales={permissions.canVoidSales}
        onProcessReturn={async (saleId, items, refundMethod, approvalToken) => {
          await processReturn({
            businessId,
            originalInvoiceId: saleId,
            items: items.map((it) => ({
              productId: it.product_id,
              productName: 'Product',
              quantity: it.quantity,
              unitPrice: it.refund_amount / it.quantity,
              refundAmount: it.refund_amount,
            })),
            refundMethod: refundMethod as PosPaymentMethod,
            reason: 'Customer return',
            cashierName: currentUser?.profile?.full_name || currentUser?.email || 'Cashier',
            branchId,
            approvalToken: approvalToken ?? null,
          });
          setDataVersion((v) => v + 1);
        }}
        onVoidSale={async (saleId, reason, approvalToken) => {
          await processVoid({
            businessId,
            invoiceId: saleId,
            reason,
            cashierName: currentUser?.profile?.full_name || currentUser?.email || 'Cashier',
            approvalToken: approvalToken ?? null,
          });
          setDataVersion((v) => v + 1);
        }}
        onRequestManagerApproval={handleRequestManagerApproval}
      />

      <PosManagerApprovalModal
        open={isApprovalModalOpen}
        onClose={() => {
          setIsApprovalModalOpen(false);
          setPendingApprovalCallback(null);
          setApprovalServerContext(null);
        }}
        actionDescription={approvalActionDescription}
        onRequestServerApproval={approvalServerContext
          ? () => requestPosApproval(businessId, approvalServerContext.action, approvalServerContext.documentId, approvalActionDescription).then((a) => a.token)
          : undefined}
        onApprove={handleManagerApproved}
      />

      <PosBarcodeLabelGenerator
        open={isBarcodeModalOpen}
        onClose={() => setIsBarcodeModalOpen(false)}
        products={products}
      />

      <PosZReportModal
        open={isZReportModalOpen}
        onClose={() => setIsZReportModalOpen(false)}
        shift={currentShift}
        sales={salesHistory}
        businessName={branchName}
        branchName={branchName}
        ownerEmail={currentUser?.email || undefined}
        serverReportNumber={zReportServerNumber}
      />
    </div>
  );
}
export default PosPage;
