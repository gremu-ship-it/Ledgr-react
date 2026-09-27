import { useState, useMemo } from 'react';
import {
  Trash2,
  Plus,
  Minus,
  User,
  Tag,
  CreditCard,
  PauseCircle,
  X,
  Search,
  Check,
  ShieldAlert,
} from 'lucide-react';
import type { PosCartItem, PosCustomer, PosDiscount, PosCartTotals } from '@/types/pos';
import { formatMwkDetailed } from '@/lib/formatters';

interface PosCartProps {
  items: PosCartItem[];
  totals?: PosCartTotals;
  subtotal?: number;
  totalDiscount?: number;
  taxTotal?: number;
  grandTotal?: number;
  orderDiscount?: PosDiscount;
  orderDiscountPercent?: number;
  selectedCustomer: PosCustomer | null;
  customers: PosCustomer[];
  maxCashierDiscountPercent?: number;
  canApplyLineDiscount?: boolean;
  canApplyOrderDiscount?: boolean;
  notes?: string;
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onRemoveItem: (productId: string) => void;
  onClearCart: () => void;
  onParkOrder: (notes?: string) => void;
  onUpdateLineDiscount?: (productId: string, discount?: PosDiscount) => void;
  onUpdateItemDiscount?: (productId: string, discountPercent: number) => void;
  onUpdateOrderDiscount?: (discount?: PosDiscount) => void;
  onSetOrderDiscountPercent?: (percent: number) => void;
  onSelectCustomer: (customer: PosCustomer | null) => void;
  onQuickCreateCustomer?: (customer: { name: string; phone?: string; email?: string }) => Promise<void>;
  onCreateCustomer?: (customer: { name: string; phone?: string; email?: string }) => Promise<PosCustomer>;
  onProceedToPayment?: () => void;
  onCheckout?: () => void;
  onSetNotes?: (notes: string) => void;
  /**
   * Over-cap discounts and cashier price changes need a SUPERVISOR: the third
   * argument makes the approval a server-minted override token that
   * post_pos_sale consumes (owner decision 2026-09-26).
   */
  onRequestManagerApproval?: (
    actionDescription: string,
    onApproved: (approvalToken?: string) => void,
    serverRequest?: PosOverrideServerRequest,
  ) => void;
  /** True for till supervisors: they may set a line price directly (the server verifies the role). */
  canOverridePriceDirectly?: boolean;
  /** Apply a new unit price to a line, with the authorising token when the operator is not a supervisor. */
  onOverrideLinePrice?: (productId: string, unitPrice: number, token?: string | null) => void;
}

export type PosOverrideServerRequest =
  | { kind: 'discount'; percent: number }
  | { kind: 'price'; productId: string; unitPrice: number };

