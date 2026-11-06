import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getErrorMessage } from '@/lib/errorHandler';
import { X, Search, RotateCcw, Ban, Receipt, Printer } from 'lucide-react';
import type { PosSale, PosSaleItem } from '@/types/pos';
import { formatMwkDetailed } from '@/lib/formatters';

export interface PosReturnSelection {
  invoice_line_id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  refund_amount: number;
  reason: string;
  restock: boolean;
}

export interface PosReturnCompleted {
  returnId: string;
  returnNumber: string;
  amount: number;
  refundMethod: 'cash' | 'original' | 'credit';
  lines?: Array<{ invoiceLineId: string; quantity: number; refundAmount: number; reason: string; restock: boolean }>;
}

interface PosSalesHistoryModalProps {
  open: boolean;
  onClose: () => void;
  sales: PosSale[];
  currentShiftId: string | null;
  isSearching?: boolean;
  canSearchHistorical?: boolean;
  canUseStoreCredit?: boolean;
  canProcessReturns?: boolean;
  canVoidSales?: boolean;
  onSearchSales: (term: string) => void;
  onProcessReturn?: (
    saleId: string,
    items: PosReturnSelection[],
    refundMethod: 'cash' | 'original' | 'credit',
    reason: string,
    approvalToken?: string,
  ) => Promise<PosReturnCompleted>;
  onVoidSale?: (saleId: string, reason: string, approvalToken?: string) => Promise<void>;
  onRequestManagerApproval?: (
    actionDescription: string,
    onApproved: (approvalToken?: string) => void,
    serverContext?: { action: 'void_sale' | 'refund_sale'; documentId: string },
  ) => void;
}

