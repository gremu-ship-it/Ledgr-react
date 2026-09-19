import { useRef, useState } from 'react';
import {
  Printer,
  CheckCircle2,
  X,
  Bluetooth,
  CloudOff,
  AlertTriangle,
} from 'lucide-react';
import type { PosSaleResult, PosSettings, PosSale, PosCartItem, PosPaymentSplit } from '@/types/pos';
import { formatMwkDetailed } from '@/lib/formatters';
import { EscPosBuilder, printViaBluetooth } from '@/lib/pos/escpos';

interface PosReceiptModalProps {
  open: boolean;
  onClose: () => void;
  saleResult: PosSaleResult | null;
  settings?: PosSettings | null;
  onNewSale?: () => void;
}

export function PosReceiptModal({
  open,
  onClose,
  saleResult,
  settings,
  onNewSale,
}: PosReceiptModalProps) {
  const receiptRef = useRef<HTMLDivElement>(null);
  const [isEscPosPrinting, setIsEscPosPrinting] = useState(false);

  if (!open || !saleResult) return null;

  const sale = (saleResult.sale || saleResult) as Partial<PosSale> & Record<string, unknown>;
  const items: Partial<PosCartItem>[] = (saleResult.items || []) as Partial<PosCartItem>[];
  const payments: Partial<PosPaymentSplit>[] = (saleResult.payments || []) as Partial<PosPaymentSplit>[];

  const receiptNumber = String(sale.receipt_number || sale.receiptNumber || sale.id?.slice(0, 8) || 'RECEIPT').toUpperCase();
  const branchName = String(sale.branchName || sale.branch_name || settings?.receipt_header || 'Main Store Branch');
  const cashierName = String(sale.cashierName || sale.cashier_name || 'Cashier');
  const customerName = sale.customerName || sale.customer_name ? String(sale.customerName || sale.customer_name) : null;
  const createdAt = String(sale.createdAt || sale.created_at || new Date().toISOString());
  const grossAmount = Number(sale.gross_amount ?? sale.grossAmount ?? sale.total_amount ?? saleResult.subtotal ?? 0);
  const discountAmount = Number(sale.discount_amount ?? sale.discountAmount ?? saleResult.discountAmount ?? 0);
  const netAmount = Number(sale.net_amount ?? sale.netAmount ?? sale.total_amount ?? saleResult.netPayable ?? (grossAmount - discountAmount));
  const totalPaid = Number(sale.total_paid ?? sale.totalPaid ?? sale.amount_paid ?? saleResult.totalPaid ?? netAmount);
  const changeGiven = Number(sale.change_given ?? sale.changeGiven ?? sale.change ?? saleResult.changeGiven ?? 0);

  const handlePrint = () => {
    window.print();
  };

  const handleDirectEscPosPrint = async () => {
    try {
      setIsEscPosPrinting(true);
      const builder = new EscPosBuilder({ paperWidth: '58mm', openCashDrawer: true });

      builder
        .align('center')
        .bold(true)
        .textSize('double-height')
        .line(settings?.receipt_header || 'LEDGR POS STORE')
        .textSize('normal')
        .bold(false)
        .line(branchName)
        .divider()
        .align('left')
        .twoColumn('Receipt #:', receiptNumber)
        .twoColumn('Date:', new Date(createdAt).toLocaleDateString())
        .twoColumn('Cashier:', cashierName);

      if (customerName) {
        builder.twoColumn('Customer:', customerName);
      }

      builder.divider();

      items.forEach((it) => {
        const name = it.product_name || it.name || 'Item';
        const qty = it.quantity || 1;
        const price = it.unit_price ?? it.unitPrice ?? 0;
        const lineTot = it.line_total ?? it.lineTotal ?? (qty * price);
        builder.twoColumn(`${name} x${qty}`, formatMwkDetailed(lineTot));
      });

      builder
        .divider()
        .twoColumn('Gross Total:', formatMwkDetailed(grossAmount));

      if (discountAmount > 0) {
        builder.twoColumn('Discount:', `-${formatMwkDetailed(discountAmount)}`);
      }

      builder
        .bold(true)
        .twoColumn('Net Payable:', formatMwkDetailed(netAmount))
        .bold(false)
        .divider();

      if (payments.length > 0) {
        payments.forEach((p) => {
          const m = p.payment_method || 'Payment';
          builder.twoColumn(String(m).toUpperCase(), formatMwkDetailed(Number(p.amount || 0)));
        });
      } else {
        builder.twoColumn('Paid:', formatMwkDetailed(totalPaid));
      }

      if (changeGiven > 0) {
        builder.bold(true).twoColumn('Change:', formatMwkDetailed(changeGiven)).bold(false);
      }

      builder
        .divider()
        .align('center')
        .line(settings?.receipt_footer || 'Thank you for your business!')
        .feed(2)
        .cut(true);

      const bytes = builder.build();
      await printViaBluetooth(bytes);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      alert(`Direct thermal print error: ${message}. Falling back to system print.`);
      window.print();
    } finally {
      setIsEscPosPrinting(false);
    }
  };

  const handleDone = () => {
    onClose();
    if (onNewSale) onNewSale();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Modal Top Bar */}
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div className="flex items-center gap-2">
            {saleResult.isOffline ? (
              <CloudOff className="h-5 w-5 text-amber-600" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            )}
            <h2 className="text-base font-black text-gray-900">
              {saleResult.isOffline ? 'Sale Saved Offline' : 'Sale Completed'}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleDone}
            className="rounded-xl p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* An offline sale is not on the server yet. Say so plainly — the
            cashier is holding the only copy of this transaction. */}
        {saleResult.isOffline && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] leading-relaxed text-amber-900">
            <p className="font-bold">This sale is queued on this device.</p>
            <p className="mt-0.5">
              Stock, the ledger and the shift drawer will be updated when the connection
              returns. Keep this device signed in — the sale is stored here, not on the server.
            </p>
          </div>
        )}

        {saleResult.warnings && saleResult.warnings.length > 0 && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[11px] leading-relaxed text-red-900">
            <p className="flex items-center gap-1.5 font-bold">
              <AlertTriangle className="h-3.5 w-3.5" />
              Saved, but needs a follow-up
            </p>
            <ul className="mt-1 list-disc space-y-0.5 ps-4">
              {saleResult.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Printable Receipt Preview */}
        <div className="flex-1 overflow-y-auto py-4">
          <div
            ref={receiptRef}
            className="rounded-2xl border border-dashed border-gray-300 bg-gray-50/50 p-5 font-mono text-xs space-y-4 shadow-2xs"
          >
            {/* Store Header */}
            <div className="text-center space-y-1">
              <h3 className="font-black text-sm uppercase tracking-wider text-gray-900">
                {settings?.receipt_header || 'LEDGR POS STORE'}
              </h3>
              <p className="text-[11px] text-gray-600">{branchName}</p>
              {settings?.receipt_footer && (
                <p className="text-[10px] text-gray-400">{settings.receipt_footer}</p>
              )}
            </div>

            <div className="border-t border-dashed border-gray-300 my-2" />

            {/* Meta */}
            <div className="space-y-1 text-[11px] text-gray-600">
              <div className="flex justify-between">
                <span>Receipt #:</span>
                <span className="font-bold text-gray-900">{receiptNumber}</span>
              </div>
              <div className="flex justify-between">
                <span>Date:</span>
                <span>{new Date(createdAt).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Cashier:</span>
                <span>{cashierName}</span>
              </div>
              {customerName && (
                <div className="flex justify-between">
                  <span>Customer:</span>
                  <span className="font-bold">{customerName}</span>
                </div>
              )}
            </div>

            <div className="border-t border-dashed border-gray-300 my-2" />

            {/* Line Items */}
            <div className="space-y-2">
              <div className="flex justify-between font-bold text-[11px] text-gray-700">
                <span>Item</span>
                <span>Qty x Price</span>
                <span>Total</span>
              </div>
              {items.map((item, idx) => {
                const name = item.product_name || item.name || 'Item';
                const qty = item.quantity || 1;
                const price = item.unit_price ?? item.unitPrice ?? 0;
                const lineTot = item.line_total ?? item.lineTotal ?? (qty * price);
                return (
                  <div key={idx} className="flex justify-between text-[11px] text-gray-800">
                    <span className="truncate max-w-[140px]">{name}</span>
                    <span className="text-gray-500">
                      {qty} @ {formatMwkDetailed(price)}
                    </span>
                    <span className="font-semibold">{formatMwkDetailed(lineTot)}</span>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-dashed border-gray-300 my-2" />

            {/* Totals */}
            <div className="space-y-1 text-[11px]">
              <div className="flex justify-between text-gray-600">
                <span>Gross Total:</span>
                <span>{formatMwkDetailed(grossAmount)}</span>
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-emerald-700 font-semibold">
                  <span>Discount:</span>
                  <span>-{formatMwkDetailed(discountAmount)}</span>
                </div>
              )}
              <div className="flex justify-between font-black text-xs text-gray-900 pt-1 border-t border-gray-200">
                <span>Net Payable:</span>
                <span>{formatMwkDetailed(netAmount)}</span>
              </div>
            </div>

            <div className="border-t border-dashed border-gray-300 my-2" />

            {/* Payment & Change */}
            <div className="space-y-1 text-[11px]">
              {payments.length > 0 ? (
                payments.map((p, pIdx) => {
                  const m = p.payment_method || 'Payment';
                  return (
                    <div key={pIdx} className="flex justify-between text-gray-700">
                      <span className="capitalize">{String(m).replace('_', ' ')}:</span>
                      <span>{formatMwkDetailed(Number(p.amount || 0))}</span>
                    </div>
                  );
                })
              ) : (
                <div className="flex justify-between text-gray-700">
                  <span>Paid:</span>
                  <span>{formatMwkDetailed(totalPaid)}</span>
                </div>
              )}

              {changeGiven > 0 && (
                <div className="flex justify-between text-gray-900 font-bold pt-1">
                  <span>Change Given:</span>
                  <span>{formatMwkDetailed(changeGiven)}</span>
                </div>
              )}
            </div>

            {/* Footer note */}
            <div className="pt-3 text-center text-[10px] text-gray-400 space-y-0.5">
              <p>Thank you for shopping with us!</p>
              <p>Goods once sold are returnable within 7 days with valid receipt.</p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="pt-3 border-t border-gray-100 flex flex-col gap-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-2xl border border-gray-200 bg-white hover:bg-gray-50 py-3 text-xs font-bold text-gray-800 shadow-xs active:scale-95 transition-all"
            >
              <Printer className="h-4 w-4 text-gray-600" />
              Print Receipt
            </button>
            <button
              type="button"
              disabled={isEscPosPrinting}
              onClick={handleDirectEscPosPrint}
              title="Print directly to ESC/POS Thermal Printer over Bluetooth and open cash drawer"
              className="flex items-center justify-center gap-1.5 rounded-2xl border border-brand-200 bg-brand-50 hover:bg-brand-100 px-3 py-3 text-xs font-bold text-brand-700 shadow-xs active:scale-95 transition-all disabled:opacity-50"
            >
              <Bluetooth className="h-4 w-4 text-brand-600" />
              ESC/POS
            </button>
          </div>
          <button
            type="button"
            onClick={handleDone}
            className="w-full flex items-center justify-center gap-1.5 rounded-2xl bg-brand-600 hover:bg-brand-700 text-white py-3 text-xs font-black shadow-md active:scale-95 transition-all"
          >
            New Sale (Space)
          </button>
        </div>
      </div>
    </div>
  );
}
