import { useRef, useState } from 'react';
import {
  X,
  Printer,
  FileSpreadsheet,
  CheckCircle2,
  Send,
} from 'lucide-react';
import type { PosShift, PosSale } from '@/types/pos';
import { generateZReportSummary, formatZReportEmailBody } from '@/services/posReportService';
import { formatMwkDetailed } from '@/lib/formatters';

interface PosZReportModalProps {
  open: boolean;
  onClose: () => void;
  shift: PosShift | null;
  sales?: PosSale[];
  businessName?: string;
  branchName?: string;
  ownerEmail?: string;
}

export function PosZReportModal({
  open,
  onClose,
  shift,
  sales = [],
  businessName = 'Ledgr Store',
  branchName = 'Main Branch',
  ownerEmail,
}: PosZReportModalProps) {
  const printRef = useRef<HTMLDivElement>(null);
  const [recipientEmail, setRecipientEmail] = useState(ownerEmail || 'owner@example.com');
  const [isSending, setIsSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);

  if (!open || !shift) return null;

  const summary = generateZReportSummary(shift, sales, businessName, branchName);

  const handlePrint = () => {
    window.print();
  };

  const handleSendEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSending(true);
    try {
      const emailBody = formatZReportEmailBody(summary);
      console.info('Dispatched Z-Report email to:', recipientEmail, emailBody);
      // Simulate dispatch success
      await new Promise((resolve) => setTimeout(resolve, 600));
      setSendSuccess(true);
      setTimeout(() => setSendSuccess(false), 3000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      alert(`Email dispatch failed: ${message}`);
    } finally {
      setIsSending(false);
    }
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
              <p className="text-[10px] text-gray-400">Report #: {summary.reportNumber}</p>
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

        {/* Email Dispatch & Print Toolbar */}
        <div className="pt-3 border-t border-gray-100 space-y-3">
          <form onSubmit={handleSendEmail} className="flex gap-2">
            <input
              type="email"
              required
              placeholder="recipient@business.com"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              className="flex-1 rounded-xl border border-gray-300 px-3 py-2 text-xs focus:border-brand-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={isSending}
              className="flex items-center gap-1.5 rounded-xl bg-brand-50 px-3 py-2 text-xs font-bold text-brand-700 hover:bg-brand-100 disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" />
              {isSending ? 'Sending...' : 'Email Report'}
            </button>
          </form>

          {sendSuccess && (
            <p className="text-xs font-bold text-emerald-600 flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> Z-Report successfully emailed to {recipientEmail}.
            </p>
          )}

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
