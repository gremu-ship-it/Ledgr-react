import { useState, useMemo } from 'react';
import {
  X,
  CreditCard,
  Banknote,
  Smartphone,
  Building2,
  Calendar,
  AlertCircle,
  Plus,
  Trash2,
  CheckCircle2,
  Coins,
} from 'lucide-react';
import type { PosPaymentMethod, PosPaymentSplit, PosCustomer } from '@/types/pos';
import { formatMwkDetailed } from '@/lib/formatters';

interface PosPaymentModalProps {
  open: boolean;
  onClose: () => void;
  grandTotal: number;
  netPayable?: number;
  enabledMethods?: PosPaymentMethod[] | string[];
  enabledPaymentMethods?: PosPaymentMethod[] | string[];
  selectedCustomer?: PosCustomer | null;
  onCompleteSale: (payload: any, isCreditSale?: boolean, dueDate?: string) => Promise<void>;
  isProcessing?: boolean;
  canSellOnCredit?: boolean;
}

const METHOD_LABELS: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  cash: { label: 'Cash (MWK)', icon: Banknote, color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  airtel_money: { label: 'Airtel Money', icon: Smartphone, color: 'text-red-700 bg-red-50 border-red-200' },
  tnm_mpamba: { label: 'TNM Mpamba', icon: Smartphone, color: 'text-green-700 bg-green-50 border-green-200' },
  bank_transfer: { label: 'Bank Transfer', icon: Building2, color: 'text-blue-700 bg-blue-50 border-blue-200' },
  card: { label: 'Card / POS', icon: CreditCard, color: 'text-purple-700 bg-purple-50 border-purple-200' },
  credit: { label: 'Credit Sale', icon: Calendar, color: 'text-amber-700 bg-amber-50 border-amber-200' },
  credit_sale: { label: 'Credit Sale', icon: Calendar, color: 'text-amber-700 bg-amber-50 border-amber-200' },
  other: { label: 'Other', icon: Coins, color: 'text-gray-700 bg-gray-50 border-gray-200' },
};

const COMMON_MWK_TENDERS = [1000, 2000, 5000, 10000, 20000, 50000];

