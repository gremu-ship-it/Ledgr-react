import { useRef } from 'react';
import {
  X,
  Printer,
  FileSpreadsheet,
  Mail,
} from 'lucide-react';
import type { PosShift, PosSale } from '@/types/pos';
import { generateZReportSummary } from '@/services/posReportService';
import { formatMwkDetailed } from '@/lib/formatters';

interface PosZReportModalProps {
  open: boolean;
  onClose: () => void;
  shift: PosShift | null;
  sales?: PosSale[];
  businessName?: string;
  branchName?: string;
  ownerEmail?: string;
  /** Immutable report number minted by the signed close (R08); preferred over any client-side value. */
  serverReportNumber?: string | null;
}

export function PosZReportModal({
  open,
  onClose,
  shift,
  sales = [],
  businessName = 'Ledgr Store',
  branchName = 'Main Branch',
  serverReportNumber,
}: PosZReportModalProps) {
  const printRef = useRef<HTMLDivElement>(null);

  if (!open || !shift) return null;

  const summary = generateZReportSummary(shift, sales, businessName, branchName);
  // The signed close mints the sequential Z number; a client-side frame is
  // only a rendering fallback when the server value is unavailable.
  const reportNumber = serverReportNumber ?? summary.reportNumber;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-brand-600" />
            <h2 className="text-base font-black text-gray-900">End-of-Day Z-Report & Audit</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Printable Z-Report Body */}
        <div className="flex-1 overflow-y-auto py-4">
          <div
            ref={printRef}
            className="rounded-2xl border border-dashed border-gray-300 bg-gray-50/60 p-5 font-mono text-xs space-y-4"
          >
            {/* Store details */}
            <div className="text-center space-y-0.5">
              <h3 className="font-black text-sm uppercase">{summary.businessName}</h3>
              <p className="text-[11px] text-gray-600">{summary.branchName}</p>
              <p className="font-bold text-xs pt-1 uppercase tracking-wider text-brand-700">
                *** END OF SHIFT Z-REPORT ***
              </p>
              <p className="text-[10px] text-gray-400">Report #: {reportNumber}</p>
            </div>

            <div className="border-t border-dashed border-gray-300 my-2" />

            {/* Meta */}
            <div className="space-y-1 text-[11px] text-gray-600">
              <div className="flex justify-between">
                <span>Cashier:</span>
                <span className="font-bold text-gray-900">{summary.cashierName}</span>
              </div>
              <div className="flex justify-between">
                <span>Shift Opened:</span>
                <span>{new Date(summary.shift.opened_at).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Shift Closed:</span>
                <span>
                  {summary.shift.closed_at
                    ? new Date(summary.shift.closed_at).toLocaleString()
                    : 'Active'}
                </span>
              </div>
            </div>

            <div className="border-t border-dashed border-gray-300 my-2" />

            {/* Financial Performance */}
            <div className="space-y-1.5 text-[11px]">
              <span className="font-bold uppercase text-[10px] text-gray-500">Sales Summary</span>
              <div className="flex justify-between">
                <span>Gross Sales:</span>
                <span>{formatMwkDetailed(summary.grossSales)}</span>
              </div>
              <div className="flex justify-between text-emerald-700">
                <span>Total Discounts:</span>
                <span>-{formatMwkDetailed(summary.discountsTotal)}</span>
              </div>
              <div className="flex justify-between font-black text-xs text-gray-900 pt-1 border-t border-gray-200">
                <span>Net Sales Revenue:</span>
                <span>{formatMwkDetailed(summary.netSales)}</span>
              </div>
              {summary.taxTotal > 0 && (
                <div className="flex justify-between text-gray-500">
                  <span>VAT / Tax Collected:</span>
                  <span>{formatMwkDetailed(summary.taxTotal)}</span>
                </div>
              )}
              {summary.refundsTotal > 0 && (
                <div className="flex justify-between text-red-700">
                  <span>Customer Refunds:</span>
                  <span>-{formatMwkDetailed(summary.refundsTotal)}</span>
                </div>
              )}
            </div>

            <div className="border-t border-dashed border-gray-300 my-2" />

            {/* Cash Reconciliation */}
            <div className="space-y-1.5 text-[11px]">
              <span className="font-bold uppercase text-[10px] text-gray-500">
                Drawer Reconciliation
              </span>
              <div className="flex justify-between">
                <span>Opening Float:</span>
                <span>{formatMwkDetailed(summary.openingFloat)}</span>
              </div>
              <div className="flex justify-between">
                <span>Cash In (Top-ups):</span>
                <span>+{formatMwkDetailed(summary.cashInTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>Cash Out (Drops):</span>
                <span>-{formatMwkDetailed(summary.cashOutTotal)}</span>
              </div>
              <div className="flex justify-between font-bold pt-1 border-t border-gray-200">
                <span>Expected in Drawer:</span>
                <span>{formatMwkDetailed(summary.expectedCashInDrawer)}</span>
              </div>
              <div className="flex justify-between font-bold">
                <span>Actual Counted Cash:</span>
                <span>{formatMwkDetailed(summary.actualCountedCash)}</span>
              </div>
              <div
                className={`flex justify-between font-black text-xs pt-1 border-t border-gray-300 ${
                  summary.varianceStatus === 'balanced'
                    ? 'text-emerald-700'
                    : summary.varianceStatus === 'surplus'
                    ? 'text-blue-700'
                    : 'text-red-700'
                }`}
              >
                <span>Reconciliation Variance:</span>
                <span>
                  {summary.cashVariance > 0 ? '+' : ''}
                  {formatMwkDetailed(summary.cashVariance)} ({summary.varianceStatus.toUpperCase()})
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Email state (honest) & Print Toolbar */}
        <div className="pt-3 border-t border-gray-100 space-y-3">
          <p
            data-testid="zreport-email-unavailable"
            className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800"
          >
            <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Z-Report email dispatch is not available in this build — delivery has not been
              implemented and arrives with the upcoming R14 package. Nothing was sent. Use Print
              below to export the report.
            </span>
          </p>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-2xl border border-gray-200 bg-white hover:bg-gray-50 py-3 text-xs font-bold text-gray-800 shadow-xs active:scale-95 transition-all"
            >
              <Printer className="h-4 w-4 text-gray-600" />
              Print Z-Report
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-2xl bg-brand-600 hover:bg-brand-700 text-white py-3 text-xs font-black shadow-md active:scale-95 transition-all"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
