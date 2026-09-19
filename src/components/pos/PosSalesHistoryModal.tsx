import { useState } from 'react';
import {
  X,
  Search,
  RotateCcw,
  Ban,
  Receipt,
} from 'lucide-react';
import type { PosSale } from '@/types/pos';
import { formatMwkDetailed } from '@/lib/formatters';

interface PosSalesHistoryModalProps {
  open: boolean;
  onClose: () => void;
  sales: PosSale[];
  canProcessReturns?: boolean;
  canVoidSales?: boolean;
  onProcessReturn?: (saleId: string, items: Array<{ product_id: string; quantity: number; refund_amount: number }>, refundMethod: string) => Promise<void>;
  onVoidSale?: (saleId: string, reason: string) => Promise<void>;
  onRequestManagerApproval?: (actionDescription: string, onApproved: (approverName: string) => void) => void;
}

export function PosSalesHistoryModal({
  open,
  onClose,
  sales = [],
  canProcessReturns = true,
  canVoidSales = false,
  onProcessReturn,
  onVoidSale,
  onRequestManagerApproval,
}: PosSalesHistoryModalProps) {
  if (!open) return null;

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSale, setSelectedSale] = useState<PosSale | null>(null);
  const [returnItems, setReturnItems] = useState<Record<string, number>>({});
  const [refundMethod, setRefundMethod] = useState<'cash' | 'original' | 'credit'>('cash');
  const [isProcessing, setIsProcessing] = useState(false);

  const filteredSales = sales.filter((s) => {
    const q = searchTerm.toLowerCase();
    const rNo = (s.receipt_number || (s as any).receiptNumber || s.id || '').toLowerCase();
    const cust = ((s as any).customerName || (s as any).customer_name || '').toLowerCase();
    return rNo.includes(q) || cust.includes(q);
  });

  const handleSelectSale = (sale: PosSale) => {
    setSelectedSale(sale);
    const initialQtys: Record<string, number> = {};
    const items = sale.items || (sale as any).pos_sale_items || [];
    items.forEach((it: any) => {
      initialQtys[it.id || it.product_id] = 0;
    });
    setReturnItems(initialQtys);
  };

  const handleExecuteReturn = async () => {
    if (!selectedSale || !onProcessReturn) return;

    const items = selectedSale.items || (selectedSale as any).pos_sale_items || [];
    const itemsToReturn: Array<{ product_id: string; quantity: number; refund_amount: number }> = [];

    items.forEach((it: any) => {
      const q = returnItems[it.id || it.product_id] || 0;
      if (q > 0) {
        const uPrice = it.unit_price ?? it.unitPrice ?? 0;
        itemsToReturn.push({
          product_id: it.product_id,
          quantity: q,
          refund_amount: q * uPrice,
        });
      }
    });

    if (itemsToReturn.length === 0) {
      alert('Please select at least 1 item quantity to return.');
      return;
    }

    const runReturn = async () => {
      try {
        setIsProcessing(true);
        await onProcessReturn(selectedSale.id, itemsToReturn, refundMethod);
        alert('Return processed successfully.');
        setSelectedSale(null);
      } catch (err: any) {
        alert(`Failed to process return: ${err.message}`);
      } finally {
        setIsProcessing(false);
      }
    };

    if (!canProcessReturns && onRequestManagerApproval) {
      onRequestManagerApproval(`Authorize customer return for receipt ${selectedSale.receipt_number || selectedSale.id}`, runReturn);
    } else {
      await runReturn();
    }
  };

  const handleExecuteVoid = async () => {
    if (!selectedSale || !onVoidSale) return;
    const reason = prompt('Enter reason for voiding this transaction:');
    if (!reason) return;

    const runVoid = async () => {
      try {
        setIsProcessing(true);
        await onVoidSale(selectedSale.id, reason);
        alert('Sale voided successfully.');
        setSelectedSale(null);
      } catch (err: any) {
        alert(`Failed to void sale: ${err.message}`);
      } finally {
        setIsProcessing(false);
      }
    };

    if (!canVoidSales && onRequestManagerApproval) {
      onRequestManagerApproval(`Authorize sale void for receipt ${selectedSale.receipt_number || selectedSale.id}`, runVoid);
    } else {
      await runVoid();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-4xl rounded-3xl bg-white p-6 shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-brand-600" />
            <h2 className="text-base font-black text-gray-900">Recent Sales & Returns Register</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-gray-400 hover:bg-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Layout */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 overflow-hidden pt-4">
          {/* Left: Sales List */}
          <div className="flex flex-col overflow-hidden border border-gray-200 rounded-2xl bg-white">
            <div className="p-2.5 border-b border-gray-100 bg-gray-50/50">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search receipt # or customer..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 pl-8 pr-3 py-1.5 text-xs focus:border-brand-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
              {filteredSales.length === 0 ? (
                <div className="p-6 text-center text-xs text-gray-400">No matching sales records.</div>
              ) : (
                filteredSales.map((s) => {
                  const isSelected = selectedSale?.id === s.id;
                  const rNo = s.receipt_number || (s as any).receiptNumber || s.id.slice(0, 8).toUpperCase();
                  const net = s.net_amount ?? (s as any).netAmount ?? (s as any).total_amount ?? 0;
                  const date = new Date(s.created_at || (s as any).createdAt || '').toLocaleDateString();

                  return (
                    <div
                      key={s.id}
                      onClick={() => handleSelectSale(s)}
                      className={`p-3 cursor-pointer transition-colors flex items-center justify-between ${
                        isSelected ? 'bg-brand-50/70 border-l-4 border-brand-600' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-black text-gray-900">{rNo}</span>
                          <span
                            className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                              s.status === 'voided'
                                ? 'bg-red-100 text-red-700'
                                : s.status === 'returned'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-emerald-100 text-emerald-700'
                            }`}
                          >
                            {s.status}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-500 mt-0.5">
                          {date} • {(s as any).customerName || (s as any).customer_name || 'Walk-in'}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-black text-gray-900">{formatMwkDetailed(net)}</p>
                        <p className="text-[10px] font-semibold text-gray-400 capitalize">
                          {s.payment_status || 'completed'}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right: Selected Sale Details & Actions */}
          <div className="flex flex-col overflow-hidden border border-gray-200 rounded-2xl bg-gray-50/40 p-4">
            {selectedSale ? (
              <div className="flex-1 flex flex-col overflow-hidden space-y-3">
                <div className="border-b border-gray-200 pb-2 flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-black text-gray-900">
                      Receipt {selectedSale.receipt_number || selectedSale.id}
                    </h3>
                    <p className="text-[11px] text-gray-500">
                      {new Date(selectedSale.created_at || (selectedSale as any).createdAt || '').toLocaleString()}
                    </p>
                  </div>
                  {selectedSale.status !== 'voided' && (
                    <button
                      type="button"
                      onClick={handleExecuteVoid}
                      disabled={isProcessing}
                      className="flex items-center gap-1 rounded-xl border border-red-200 bg-red-50 px-2 py-1 text-xs font-bold text-red-700 hover:bg-red-100"
                    >
                      <Ban className="h-3.5 w-3.5" /> Void Sale
                    </button>
                  )}
                </div>

                {/* Items in Sale */}
                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-gray-600">
                    Sale Items (Select Qty to Return)
                  </span>
                  {((selectedSale.items || (selectedSale as any).pos_sale_items || []) as any[]).map((it) => {
                    const itKey = it.id || it.product_id;
                    const maxQty = it.quantity;
                    const currentRetQty = returnItems[itKey] || 0;
                    const unitPrice = it.unit_price ?? it.unitPrice ?? 0;

                    return (
                      <div
                        key={itKey}
                        className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white p-2.5 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-gray-900 truncate">
                            {it.product_name || (it as any).name || 'Product'}
                          </p>
                          <p className="text-[11px] text-gray-500">
                            Sold: {maxQty} @ {formatMwkDetailed(unitPrice)}
                          </p>
                        </div>

                        {selectedSale.status !== 'voided' && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-semibold text-gray-600">Return Qty:</span>
                            <select
                              value={currentRetQty}
                              onChange={(e) =>
                                setReturnItems((prev) => ({
                                  ...prev,
                                  [itKey]: Number(e.target.value),
                                }))
                              }
                              className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs font-bold"
                            >
                              {Array.from({ length: maxQty + 1 }, (_, i) => i).map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Return Actions */}
                {selectedSale.status !== 'voided' && (
                  <div className="pt-2 border-t border-gray-200 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-gray-700">Refund Method:</span>
                      <select
                        value={refundMethod}
                        onChange={(e) => setRefundMethod(e.target.value as any)}
                        className="rounded-xl border border-gray-200 bg-white px-2.5 py-1 text-xs font-bold"
                      >
                        <option value="cash">Cash Refund</option>
                        <option value="credit">Store Credit</option>
                        <option value="original">Original Payment</option>
                      </select>
                    </div>

                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={handleExecuteReturn}
                      className="w-full flex items-center justify-center gap-2 rounded-2xl bg-amber-600 hover:bg-amber-700 text-white py-2.5 text-xs font-black shadow-md active:scale-95 transition-all disabled:opacity-40"
                    >
                      <RotateCcw className="h-4 w-4" />
                      {isProcessing ? 'Processing Return...' : 'Process Return & Restock'}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-gray-400">
                <Receipt className="h-8 w-8 text-gray-300 mb-2" />
                <p className="text-xs font-bold text-gray-600">No Sale Selected</p>
                <p className="text-[11px] text-gray-400">Select a transaction from the left to view items or process a return.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