export function PosPaymentModal({
  open,
  onClose,
  grandTotal: propGrandTotal,
  netPayable,
  enabledMethods,
  enabledPaymentMethods,
  selectedCustomer,
  onCompleteSale,
  isProcessing = false,
  canSellOnCredit = true,
}: PosPaymentModalProps) {
  if (!open) return null;

  const payable = netPayable !== undefined ? netPayable : (propGrandTotal || 0);

  const availableMethods = useMemo(() => {
    const list = enabledMethods || enabledPaymentMethods || ['cash', 'airtel_money', 'tnm_mpamba', 'bank_transfer', 'credit_sale'];
    return list;
  }, [enabledMethods, enabledPaymentMethods]);

  const [isSplitMode, setIsSplitMode] = useState(false);
  const [singleMethod, setSingleMethod] = useState<PosPaymentMethod>('cash');
  const [cashTendered, setCashTendered] = useState<number>(payable);
  const [reference, setReference] = useState<string>('');

  // Split payment rows
  const [splitRows, setSplitRows] = useState<PosPaymentSplit[]>([
    { payment_method: 'cash', amount: payable, tendered: payable },
  ]);

  // Credit sale state
  const [isCreditSale, setIsCreditSale] = useState(false);
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });
  const [creditNotes, setCreditNotes] = useState('');

  // Total tendered & change calculation
  const totalTendered = useMemo(() => {
    if (isCreditSale) return 0;
    if (!isSplitMode) {
      return singleMethod === 'cash' ? cashTendered : payable;
    }
    return splitRows.reduce((sum, r) => sum + (r.tendered || r.amount || 0), 0);
  }, [isCreditSale, isSplitMode, singleMethod, cashTendered, payable, splitRows]);

  const totalAssigned = useMemo(() => {
    if (!isSplitMode) return payable;
    return splitRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  }, [isSplitMode, payable, splitRows]);

  const changeDue = useMemo(() => {
    if (isCreditSale) return 0;
    return Math.max(0, totalTendered - payable);
  }, [isCreditSale, totalTendered, payable]);

  const remainingToAssign = Math.max(0, payable - totalAssigned);

  const handleAddSplitRow = () => {
    setSplitRows([
      ...splitRows,
      { payment_method: 'airtel_money', amount: remainingToAssign, reference: '' },
    ]);
  };

  const handleRemoveSplitRow = (index: number) => {
    if (splitRows.length <= 1) return;
    setSplitRows(splitRows.filter((_, i) => i !== index));
  };

  const handleUpdateSplitRow = (index: number, patch: Partial<PosPaymentSplit>) => {
    setSplitRows(splitRows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isCreditSale) {
      if (!selectedCustomer) {
        alert('Credit sales require an active customer to be selected.');
        return;
      }
      await onCompleteSale({
        payments: [{ payment_method: 'credit_sale', amount: payable }],
        totalPaid: 0,
        changeGiven: 0,
        dueDate,
        notes: creditNotes,
      }, true, dueDate);
      return;
    }

    if (isSplitMode) {
      if (Math.abs(totalAssigned - payable) > 0.05) {
        alert(`Split total (${formatMwkDetailed(totalAssigned)}) must equal sale total (${formatMwkDetailed(payable)})`);
        return;
      }
      await onCompleteSale({
        payments: splitRows,
        totalPaid: totalTendered,
        changeGiven: changeDue,
        notes: reference,
      }, false);
    } else {
      if (singleMethod === 'cash' && cashTendered < payable) {
        alert('Cash tendered cannot be less than the net payable amount.');
        return;
      }
      await onCompleteSale({
        payments: [
          {
            payment_method: singleMethod,
            amount: payable,
            tendered: singleMethod === 'cash' ? cashTendered : payable,
            reference: reference || undefined,
          },
        ],
        totalPaid: singleMethod === 'cash' ? cashTendered : payable,
        changeGiven: changeDue,
        notes: reference,
      }, false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-brand-600" />
            <h2 className="text-base font-black text-gray-900">Payment Checkout</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Total Banner */}
        <div className="my-3 rounded-2xl bg-brand-600 p-4 text-white flex items-center justify-between shadow-md">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-brand-100">Total Payable</p>
            <p className="text-2xl font-black">{formatMwkDetailed(payable)}</p>
          </div>
          {selectedCustomer && (
            <div className="text-right">
              <p className="text-xs text-brand-200">Customer</p>
              <p className="text-xs font-bold truncate max-w-[150px]">{selectedCustomer.name}</p>
            </div>
          )}
        </div>

        {/* Content Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto pr-1 space-y-4">
          {/* Mode Switcher */}
          <div className="flex rounded-xl bg-gray-100 p-1">
            <button
              type="button"
              onClick={() => {
                setIsCreditSale(false);
                setIsSplitMode(false);
              }}
              className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition-all ${
                !isCreditSale && !isSplitMode ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-500'
              }`}
            >
              Single Payment
            </button>
            <button
              type="button"
              onClick={() => {
                setIsCreditSale(false);
                setIsSplitMode(true);
              }}
              className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition-all ${
                !isCreditSale && isSplitMode ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-500'
              }`}
            >
              Split Payment
            </button>
            {canSellOnCredit && (
              <button
                type="button"
                onClick={() => setIsCreditSale(true)}
                className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition-all ${
                  isCreditSale ? 'bg-white text-amber-900 shadow-xs' : 'text-gray-500'
                }`}
              >
                Store Credit
              </button>
            )}
          </div>

          {isCreditSale ? (
            /* ── CREDIT SALE VIEW ── */
            <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/50 p-4">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-900">
                <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                <span>Credit Sale will create an open invoice under customer ledger.</span>
              </div>

              {!selectedCustomer && (
                <div className="rounded-xl bg-red-100 p-2.5 text-xs font-bold text-red-700">
                  ⚠️ Please close this modal and select/create a customer first.
                </div>
              )}

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                  Payment Due Date
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs font-semibold focus:border-brand-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                  Credit Terms / Notes
                </label>
                <input
                  type="text"
                  placeholder="e.g. 30 Days Net, Approved by Store Manager"
                  value={creditNotes}
                  onChange={(e) => setCreditNotes(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs focus:border-brand-500 focus:outline-none"
                />
              </div>
            </div>
          ) : !isSplitMode ? (
            /* ── SINGLE PAYMENT VIEW ── */
            <div className="space-y-4">
              {/* Payment Methods Grid */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {availableMethods.map((m) => {
                  const conf = METHOD_LABELS[m] || { label: m, icon: Coins, color: 'text-gray-700 bg-gray-50' };
                  const Icon = conf.icon;
                  const isSelected = singleMethod === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setSingleMethod(m as PosPaymentMethod);
                        if (m === 'cash') setCashTendered(payable);
                      }}
                      className={`flex flex-col items-center justify-center gap-1.5 p-3 rounded-2xl border transition-all ${
                        isSelected
                          ? 'border-brand-600 bg-brand-50/60 ring-2 ring-brand-500 text-brand-900 shadow-xs'
                          : 'border-gray-200 bg-white hover:bg-gray-50 text-gray-700'
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                      <span className="text-xs font-black">{conf.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Cash Tender Details */}
              {singleMethod === 'cash' && (
                <div className="space-y-3 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                      Cash Tendered (MWK)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={cashTendered || ''}
                      onChange={(e) => setCashTendered(Number(e.target.value))}
                      className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-base font-black text-gray-900 focus:border-brand-500 focus:outline-none"
                    />
                  </div>

                  {/* Quick MWK Notes */}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {COMMON_MWK_TENDERS.map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => setCashTendered(amt)}
                        className="rounded-xl border border-gray-200 bg-white px-2.5 py-1 text-xs font-bold text-gray-700 hover:bg-gray-100 active:scale-95 transition-all shadow-xs"
                      >
                        {formatMwkDetailed(amt)}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setCashTendered(payable)}
                      className="rounded-xl border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-bold text-brand-700 hover:bg-brand-100 shadow-xs"
                    >
                      Exact (K{payable.toLocaleString()})
                    </button>
                  </div>

                  {/* Change Breakdown */}
                  <div className="pt-2 flex items-center justify-between border-t border-gray-200 text-sm">
                    <span className="font-bold text-gray-600">Change Due:</span>
                    <span
                      className={`text-base font-black ${
                        changeDue > 0 ? 'text-emerald-600' : 'text-gray-900'
                      }`}
                    >
                      {formatMwkDetailed(changeDue)}
                    </span>
                  </div>
                </div>
              )}

              {/* Reference */}
              {singleMethod !== 'cash' && (
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                    Transaction Reference / Approval Code
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. TXN-894729"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs focus:border-brand-500 focus:outline-none"
                  />
                </div>
              )}
            </div>
          ) : (
            /* ── SPLIT PAYMENT VIEW ── */
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-600">
                  Split Payment Breakdown
                </span>
                <button
                  type="button"
                  onClick={handleAddSplitRow}
                  className="flex items-center gap-1 rounded-lg bg-brand-50 px-2.5 py-1 text-xs font-bold text-brand-700 hover:bg-brand-100"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Payment
                </button>
              </div>

              <div className="space-y-2">
                {splitRows.map((row, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-gray-50 p-2.5"
                  >
                    <select
                      value={row.payment_method || (row as any).method || 'cash'}
                      onChange={(e) => handleUpdateSplitRow(idx, { payment_method: e.target.value as any })}
                      className="rounded-xl border border-gray-200 bg-white px-2 py-1.5 text-xs font-bold text-gray-800 focus:border-brand-500 focus:outline-none"
                    >
                      {availableMethods.map((m) => (
                        <option key={m} value={m}>
                          {METHOD_LABELS[m]?.label || m}
                        </option>
                      ))}
                    </select>

                    <input
                      type="number"
                      min={0}
                      value={row.amount || ''}
                      onChange={(e) =>
                        handleUpdateSplitRow(idx, {
                          amount: Number(e.target.value),
                          tendered: Number(e.target.value),
                        })
                      }
                      placeholder="Amount"
                      className="w-28 rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-bold focus:border-brand-500 focus:outline-none"
                    />

                    <input
                      type="text"
                      value={row.reference || ''}
                      onChange={(e) => handleUpdateSplitRow(idx, { reference: e.target.value })}
                      placeholder="Ref / Note"
                      className="flex-1 rounded-xl border border-gray-200 bg-white px-2 py-1.5 text-xs focus:border-brand-500 focus:outline-none"
                    />

                    {splitRows.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveSplitRow(idx)}
                        className="rounded-lg p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Split Balance Summary */}
              <div className="rounded-2xl border border-gray-200 bg-white p-3 space-y-1.5 text-xs font-semibold">
                <div className="flex justify-between">
                  <span>Assigned Total:</span>
                  <span>{formatMwkDetailed(totalAssigned)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Remaining to tender:</span>
                  <span className={remainingToAssign > 0 ? 'text-red-600 font-bold' : 'text-emerald-600 font-bold'}>
                    {formatMwkDetailed(remainingToAssign)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Submit Button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={isProcessing || (isCreditSale && !selectedCustomer)}
              className="w-full flex items-center justify-center gap-2 rounded-2xl bg-brand-600 hover:bg-brand-700 text-white py-3.5 font-black text-sm shadow-md disabled:opacity-50 active:scale-95 transition-all"
            >
              <CheckCircle2 className="h-5 w-5" />
              {isProcessing
                ? 'Processing Sale...'
                : isCreditSale
                ? `Complete Credit Sale (${formatMwkDetailed(payable)})`
                : `Complete Sale (${formatMwkDetailed(payable)})`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
