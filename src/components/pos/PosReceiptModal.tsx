import { useRef, useState } from 'react';
import {
  Printer,
  CheckCircle2,
  X,
  Bluetooth,
} from 'lucide-react';
import type { PosSaleResult, PosSettings } from '@/types/pos';
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

  const sale = saleResult.sale || saleResult;
  const items = saleResult.items || [];
  const payments = saleResult.payments || [];

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
        .line((sale as any).branchName || 'Main Store Branch')
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
        const name = it.product_name || (it as any).name || 'Item';
        const qty = it.quantity;
        const price = it.unit_price ?? (it as any).unitPrice ?? 0;
        const lineTot = it.line_total ?? (it as any).lineTotal ?? (qty * price);
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
          const m = p.payment_method || (p as any).method || 'Payment';
          builder.twoColumn(m.toUpperCase(), formatMwkDetailed(p.amount));
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
    } catch (err: any) {
      alert(`Direct thermal print error: ${err.message}. Falling back to system print.`);
      window.print();
    } finally {
      setIsEscPosPrinting(false);
    }
  };

  const handleDone = () => {
    onClose();
    if (onNewSale) onNewSale();
  };

  const receiptNumber = sale.receipt_number || (sale as any).receiptNumber || sale.id?.slice(0, 8).toUpperCase();
  const branchName = (sale as any).branchName || (sale as any).branch_name || settings?.receipt_header || 'Main Store Branch';
  const cashierName = (sale as any).cashierName || (sale as any).cashier_name || 'Cashier';
  const customerName = (sale as any).customerName || (sale as any).customer_name;
  const createdAt = (sale as any).createdAt || (sale as any).created_at || new Date().toISOString();
  const grossAmount = (sale as any).gross_amount ?? (sale as any).grossAmount ?? (sale as any).total_amount ?? saleResult.subtotal ?? 0;
  const discountAmount = (sale as any).discount_amount ?? (sale as any).discountAmount ?? saleResult.discountAmount ?? 0;
  const netAmount = (sale as any).net_amount ?? (sale as any).netAmount ?? (sale as any).total_amount ?? saleResult.netPayable ?? (grossAmount - discountAmount);
  const totalPaid = (sale as any).total_paid ?? (sale as any).totalPaid ?? (sale as any).amount_paid ?? saleResult.totalPaid ?? netAmount;
  const changeGiven = (sale as any).change_given ?? (sale as any).changeGiven ?? (sale as any).change ?? saleResult.changeGiven ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Modal Top Bar */}
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <h2 className="text-base font-black text-gray-900">Sale Completed</h2>
          </div>
          <button
            type="button"
            onClick={handleDone}
            className="rounded-xl p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

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
                const name = item.product_name || (item as any).name || (item as any).productName || 'Item';
                const qty = item.quantity;
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
                  const m = p.payment_method || (p as any).method;
                  return (
                    <div key={pIdx} className="flex justify-between text-gray-700">
                      <span className="capitalize">{m?.replace('_', ' ')}:</span>
                      <span>{formatMwkDetailed(p.amount)}</span>
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