export function PosCart({
  items,
  totals,
  subtotal: propSubtotal,
  totalDiscount: propTotalDiscount,
  grandTotal: propGrandTotal,
  orderDiscount,
  orderDiscountPercent: propOrderDiscountPercent,
  selectedCustomer,
  customers,
  maxCashierDiscountPercent = 10,
  canApplyLineDiscount = true,
  canApplyOrderDiscount = true,
  onUpdateQuantity,
  onRemoveItem,
  onClearCart,
  onParkOrder,
  onUpdateLineDiscount,
  onUpdateItemDiscount,
  onUpdateOrderDiscount,
  onSetOrderDiscountPercent,
  onSelectCustomer,
  onQuickCreateCustomer,
  onCreateCustomer,
  onProceedToPayment,
  onCheckout,
  onRequestManagerApproval,
  canOverridePriceDirectly = false,
  onOverrideLinePrice,
}: PosCartProps) {
  const [editingPriceItem, setEditingPriceItem] = useState<PosCartItem | null>(null);
  const [linePriceValue, setLinePriceValue] = useState<number>(0);
  // Modal / Dropdown states
  const [isCustomerSelectorOpen, setIsCustomerSelectorOpen] = useState(false);
  const [isNewCustomerModalOpen, setIsNewCustomerModalOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [newCustomerEmail, setNewCustomerEmail] = useState('');

  // Discount modal states
  const [editingDiscountItem, setEditingDiscountItem] = useState<PosCartItem | null>(null);
  const [lineDiscountValue, setLineDiscountValue] = useState<number>(0);
  const [isOrderDiscountOpen, setIsOrderDiscountOpen] = useState(false);
  const [orderDiscountInput, setOrderDiscountInput] = useState<number>(0);

  // Compute subtotal / grandTotal from totals if passed, otherwise from props or items
  const grossSubtotal = totals?.gross_total ?? propSubtotal ?? items.reduce((s, it) => s + (it.unit_price ?? it.unitPrice ?? 0) * it.quantity, 0);
  const totalDiscount = totals?.discount_total ?? propTotalDiscount ?? 0;
  const netPayable = totals?.net_payable ?? propGrandTotal ?? (grossSubtotal - totalDiscount);

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return customers.slice(0, 8);
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.phone && c.phone.toLowerCase().includes(q)) ||
        (c.email && c.email.toLowerCase().includes(q)),
    );
  }, [customers, customerSearch]);

  const handleApplyLineDiscountSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDiscountItem) return;

    const discountVal = Number(lineDiscountValue) || 0;
    const pId = editingDiscountItem.product_id || editingDiscountItem.productId || '';

    if (discountVal > maxCashierDiscountPercent && onRequestManagerApproval) {
      onRequestManagerApproval(
        `Apply ${discountVal}% discount on ${editingDiscountItem.name} (exceeds ${maxCashierDiscountPercent}% cap)`,
        () => {
          if (onUpdateLineDiscount) {
            onUpdateLineDiscount(pId, { type: 'percent', value: discountVal });
          } else if (onUpdateItemDiscount) {
            onUpdateItemDiscount(pId, discountVal);
          }
          setEditingDiscountItem(null);
        },
        { kind: 'discount', percent: discountVal },
      );
    } else {
      if (onUpdateLineDiscount) {
        onUpdateLineDiscount(pId, discountVal > 0 ? { type: 'percent', value: discountVal } : undefined);
      } else if (onUpdateItemDiscount) {
        onUpdateItemDiscount(pId, discountVal);
      }
      setEditingDiscountItem(null);
    }
  };

  const handleApplyLinePriceSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPriceItem || !onOverrideLinePrice) return;
    const pId = editingPriceItem.product_id || editingPriceItem.productId || '';
    const newPrice = Math.round((Number(linePriceValue) || 0) * 100) / 100;
    if (newPrice < 0) return;
    if (canOverridePriceDirectly) {
      onOverrideLinePrice(pId, newPrice, null);
      setEditingPriceItem(null);
      return;
    }
    if (!onRequestManagerApproval) return;
    onRequestManagerApproval(
      `Sell ${editingPriceItem.name} at ${formatMwkDetailed(newPrice)} instead of the catalogue price`,
      (token) => {
        onOverrideLinePrice(pId, newPrice, token ?? null);
        setEditingPriceItem(null);
      },
      { kind: 'price', productId: pId, unitPrice: newPrice },
    );
  };

  const handleApplyOrderDiscountSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const discountVal = Number(orderDiscountInput) || 0;

    if (discountVal > maxCashierDiscountPercent && onRequestManagerApproval) {
      onRequestManagerApproval(
        `Apply ${discountVal}% overall order discount (exceeds ${maxCashierDiscountPercent}% cap)`,
        () => {
          if (onUpdateOrderDiscount) {
            onUpdateOrderDiscount({ type: 'percent', value: discountVal });
          } else if (onSetOrderDiscountPercent) {
            onSetOrderDiscountPercent(discountVal);
          }
          setIsOrderDiscountOpen(false);
        },
        { kind: 'discount', percent: discountVal },
      );
    } else {
      if (onUpdateOrderDiscount) {
        onUpdateOrderDiscount(discountVal > 0 ? { type: 'percent', value: discountVal } : undefined);
      } else if (onSetOrderDiscountPercent) {
        onSetOrderDiscountPercent(discountVal);
      }
      setIsOrderDiscountOpen(false);
    }
  };

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomerName.trim()) return;

    if (onQuickCreateCustomer) {
      await onQuickCreateCustomer({
        name: newCustomerName.trim(),
        phone: newCustomerPhone.trim() || undefined,
        email: newCustomerEmail.trim() || undefined,
      });
    } else if (onCreateCustomer) {
      const created = await onCreateCustomer({
        name: newCustomerName.trim(),
        phone: newCustomerPhone.trim() || undefined,
        email: newCustomerEmail.trim() || undefined,
      });
      onSelectCustomer(created);
    }

    setNewCustomerName('');
    setNewCustomerPhone('');
    setNewCustomerEmail('');
    setIsNewCustomerModalOpen(false);
    setIsCustomerSelectorOpen(false);
  };

  const handleCheckoutClick = () => {
    if (onProceedToPayment) onProceedToPayment();
    else if (onCheckout) onCheckout();
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* ── Top Header: Customer selector & Park ── */}
      <div className="p-3 border-b border-gray-100 flex items-center justify-between gap-2">
        {/* Customer Button */}
        <div className="relative flex-1">
          <button
            type="button"
            onClick={() => setIsCustomerSelectorOpen(!isCustomerSelectorOpen)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-2xl border border-gray-200 bg-gray-50/70 hover:bg-gray-100 text-xs transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0">
              <User className="h-4 w-4 text-brand-600 shrink-0" />
              <span className="font-bold text-gray-900 truncate">
                {selectedCustomer ? selectedCustomer.name : 'Walk-in Customer'}
              </span>
            </div>
            <span className="text-[10px] uppercase font-bold text-gray-400">Change</span>
          </button>

          {/* Customer Dropdown */}
          {isCustomerSelectorOpen && (
            <div className="absolute top-full left-0 right-0 mt-2 z-40 rounded-2xl bg-white border border-gray-200 shadow-xl p-3 space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search customer name/phone..."
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 pl-8 pr-3 py-1.5 text-xs focus:border-brand-500 focus:outline-none"
                />
              </div>

              <div className="max-h-40 overflow-y-auto divide-y divide-gray-100 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    onSelectCustomer(null);
                    setIsCustomerSelectorOpen(false);
                  }}
                  className="w-full text-left py-2 px-2 hover:bg-gray-50 font-bold text-gray-700 flex justify-between"
                >
                  <span>Walk-in Customer (Default)</span>
                  {!selectedCustomer && <Check className="h-3.5 w-3.5 text-brand-600" />}
                </button>
                {filteredCustomers.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      onSelectCustomer(c);
                      setIsCustomerSelectorOpen(false);
                    }}
                    className="w-full text-left py-2 px-2 hover:bg-gray-50 flex items-center justify-between"
                  >
                    <div>
                      <p className="font-bold text-gray-900">{c.name}</p>
                      {c.phone && <p className="text-[11px] text-gray-400">{c.phone}</p>}
                    </div>
                    {selectedCustomer?.id === c.id && <Check className="h-3.5 w-3.5 text-brand-600" />}
                  </button>
                ))}
              </div>

              <div className="pt-2 border-t border-gray-100 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsNewCustomerModalOpen(true);
                    setIsCustomerSelectorOpen(false);
                  }}
                  className="flex-1 rounded-xl bg-brand-50 text-brand-700 py-2 text-xs font-bold hover:bg-brand-100 transition-colors"
                >
                  + Add New Customer
                </button>
                <button
                  type="button"
                  onClick={() => setIsCustomerSelectorOpen(false)}
                  className="rounded-xl px-3 py-2 text-xs font-bold text-gray-500 hover:bg-gray-100"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Park & Clear Buttons */}
        <button
          type="button"
          disabled={items.length === 0}
          onClick={() => onParkOrder()}
          title="Park / Hold Order (F8)"
          className="flex items-center gap-1.5 px-3 py-2 rounded-2xl border border-gray-200 bg-white hover:bg-amber-50 text-amber-700 text-xs font-bold transition-colors disabled:opacity-40"
        >
          <PauseCircle className="h-4 w-4" /> Park
        </button>

        <button
          type="button"
          disabled={items.length === 0}
          onClick={onClearCart}
          title="Clear Cart"
          className="p-2 rounded-2xl border border-gray-200 bg-white hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors disabled:opacity-40"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* ── Cart Items List ── */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-gray-400">
            <Tag className="h-10 w-10 text-gray-300 stroke-[1.5] mb-2" />
            <p className="text-sm font-bold text-gray-600">Cart is Empty</p>
            <p className="text-xs text-gray-400 mt-0.5">Scan a barcode or tap products on the left to start sale.</p>
          </div>
        ) : (
          items.map((item) => {
            const pId = item.product_id || item.productId || '';
            const price = item.unit_price ?? item.unitPrice ?? 0;
            const lineTot = item.line_total ?? item.lineTotal ?? (price * item.quantity);
            const discountPct = item.discount?.type === 'percent' ? item.discount.value : (item.discountPercent || 0);

            return (
              <div
                key={pId}
                className="flex items-center justify-between gap-3 p-3 rounded-2xl border border-gray-100 bg-gray-50/50 hover:bg-gray-50 transition-colors"
              >
                {/* Left info */}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black text-gray-900 truncate">{item.name}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    {formatMwkDetailed(price)} each
                    {discountPct > 0 && (
                      <span className="ml-2 font-bold text-emerald-600">
                        (-{discountPct}%)
                      </span>
                    )}
                  </p>
                </div>

                {/* Quantity Controls */}
                <div className="flex items-center gap-1.5 bg-white rounded-xl border border-gray-200 p-0.5 shadow-2xs">
                  <button
                    type="button"
                    onClick={() => onUpdateQuantity(pId, item.quantity - 1)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 active:scale-90 transition-transform"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <span className="w-7 text-center text-xs font-black text-gray-900">
                    {item.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => onUpdateQuantity(pId, item.quantity + 1)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 active:scale-90 transition-transform"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>

                {/* Line Total & Actions */}
                <div className="text-right shrink-0">
                  <p className="text-xs font-black text-gray-900">{formatMwkDetailed(lineTot)}</p>
                  <div className="flex items-center justify-end gap-1 mt-1">
                    {onOverrideLinePrice && pId && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingPriceItem(item);
                          setLinePriceValue(price);
                        }}
                        className="text-[10px] font-bold text-gray-500 hover:underline"
                        title={canOverridePriceDirectly ? 'Change price' : 'Change price (needs a supervisor)'}
                      >
                        Price
                      </button>
                    )}
                    {canApplyLineDiscount && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingDiscountItem(item);
                          setLineDiscountValue(discountPct);
                        }}
                        className="text-[10px] font-bold text-brand-600 hover:underline"
                      >
                        {discountPct > 0 ? `${discountPct}% Disc` : 'Discount'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onRemoveItem(pId)}
                      className="text-gray-300 hover:text-red-600 p-0.5"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── Cart Totals & Checkout Button ── */}
      <div className="p-4 border-t border-gray-100 bg-gray-50/70 space-y-3">
        <div className="space-y-1.5 text-xs text-gray-600">
          <div className="flex justify-between">
            <span>Subtotal ({items.reduce((s, it) => s + it.quantity, 0)} items)</span>
            <span className="font-bold text-gray-900">{formatMwkDetailed(grossSubtotal)}</span>
          </div>

          <div className="flex justify-between items-center text-emerald-700">
            <span className="flex items-center gap-1">
              <span>Discounts</span>
              {canApplyOrderDiscount && (
                <button
                  type="button"
                  onClick={() => {
                    setOrderDiscountInput(orderDiscount?.type === 'percent' ? orderDiscount.value : (propOrderDiscountPercent || 0));
                    setIsOrderDiscountOpen(true);
                  }}
                  className="font-bold underline text-[11px]"
                >
                  (Order Disc)
                </button>
              )}
            </span>
            <span className="font-bold">-{formatMwkDetailed(totalDiscount)}</span>
          </div>

          <div className="flex justify-between text-base font-black text-gray-900 pt-2 border-t border-gray-200">
            <span>Net Payable</span>
            <span className="text-brand-700">{formatMwkDetailed(netPayable)}</span>
          </div>
        </div>

        {/* Big Pay Button */}
        <button
          type="button"
          disabled={items.length === 0}
          onClick={handleCheckoutClick}
          className="w-full flex items-center justify-center gap-2 rounded-2xl bg-brand-600 hover:bg-brand-700 text-white py-4 text-sm font-black shadow-lg shadow-brand-500/20 disabled:opacity-40 active:scale-95 transition-all"
        >
          <CreditCard className="h-5 w-5" />
          Pay {formatMwkDetailed(netPayable)} (F4)
        </button>
      </div>

      {/* ── Line Discount Modal ── */}
      {editingPriceItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xs rounded-3xl bg-white p-5 shadow-2xl space-y-3">
            <h3 className="font-black text-sm text-gray-900">Change price: {editingPriceItem.name}</h3>
            <form onSubmit={handleApplyLinePriceSubmit} className="space-y-3">
              <div>
                <label htmlFor="pos-line-price" className="block text-xs font-bold uppercase text-gray-600 mb-1">
                  Unit price (MWK)
                </label>
                <input
                  id="pos-line-price"
                  type="number"
                  min={0}
                  step="0.01"
                  autoFocus
                  value={linePriceValue}
                  onChange={(e) => setLinePriceValue(Number(e.target.value))}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-black focus:border-brand-500 focus:outline-none"
                />
              </div>
              {!canOverridePriceDirectly && (
                <p className="text-[11px] text-gray-500">
                  Only a supervisor can change a price. A supervisor must authorise this request before the sale can be recorded.
                </p>
              )}
              <div className="flex gap-2">
                <button type="button" onClick={() => setEditingPriceItem(null)} className="flex-1 rounded-xl border border-gray-200 py-2 text-xs font-bold text-gray-600">
                  Cancel
                </button>
                <button type="submit" className="flex-1 rounded-xl bg-brand-600 py-2 text-xs font-black text-white">
                  {canOverridePriceDirectly ? 'Apply' : 'Request approval'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingDiscountItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xs rounded-3xl bg-white p-5 shadow-2xl space-y-3">
            <h3 className="font-black text-sm text-gray-900">Line Discount: {editingDiscountItem.name}</h3>
            <form onSubmit={handleApplyLineDiscountSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-bold uppercase text-gray-600 mb-1">
                  Discount Percentage (%)
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  autoFocus
                  value={lineDiscountValue}
                  onChange={(e) => setLineDiscountValue(Number(e.target.value))}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-black focus:border-brand-500 focus:outline-none"
                />
                {lineDiscountValue > maxCashierDiscountPercent && (
                  <p className="text-[11px] font-bold text-amber-600 mt-1 flex items-center gap-1">
                    <ShieldAlert className="h-3.5 w-3.5" /> Requires Manager PIN override (&gt;{maxCashierDiscountPercent}%)
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditingDiscountItem(null)}
                  className="flex-1 rounded-xl border border-gray-200 py-2 text-xs font-bold text-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-xl bg-brand-600 text-white py-2 text-xs font-black shadow-xs"
                >
                  Apply
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Order Discount Modal ── */}
      {isOrderDiscountOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xs rounded-3xl bg-white p-5 shadow-2xl space-y-3">
            <h3 className="font-black text-sm text-gray-900">Overall Order Discount</h3>
            <form onSubmit={handleApplyOrderDiscountSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-bold uppercase text-gray-600 mb-1">
                  Order Discount (%)
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  autoFocus
                  value={orderDiscountInput}
                  onChange={(e) => setOrderDiscountInput(Number(e.target.value))}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-black focus:border-brand-500 focus:outline-none"
                />
                {orderDiscountInput > maxCashierDiscountPercent && (
                  <p className="text-[11px] font-bold text-amber-600 mt-1 flex items-center gap-1">
                    <ShieldAlert className="h-3.5 w-3.5" /> Requires Manager PIN override (&gt;{maxCashierDiscountPercent}%)
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsOrderDiscountOpen(false)}
                  className="flex-1 rounded-xl border border-gray-200 py-2 text-xs font-bold text-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-xl bg-brand-600 text-white py-2 text-xs font-black shadow-xs"
                >
                  Apply
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Quick Create Customer Modal ── */}
      {isNewCustomerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-2">
              <h3 className="font-black text-sm text-gray-900">Add New Customer</h3>
              <button
                type="button"
                onClick={() => setIsNewCustomerModalOpen(false)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCreateCustomer} className="space-y-3">
              <div>
                <label className="block text-xs font-bold uppercase text-gray-600 mb-1">
                  Customer Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Mary Tembo"
                  value={newCustomerName}
                  onChange={(e) => setNewCustomerName(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold focus:border-brand-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-gray-600 mb-1">
                  Phone Number
                </label>
                <input
                  type="tel"
                  placeholder="e.g. +265 999 123 456"
                  value={newCustomerPhone}
                  onChange={(e) => setNewCustomerPhone(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs focus:border-brand-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-gray-600 mb-1">
                  Email (Optional)
                </label>
                <input
                  type="email"
                  placeholder="e.g. mary@example.com"
                  value={newCustomerEmail}
                  onChange={(e) => setNewCustomerEmail(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs focus:border-brand-500 focus:outline-none"
                />
              </div>
              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsNewCustomerModalOpen(false)}
                  className="flex-1 rounded-xl border border-gray-200 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-xl bg-brand-600 py-2.5 text-xs font-black text-white hover:bg-brand-700 shadow-md"
                >
                  Save & Select
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