export function PosSalesHistoryModal({
  open,
  onClose,
  sales = [],
  currentShiftId,
  isSearching = false,
  canSearchHistorical = false,
  canUseStoreCredit = false,
  canProcessReturns = true,
  canVoidSales = false,
  onSearchSales,
  onProcessReturn,
  onVoidSale,
  onRequestManagerApproval,
}: PosSalesHistoryModalProps) {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSale, setSelectedSale] = useState<PosSale | null>(null);
  const [returnItems, setReturnItems] = useState<Record<string, number>>({});
  const [lineReasons, setLineReasons] = useState<Record<string, string>>({});
  const [restockItems, setRestockItems] = useState<Record<string, boolean>>({});
  const [refundMethod, setRefundMethod] = useState<'cash' | 'original' | 'credit'>('cash');
  const [overallReason, setOverallReason] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [completedReturn, setCompletedReturn] = useState<PosReturnCompleted | null>(null);
  const [receiptSale, setReceiptSale] = useState<PosSale | null>(null);
  const [receiptLines, setReceiptLines] = useState<PosReturnSelection[]>([]);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    if (!open) return;
    const timeout = window.setTimeout(() => onSearchSales(searchTerm), searchTerm ? 250 : 0);
    return () => window.clearTimeout(timeout);
  }, [open, searchTerm, onSearchSales]);

  const filteredSales = useMemo(() => sales.filter((sale) => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return true;
    return [sale.receipt_number, sale.receiptNumber, sale.invoice_number, sale.customerName, sale.customer_name]
      .some((value) => String(value ?? '').toLowerCase().includes(term));
  }), [sales, searchTerm]);

  if (!open) return null;

  const handleSelectSale = (sale: PosSale) => {
    setSelectedSale(sale);
    setActionError('');
    setCompletedReturn(null);
    const items = (sale.items ?? []) as PosSaleItem[];
    const zeros: Record<string, number> = {};
    const restocks: Record<string, boolean> = {};
    items.forEach((item) => {
      const key = item.id || item.product_id;
      if (key) {
        zeros[key] = 0;
        restocks[key] = true;
      }
    });
    setReturnItems(zeros);
    setRestockItems(restocks);
    setLineReasons({});
  };

  const buildSelectedLines = (): PosReturnSelection[] => {
    if (!selectedSale) return [];
    return ((selectedSale.items ?? []) as PosSaleItem[]).flatMap((item) => {
      const id = item.id || '';
      const quantity = Number(returnItems[id] || 0);
      if (!id || quantity <= 0) return [];
      const unitPrice = Number(item.return_unit_price ?? item.unit_price ?? item.unitPrice ?? 0);
      return [{
        invoice_line_id: id,
        product_id: item.product_id || null,
        product_name: item.product_name || item.name || t('pos.returns.unnamedProduct'),
        quantity,
        unit_price: unitPrice,
        refund_amount: Math.round(quantity * unitPrice * 100) / 100,
        reason: (lineReasons[id] || '').trim(),
        restock: restockItems[id] !== false,
      }];
    });
  };

  const executeReturn = async (approvalToken?: string) => {
    if (!selectedSale || !onProcessReturn) return;
    const selectedLines = buildSelectedLines();
    if (!selectedLines.length) {
      setActionError(t('pos.returns.selectQuantityError'));
      return;
    }
    if (selectedLines.some((line) => !line.reason)) {
      setActionError(t('pos.returns.lineReasonRequired'));
      return;
    }
    if (!currentShiftId) {
      setActionError(t('pos.returns.openShiftRequired'));
      return;
    }
    setIsProcessing(true);
    setActionError('');
    try {
      const result = await onProcessReturn(selectedSale.id, selectedLines, refundMethod, overallReason.trim(), approvalToken);
      setReceiptSale(selectedSale);
      setReceiptLines(selectedLines.map((line) => {
        const confirmed = result.lines?.find((returned) => returned.invoiceLineId === line.invoice_line_id);
        return confirmed ? {
          ...line,
          quantity: confirmed.quantity,
          refund_amount: confirmed.refundAmount,
          reason: confirmed.reason || line.reason,
          restock: confirmed.restock,
        } : line;
      }));
      setCompletedReturn(result);
      const returnedByLine = new Map(selectedLines.map((line) => [line.invoice_line_id, line.quantity]));
      setSelectedSale({
        ...selectedSale,
        items: (selectedSale.items ?? []).map((item) => ({
          ...item,
          returnable_quantity: Math.max(0, Number(item.returnable_quantity ?? item.quantity) - (returnedByLine.get(item.id || '') ?? 0)),
        })),
      });
      setReturnItems({});
    } catch (error) {
      setActionError(t('pos.returns.processFailed', { message: getErrorMessage(error) }));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExecuteReturn = async () => {
    if (!selectedSale) return;
    if (!canProcessReturns && onRequestManagerApproval) {
      onRequestManagerApproval(
        t('pos.returns.authorizeReturn', { receipt: selectedSale.receipt_number || selectedSale.id }),
        (token) => { void executeReturn(token); },
        { action: 'refund_sale', documentId: selectedSale.id },
      );
      return;
    }
    await executeReturn();
  };

  const handleExecuteVoid = async () => {
    if (!selectedSale || !onVoidSale) return;
    const reason = window.prompt(t('pos.returns.voidReasonPrompt'));
    if (!reason?.trim()) return;
    const runVoid = async (approvalToken?: string) => {
      try {
        setIsProcessing(true);
        setActionError('');
        await onVoidSale(selectedSale.id, reason.trim(), approvalToken);
        window.alert(t('pos.returns.voidSuccess'));
        setSelectedSale(null);
      } catch (error) {
        setActionError(t('pos.returns.voidFailed', { message: getErrorMessage(error) }));
      } finally {
        setIsProcessing(false);
      }
    };
    if (!canVoidSales && onRequestManagerApproval) {
      onRequestManagerApproval(
        t('pos.returns.authorizeVoid', { receipt: selectedSale.receipt_number || selectedSale.id }),
        (token) => { void runVoid(token); },
        { action: 'void_sale', documentId: selectedSale.id },
      );
    } else {
      await runVoid();
    }
  };

  const printReturn = () => window.print();
  const receiptTotal = completedReturn?.amount ?? receiptLines.reduce((sum, line) => sum + line.refund_amount, 0);
  const methodLabel = completedReturn?.refundMethod === 'credit'
    ? t('pos.returns.storeCredit')
    : completedReturn?.refundMethod === 'original'
      ? t('pos.returns.originalPayment')
      : t('pos.returns.cashRefund');

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs print:hidden">
        <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white p-6 shadow-2xl">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3">
            <div className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-brand-600" />
              <h2 className="text-base font-black text-gray-900">{t('pos.returns.title')}</h2>
            </div>
            <button type="button" onClick={onClose} aria-label={t('pos.returns.close')} className="rounded-xl p-1.5 text-gray-400 hover:bg-gray-100">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden pt-4 md:grid-cols-2">
            <div className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white">
              <div className="border-b border-gray-100 bg-gray-50/50 p-2.5">
                <label className="relative block">
                  <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                  <input
                    type="search"
                    placeholder={canSearchHistorical ? t('pos.returns.searchHistoricalPlaceholder') : t('pos.returns.searchShiftPlaceholder')}
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    className="w-full rounded-xl border border-gray-200 py-1.5 pl-8 pr-3 text-xs focus:border-brand-500 focus:outline-none"
                  />
                </label>
                {!canSearchHistorical && <p className="mt-1 text-[10px] text-gray-500">{t('pos.returns.currentShiftOnly')}</p>}
              </div>
              <div className="flex-1 divide-y divide-gray-100 overflow-y-auto">
                {isSearching ? (
                  <div className="p-6 text-center text-xs text-gray-400">{t('pos.returns.searching')}</div>
                ) : filteredSales.length === 0 ? (
                  <div className="p-6 text-center text-xs text-gray-400">{t('pos.returns.noSales')}</div>
                ) : filteredSales.map((sale) => {
                  const selected = selectedSale?.id === sale.id;
                  return (
                    <button type="button" key={sale.id} onClick={() => handleSelectSale(sale)} className={`flex w-full items-center justify-between p-3 text-left transition-colors ${selected ? 'border-l-4 border-brand-600 bg-brand-50/70' : 'hover:bg-gray-50'}`}>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-black text-gray-900">{sale.receipt_number || sale.invoice_number || sale.id.slice(0, 8).toUpperCase()}</span>
                          <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-700">{t('pos.returns.paid')}</span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-gray-500">{new Date(sale.created_at || sale.createdAt || '').toLocaleString()} · {sale.customer_name || t('pos.returns.walkIn')}</p>
                      </div>
                      <span className="text-xs font-black text-gray-900">{formatMwkDetailed(sale.net_amount ?? sale.total_amount ?? 0)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-gray-50/40 p-4">
              {selectedSale ? (
                <div className="flex flex-1 flex-col space-y-3 overflow-hidden">
                  <div className="flex items-center justify-between border-b border-gray-200 pb-2">
                    <div>
                      <h3 className="text-xs font-black text-gray-900">{t('pos.returns.receiptHeading', { receipt: selectedSale.receipt_number || selectedSale.invoice_number || selectedSale.id })}</h3>
                      <p className="text-[11px] text-gray-500">{new Date(selectedSale.created_at || selectedSale.createdAt || '').toLocaleString()}</p>
                    </div>
                    {onVoidSale && selectedSale.status !== 'voided' && (
                      <button type="button" onClick={handleExecuteVoid} disabled={isProcessing} className="flex items-center gap-1 rounded-xl border border-red-200 bg-red-50 px-2 py-1 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-50">
                        <Ban className="h-3.5 w-3.5" />{t('pos.returns.voidSale')}
                      </button>
                    )}
                  </div>

                  <div className="flex-1 space-y-2 overflow-y-auto pr-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-gray-600">{t('pos.returns.selectItems')}</span>
                    {((selectedSale.items ?? []) as PosSaleItem[]).map((item) => {
                      const key = item.id || '';
                      const soldQty = Math.max(0, Number(item.quantity) || 0);
                      const maxQty = Math.max(0, Number(item.returnable_quantity ?? soldQty) || 0);
                      const selectedQty = returnItems[key] || 0;
                      const unitPrice = Number(item.return_unit_price ?? item.unit_price ?? item.unitPrice ?? 0);
                      return (
                        <div key={key} className="space-y-2 rounded-xl border border-gray-200 bg-white p-2.5 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-bold text-gray-900">{item.product_name || item.name || t('pos.returns.unnamedProduct')}</p>
                              <p className="text-[11px] text-gray-500">{t('pos.returns.soldRemainingLine', { sold: soldQty, remaining: maxQty, price: formatMwkDetailed(unitPrice) })}</p>
                            </div>
                            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-600">
                              {t('pos.returns.quantity')}
                              <input type="number" min={0} max={maxQty} step="any" value={selectedQty} onChange={(event) => setReturnItems((previous) => ({ ...previous, [key]: Number(event.target.value) }))} className="w-20 rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs font-bold" />
                            </label>
                          </div>
                          {selectedQty > 0 && (
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
                              <input value={lineReasons[key] || ''} onChange={(event) => setLineReasons((previous) => ({ ...previous, [key]: event.target.value }))} placeholder={t('pos.returns.lineReasonPlaceholder')} className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs" />
                              <label className="flex items-center gap-1.5 text-[11px] font-medium text-gray-700">
                                <input type="checkbox" checked={restockItems[key] !== false} onChange={(event) => setRestockItems((previous) => ({ ...previous, [key]: event.target.checked }))} />
                                {t('pos.returns.restock')}
                              </label>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="space-y-2 border-t border-gray-200 pt-2">
                    <label className="flex items-center justify-between gap-3 text-xs">
                      <span className="font-bold text-gray-700">{t('pos.returns.refundMethod')}</span>
                      <select value={refundMethod} onChange={(event) => setRefundMethod(event.target.value as 'cash' | 'original' | 'credit')} className="rounded-xl border border-gray-200 bg-white px-2.5 py-1 text-xs font-bold">
                        <option value="cash">{t('pos.returns.cashRefund')}</option>
                        <option value="original">{t('pos.returns.originalPayment')}</option>
                        {canUseStoreCredit && <option value="credit">{t('pos.returns.storeCredit')}</option>}
                      </select>
                    </label>
                    <input value={overallReason} onChange={(event) => setOverallReason(event.target.value)} placeholder={t('pos.returns.returnNotePlaceholder')} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs" />
                    {actionError && <p role="alert" className="text-xs font-medium text-red-700">{actionError}</p>}
                    <button type="button" disabled={isProcessing || !onProcessReturn || !currentShiftId} onClick={handleExecuteReturn} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-600 py-2.5 text-xs font-black text-white shadow-md transition-all hover:bg-amber-700 active:scale-95 disabled:opacity-40">
                      <RotateCcw className="h-4 w-4" />{isProcessing ? t('pos.returns.processing') : t('pos.returns.processReturn')}
                    </button>
                    {completedReturn && (
                      <>
                        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900">
                          <p className="font-bold">{t('pos.returns.returnProcessed')}: {completedReturn.returnNumber}</p>
                          <p>{t('pos.returns.totalRefund')}: {formatMwkDetailed(receiptTotal)} · {methodLabel}</p>
                        </div>
                        <button type="button" onClick={printReturn} className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white py-2 text-xs font-bold text-gray-700 hover:bg-gray-100">
                          <Printer className="h-4 w-4" />{t('pos.returns.printReturn')}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center p-6 text-center text-gray-400">
                  <Receipt className="mb-2 h-8 w-8 text-gray-300" />
                  <p className="text-xs font-bold text-gray-600">{t('pos.returns.noSaleSelected')}</p>
                  <p className="text-[11px] text-gray-400">{t('pos.returns.selectSaleHelp')}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {completedReturn && receiptSale && (
        <>
          <style>{`@media print { body * { visibility: hidden !important; } .pos-return-print, .pos-return-print * { visibility: visible !important; } .pos-return-print { display: block !important; position: fixed !important; inset: 0 !important; z-index: 99999 !important; padding: 24px !important; background: #fff !important; color: #111 !important; } }`}</style>
          <section className="pos-return-print" style={{ display: 'none' }} aria-label={t('pos.returns.printableReceipt')}>
            <header className="mb-5 border-b border-gray-300 pb-3 text-center">
              <h1 className="text-xl font-bold">{completedReturn.refundMethod === 'credit' ? t('pos.returns.voucherTitle') : t('pos.returns.returnReceiptTitle')}</h1>
              <p className="mt-1 text-sm">{t('pos.returns.returnNumber')}: {completedReturn.returnNumber}</p>
              <p className="text-sm">{t('pos.returns.originalReceipt')}: {receiptSale.receipt_number || receiptSale.invoice_number}</p>
              <p className="text-sm">{new Date().toLocaleString()}</p>
            </header>
            <p className="mb-3 text-sm">{t('pos.returns.refundMethod')}: {methodLabel}</p>
            <table className="w-full border-collapse text-sm">
              <thead><tr className="border-b border-gray-400 text-left"><th className="py-2">{t('pos.returns.item')}</th><th>{t('pos.returns.quantity')}</th><th>{t('pos.returns.lineReason')}</th><th className="text-right">{t('pos.returns.amount')}</th></tr></thead>
              <tbody>{receiptLines.map((line) => <tr key={line.invoice_line_id} className="border-b border-gray-200"><td className="py-2">{line.product_name}</td><td>{line.quantity}</td><td>{line.reason}</td><td className="text-right">{formatMwkDetailed(line.refund_amount)}</td></tr>)}</tbody>
            </table>
            <p className="mt-4 text-right text-lg font-bold">{t('pos.returns.totalRefund')}: {formatMwkDetailed(receiptTotal)}</p>
            {completedReturn.refundMethod === 'credit' && <p className="mt-3 border border-gray-400 p-3 text-center font-semibold">{t('pos.returns.voucherInstructions')}</p>}
          </section>
        </>
      )}
    </>
  );
}
