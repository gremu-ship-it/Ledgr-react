import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
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

export interface PaymentCompletionPayload {
  payments: PosPaymentSplit[];
  totalPaid: number;
  changeGiven: number;
  dueDate?: string;
  notes?: string;
}

interface PosPaymentModalProps {
  open: boolean;
  onClose: () => void;
  grandTotal: number;
  netPayable?: number;
  enabledMethods?: PosPaymentMethod[] | string[];
  enabledPaymentMethods?: PosPaymentMethod[] | string[];
  selectedCustomer?: PosCustomer | null;
  onCompleteSale: (payload: PaymentCompletionPayload, isCreditSale?: boolean, dueDate?: string) => Promise<void>;
  isProcessing?: boolean;
  canSellOnCredit?: boolean;
  /** null means unlimited; 1 disables split tender; 2 is the Starter limit. */
  maxTenders?: number | null;
}

const METHOD_LABELS: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  cash: { label: 'pos.checkout.methods.cash', icon: Banknote, color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  airtel_money: { label: 'pos.checkout.methods.airtelMoney', icon: Smartphone, color: 'text-red-700 bg-red-50 border-red-200' },
  tnm_mpamba: { label: 'pos.checkout.methods.tnmMpamba', icon: Smartphone, color: 'text-green-700 bg-green-50 border-green-200' },
  bank_transfer: { label: 'pos.checkout.methods.bankTransfer', icon: Building2, color: 'text-blue-700 bg-blue-50 border-blue-200' },
  card: { label: 'pos.checkout.methods.card', icon: CreditCard, color: 'text-purple-700 bg-purple-50 border-purple-200' },
  credit: { label: 'pos.checkout.methods.creditSale', icon: Calendar, color: 'text-amber-700 bg-amber-50 border-amber-200' },
  credit_sale: { label: 'pos.checkout.methods.creditSale', icon: Calendar, color: 'text-amber-700 bg-amber-50 border-amber-200' },
  other: { label: 'pos.checkout.methods.other', icon: Coins, color: 'text-gray-700 bg-gray-50 border-gray-200' },
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
  maxTenders = 2,
}: PosPaymentModalProps) {
  const { t } = useTranslation();
  const payable = netPayable !== undefined ? netPayable : (propGrandTotal || 0);

  const availableMethods = useMemo(() => {
    const list = enabledMethods || enabledPaymentMethods || ['cash', 'airtel_money', 'tnm_mpamba', 'bank_transfer', 'credit_sale'];
    return list;
  }, [enabledMethods, enabledPaymentMethods]);

  const [isSplitMode, setIsSplitMode] = useState(false);
  const [singleMethod, setSingleMethod] = useState<PosPaymentMethod>('cash');
  const [cashTendered, setCashTendered] = useState<number>(payable);
  const [reference, setReference] = useState<string>('');

  const [splitRows, setSplitRows] = useState<PosPaymentSplit[]>([
    { payment_method: 'cash', amount: payable, tendered: payable },
  ]);

  const [isCreditSale, setIsCreditSale] = useState(false);
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });
  const [creditNotes, setCreditNotes] = useState('');

  const [lastPaymentReset, setLastPaymentReset] = useState({ open: false, payable });
  if (open && (!lastPaymentReset.open || lastPaymentReset.payable !== payable)) {
    setIsSplitMode(false);
    setSingleMethod('cash');
    setCashTendered(payable);
    setReference('');
    setSplitRows([{ payment_method: 'cash', amount: payable, tendered: payable }]);
    setIsCreditSale(false);
    setCreditNotes('');
    setLastPaymentReset({ open: true, payable });
  } else if (!open && lastPaymentReset.open) {
    setLastPaymentReset({ open: false, payable });
  }

  const totalTendered = useMemo(() => {
    if (isCreditSale) return 0;
    if (!isSplitMode) {
      return singleMethod === 'cash'
        ? Math.round((Number(cashTendered) || 0) * 100) / 100
        : Math.round((Number(payable) || 0) * 100) / 100;
    }
    return splitRows.reduce((sum, r) => sum + Math.round((Number(r.tendered ?? r.amount) || 0) * 100), 0) / 100;
  }, [isCreditSale, isSplitMode, singleMethod, cashTendered, payable, splitRows]);

  const changeDue = useMemo(() => {
    if (isCreditSale) return 0;
    return Math.round(Math.max(0, totalTendered - payable) * 100) / 100;
  }, [isCreditSale, totalTendered, payable]);

  const payableCents = Math.round((Number(payable) || 0) * 100);
  const totalAssignedCents = splitRows.reduce(
    (sum, row) => sum + Math.round((Number(row.amount) || 0) * 100),
    0,
  );
  const totalAssigned = isSplitMode ? totalAssignedCents / 100 : payable;
  const remainingToAssign = (payableCents - totalAssignedCents) / 100;
  const splitIsBalanced = totalAssignedCents === payableCents;
  const canSplit = maxTenders === null || maxTenders >= 2;
  const canAddTender = maxTenders === null || splitRows.length < maxTenders;
  const singleCashIsValid = singleMethod !== 'cash' || Math.round((Number(cashTendered) || 0) * 100) >= payableCents;

  if (!open) return null;

  const handleAddSplitRow = () => {
    if (!canAddTender) return;
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
        alert(t('pos.checkout.creditRequiresCustomer'));
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
      if (!canSplit || !splitIsBalanced || splitRows.length < 2 || splitRows.some((row) => Math.round((Number(row.amount) || 0) * 100) <= 0) || (maxTenders !== null && splitRows.length > maxTenders)) {
        alert(t('pos.checkout.splitMustMatch', {
          assigned: formatMwkDetailed(totalAssigned),
          total: formatMwkDetailed(payable),
        }));
        return;
      }
      await onCompleteSale({
        payments: splitRows.map((row) => ({
          ...row,
          amount: Math.round((Number(row.amount) || 0) * 100) / 100,
          tendered: Math.round((Number(row.tendered ?? row.amount) || 0) * 100) / 100,
        })),
        totalPaid: totalTendered,
        changeGiven: changeDue,
        notes: reference,
      }, false);
    } else {
      if (!singleCashIsValid) {
        alert(t('pos.checkout.cashTenderedTooLow'));
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
            <h2 className="text-base font-black text-gray-900">{t('pos.checkout.title')}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('pos.checkout.close')}
            className="rounded-xl p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Total Banner */}
        <div className="my-3 rounded-2xl bg-brand-600 p-4 text-white flex items-center justify-between shadow-md">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-brand-100">{t('pos.checkout.totalPayable')}</p>
            <p className="text-2xl font-black">{formatMwkDetailed(payable)}</p>
          </div>
          {selectedCustomer && (
            <div className="text-right">
              <p className="text-xs text-brand-200">{t('pos.checkout.customer')}</p>
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
              {t('pos.checkout.singlePayment')}
            </button>
            <button
              type="button"
              disabled={!canSplit}
              title={!canSplit ? t('pos.checkout.splitRequiresStarter') : undefined}
              onClick={() => {
                if (!canSplit) return;
                setIsCreditSale(false);
                setIsSplitMode(true);
              }}
              className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                !isCreditSale && isSplitMode ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-500'
              }`}
            >
              {t('pos.checkout.splitPayment')}
            </button>
            {canSellOnCredit && (
              <button
                type="button"
                onClick={() => setIsCreditSale(true)}
                className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition-all ${
                  isCreditSale ? 'bg-white text-amber-900 shadow-xs' : 'text-gray-500'
                }`}
              >
                {t('pos.checkout.storeCredit')}
              </button>
            )}
          </div>

          {isCreditSale ? (
            /* ── CREDIT SALE VIEW ── */
            <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/50 p-4">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-900">
                <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                <span>{t('pos.checkout.creditInfo')}</span>
              </div>

              {!selectedCustomer && (
                <div className="rounded-xl bg-red-100 p-2.5 text-xs font-bold text-red-700">
                  {t('pos.checkout.selectCustomerForCredit')}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                  {t('pos.checkout.paymentDueDate')}
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
                  {t('pos.checkout.creditTerms')}
                </label>
                <input
                  type="text"
                  placeholder={t('pos.checkout.creditTermsPlaceholder')}
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
                      <span className="text-xs font-black">{t(conf.label)}</span>
                    </button>
                  );
                })}
              </div>

              {/* Cash Tender Details */}
              {singleMethod === 'cash' && (
                <div className="space-y-3 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                      {t('pos.checkout.cashTendered')}
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
                      {t('pos.checkout.exactAmount', { amount: payable.toLocaleString() })}
                    </button>
                  </div>

                  {/* Change Breakdown */}
                  <div className="pt-2 flex items-center justify-between border-t border-gray-200 text-sm">
                    <span className="font-bold text-gray-600">{t('pos.checkout.changeDue')}:</span>
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
                    {t('pos.checkout.transactionReference')}
                  </label>
                  <input
                    type="text"
                    placeholder={t('pos.checkout.referencePlaceholder')}
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
                  {t('pos.checkout.splitBreakdown')}
                </span>
                <button
                  type="button"
                  onClick={handleAddSplitRow}
                  disabled={!canAddTender}
                  title={!canAddTender && maxTenders !== null ? t('pos.checkout.tenderLimit', { count: maxTenders }) : undefined}
                  className="flex items-center gap-1 rounded-lg bg-brand-50 px-2.5 py-1 text-xs font-bold text-brand-700 hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" /> {t('pos.checkout.addTender')}
                </button>
              </div>
              {maxTenders !== null && (
                <p className="text-[11px] text-gray-500">{t('pos.checkout.tenderLimit', { count: maxTenders })}</p>
              )}

              <div className="space-y-2">
                {splitRows.map((row, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-gray-50 p-2.5"
                  >
                    <select
                      value={row.payment_method || 'cash'}
                      onChange={(e) => handleUpdateSplitRow(idx, { payment_method: e.target.value as PosPaymentMethod })}
                      className="rounded-xl border border-gray-200 bg-white px-2 py-1.5 text-xs font-bold text-gray-800 focus:border-brand-500 focus:outline-none"
                    >
                      {availableMethods.map((m) => (
                        <option key={m} value={m}>
                          {t(METHOD_LABELS[m]?.label || m)}
                        </option>
                      ))}
                    </select>

                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      aria-label={t('pos.checkout.tenderAmount', { index: idx + 1 })}
                      value={row.amount || ''}
                      onChange={(e) =>
                        handleUpdateSplitRow(idx, {
                          amount: Number(e.target.value),
                          tendered: Number(e.target.value),
                        })
                      }
                      placeholder={t('pos.checkout.amount')}
                      className="w-28 rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-bold focus:border-brand-500 focus:outline-none"
                    />

                    <input
                      type="text"
                      value={row.reference || ''}
                      onChange={(e) => handleUpdateSplitRow(idx, { reference: e.target.value })}
                      placeholder={t('pos.checkout.referenceNote')}
                      className="flex-1 rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-xs focus:border-brand-500 focus:outline-none"
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
                  <span>{t('pos.checkout.assignedTotal')}</span>
                  <span>{formatMwkDetailed(totalAssigned)}</span>
                </div>
                <div className="flex justify-between">
                  <span>{t('pos.checkout.remainingToTender')}</span>
                  <span className={remainingToAssign !== 0 ? 'text-red-600 font-bold' : 'text-emerald-600 font-bold'}>
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
              disabled={
                isProcessing ||
                (isCreditSale && !selectedCustomer) ||
                (isSplitMode && (!canSplit || !splitIsBalanced || splitRows.length < 2 || splitRows.some((row) => Math.round((Number(row.amount) || 0) * 100) <= 0) || (maxTenders !== null && splitRows.length > maxTenders))) ||
                (!isCreditSale && !isSplitMode && !singleCashIsValid)
              }
              className="w-full flex items-center justify-center gap-2 rounded-2xl bg-brand-600 hover:bg-brand-700 text-white py-3.5 font-black text-sm shadow-md disabled:opacity-50 active:scale-95 transition-all"
            >
              <CheckCircle2 className="h-5 w-5" />
              {isProcessing
                ? t('pos.checkout.processing')
                : isCreditSale
                ? t('pos.checkout.completeCreditSale', { total: formatMwkDetailed(payable) })
                : t('pos.checkout.completeSale', { total: formatMwkDetailed(payable) })}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
