import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertCircle, FileSpreadsheet, LoaderCircle, Mail, Printer, RotateCcw, X } from 'lucide-react';
import { repos } from '@/lib/repositories';
import type { PosShift } from '@/types/pos';
import { generateZReportSummary, type PosShiftReportPayload } from '@/services/posReportService';
import { formatMwkDetailed } from '@/lib/formatters';

interface PosZReportModalProps {
  open: boolean;
  onClose: () => void;
  shift: PosShift | null;
  businessName?: string;
  branchName?: string;
}

function LoadingSkeleton({ label }: { label: string }) {
  return (
    <div aria-label={label} className="space-y-3 py-4">
      <div className="mx-auto h-4 w-40 animate-pulse rounded bg-gray-200" />
      <div className="h-20 animate-pulse rounded-xl bg-gray-100" />
      <div className="h-32 animate-pulse rounded-xl bg-gray-100" />
      <div className="h-28 animate-pulse rounded-xl bg-gray-100" />
    </div>
  );
}

export function PosZReportModal({
  open,
  onClose,
  shift,
  businessName,
  branchName,
}: PosZReportModalProps) {
  const { t } = useTranslation();
  const printRef = useRef<HTMLDivElement>(null);
  const shiftId = shift?.id;
  const reportQuery = useQuery({
    queryKey: ['pos', 'shift-report', shiftId],
    queryFn: async () => {
      const report = await repos.pos.getShiftReport(shiftId!);
      if (!report || report.shift_id !== shiftId) {
        throw new Error('A complete server shift report was not returned.');
      }
      return report as unknown as PosShiftReportPayload;
    },
    enabled: open && Boolean(shiftId),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  if (!open || !shift) return null;

  const handlePrint = () => window.print();
  const displayBusinessName = businessName || t('app.name');
  const displayBranchName = branchName || t('pos.defaultBranch');
  const summary = reportQuery.data
    ? generateZReportSummary(shift, reportQuery.data, displayBusinessName, displayBranchName)
    : null;
  const amount = (value: number | null | undefined) => value == null
    ? t('pos.zReport.notAvailable')
    : formatMwkDetailed(value);
  const dateTime = (value: string | null | undefined) => value
    ? new Date(value).toLocaleString()
    : t('pos.zReport.notAvailable');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-brand-600" />
            <h2 className="text-base font-black text-gray-900">{t('pos.zReport.title')}</h2>
          </div>
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={onClose}
            className="rounded-xl p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-4">
          {reportQuery.isLoading ? (
            <LoadingSkeleton label={t('pos.zReport.loading')} />
          ) : reportQuery.isError || !summary ? (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="font-bold">{t('pos.zReport.loadError')}</p>
                  <p className="mt-1 text-xs">{t('pos.zReport.noFallback')}</p>
                  <button
                    type="button"
                    onClick={() => void reportQuery.refetch()}
                    className="mt-3 inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-3 py-2 text-xs font-bold hover:bg-red-50"
                  >
                    {reportQuery.isFetching ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                    {t('common.retry')}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div
              ref={printRef}
              className="space-y-4 rounded-2xl border border-dashed border-gray-300 bg-gray-50/60 p-5 font-mono text-xs"
            >
              <div className="space-y-0.5 text-center">
                <h3 className="text-sm font-black uppercase">{displayBusinessName}</h3>
                <p className="text-[11px] text-gray-600">{displayBranchName}</p>
                <p className="pt-1 text-xs font-bold uppercase tracking-wider text-brand-700">{t('pos.zReport.endOfShift')}</p>
                <p className="text-[10px] text-gray-400">{t('pos.zReport.reportNumber', { number: summary.reportNumber })}</p>
              </div>

              <Divider />
              <section aria-label={t('pos.zReport.shiftDetails')} className="space-y-1 text-[11px] text-gray-600">
                <ReportRow label={t('pos.zReport.shiftNumber')} value={summary.shiftNumber} />
                <ReportRow label={t('pos.zReport.cashier')} value={summary.cashierName} />
                <ReportRow label={t('pos.zReport.shiftOpened')} value={dateTime(reportQuery.data?.opened_at ?? shift.opened_at)} />
                <ReportRow label={t('pos.zReport.shiftClosed')} value={dateTime(reportQuery.data?.close?.closed_at ?? reportQuery.data?.closed_at ?? shift.closed_at)} />
                <ReportRow label={t('pos.zReport.orders')} value={summary.transactionsCount == null ? t('pos.zReport.notAvailable') : String(summary.transactionsCount)} />
              </section>

              <Divider />
              <section aria-label={t('pos.zReport.salesSummary')} className="space-y-1.5 text-[11px]">
                <p className="font-bold text-[10px] uppercase text-gray-500">{t('pos.zReport.salesSummary')}</p>
                <ReportRow label={t('pos.zReport.grossSales')} value={amount(summary.grossSales)} />
                <ReportRow label={t('pos.zReport.totalDiscounts')} value={amount(summary.discountsTotal)} className="text-emerald-700" />
                <ReportRow label={t('pos.zReport.netSales')} value={amount(summary.netSales)} className="border-t border-gray-200 pt-1 font-black text-gray-900" />
                <ReportRow label={t('pos.zReport.taxCollected')} value={amount(summary.taxTotal)} />
                <ReportRow label={t('pos.zReport.refunds', { count: summary.returnCount ?? '—' })} value={amount(summary.refundsTotal)} className="text-red-700" />
                <div className="space-y-1 border-t border-gray-200 pt-2">
                  <p className="font-bold text-[10px] uppercase text-gray-500">{t('pos.zReport.taxBreakdown')}</p>
                  {Object.entries(summary.taxBreakdown).length === 0 ? (
                    <p className="text-gray-500">{t('pos.zReport.noTaxLines')}</p>
                  ) : Object.entries(summary.taxBreakdown).map(([taxName, detail]) => (
                    <ReportRow key={taxName} label={taxName} value={amount(detail.amount == null ? null : Number(detail.amount))} />
                  ))}
                </div>
              </section>

              <Divider />
              <section aria-label={t('pos.zReport.paymentBreakdown')} className="space-y-1.5 text-[11px]">
                <p className="font-bold text-[10px] uppercase text-gray-500">{t('pos.zReport.paymentBreakdown')}</p>
                {Object.keys(summary.paymentBreakdown).length === 0 ? (
                  <p className="text-gray-500">{t('pos.zReport.noPaymentLines')}</p>
                ) : Object.entries(summary.paymentBreakdown).map(([method, detail]) => (
                  <ReportRow
                    key={method}
                    label={t(`pos.paymentMethods.${method}`, { defaultValue: method })}
                    value={`${detail.count ?? '—'} · ${amount(detail.total)}`}
                  />
                ))}
              </section>

              <Divider />
              <section aria-label={t('pos.zReport.drawerReconciliation')} className="space-y-1.5 text-[11px]">
                <p className="font-bold text-[10px] uppercase text-gray-500">{t('pos.zReport.drawerReconciliation')}</p>
                <ReportRow label={t('pos.zReport.openingFloat')} value={amount(summary.openingFloat)} />
                <ReportRow label={t('pos.zReport.cashIn')} value={amount(summary.cashInTotal)} />
                <ReportRow label={t('pos.zReport.cashOut')} value={amount(summary.cashOutTotal)} />
                <ReportRow label={t('pos.zReport.expectedCash')} value={amount(summary.expectedCashInDrawer)} className="border-t border-gray-200 pt-1 font-bold" />
                <ReportRow label={t('pos.zReport.actualCash')} value={amount(summary.actualCountedCash)} className="font-bold" />
                <ReportRow
                  label={t('pos.zReport.variance')}
                  value={summary.cashVariance == null
                    ? t('pos.zReport.notAvailable')
                    : `${summary.cashVariance > 0 ? '+' : ''}${amount(summary.cashVariance)} (${t(`pos.zReport.varianceStatus.${summary.varianceStatus}`)})`}
                  className={`border-t border-gray-300 pt-1 font-black ${summary.varianceStatus === 'balanced' ? 'text-emerald-700' : summary.varianceStatus === 'surplus' ? 'text-blue-700' : summary.varianceStatus === 'shortage' ? 'text-red-700' : 'text-gray-500'}`}
                />
              </section>

              <Divider />
              <section aria-label={t('pos.zReport.cashMovements')} className="space-y-1.5 text-[11px]">
                <p className="font-bold text-[10px] uppercase text-gray-500">{t('pos.zReport.cashMovements')}</p>
                {summary.cashMovements.length === 0 ? (
                  <p className="text-gray-500">{t('pos.zReport.noCashMovements')}</p>
                ) : summary.cashMovements.map((movement, index) => (
                  <ReportRow
                    key={`${movement.created_at}-${index}`}
                    label={`${t(`pos.zReport.movementTypes.${movement.movement_type}`, { defaultValue: movement.movement_type })} · ${movement.reason}`}
                    value={formatMwkDetailed(Number(movement.amount))}
                  />
                ))}
              </section>
            </div>
          )}
        </div>

        <div className="space-y-3 border-t border-gray-100 pt-3">
          <p data-testid="zreport-email-unavailable" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{t('pos.zReport.emailUnavailable')}</span>
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!summary}
              onClick={handlePrint}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-2xl border border-gray-200 bg-white py-3 text-xs font-bold text-gray-800 shadow-xs transition-all hover:bg-gray-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Printer className="h-4 w-4 text-gray-600" />
              {t('pos.zReport.print')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-2xl bg-brand-600 py-3 text-xs font-black text-white shadow-md transition-all hover:bg-brand-700 active:scale-95"
            >
              {t('common.done')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-dashed border-gray-300" />;
}

function ReportRow({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return <div className={`flex justify-between gap-4 ${className}`}><span>{label}</span><span className="text-right font-bold">{value}</span></div>;
}
