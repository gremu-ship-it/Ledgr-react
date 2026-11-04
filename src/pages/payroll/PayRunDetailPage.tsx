import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { ArrowLeft, Printer, RotateCcw, Send, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { PayRunJournalEntryModal } from './PayRunJournalEntryModal';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';
import { asRow, asRows, employeeDisplayName, formatDate, numeric, text } from './employeeUtils';
import { PayRunLinesTable, PayRunStatusBadge, PayRunSummaryCards } from './payRunComponents';
import { formatPayPeriod, formatPayRunMoney, payRunPostingErrorTranslation } from './payRunUtils';

type Row = Record<string, unknown>;

function reversalUnavailable(error: unknown): boolean {
  const detail = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : {};
  const code = String(detail.code ?? '');
  const message = error instanceof Error ? error.message : String(detail.message ?? error ?? '');
  return code === 'PGRST202' || code === '42883' || /reverse_pay_run|function.+does not exist|schema cache|could not find the function/i.test(message);
}

export function PayRunDetailPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const currentBusiness = useAppStore((state) => state.currentBusiness);
  const businessId = currentBusiness?.business?.id ?? '';
  const currency = currentBusiness?.business?.base_currency ?? 'MWK';
  const [confirmReverse, setConfirmReverse] = useState(false);
  const [selectedJournalEntryId, setSelectedJournalEntryId] = useState<string | null>(null);
  const [reverseFeedback, setReverseFeedback] = useState('');
  const [postSuccess, setPostSuccess] = useState<{ entryId: string; entryNumber: string } | null>(null);
  const [postErrorMessage, setPostErrorMessage] = useState('');
  const [reversalEntryId, setReversalEntryId] = useState('');

  const payRunQuery = useQuery({
    queryKey: ['payroll-pay-run', businessId, id],
    enabled: Boolean(businessId && id),
    queryFn: () => repos.payrollFullCycle.getPayRun(businessId, id),
  });

  const run = payRunQuery.data;
  const status = text(run?.status, 'draft');
  const lines = asRows(run?.lines);

  const recalculateMutation = useMutation({
    mutationFn: () => repos.payrollFullCycle.calculatePayRun(
      businessId,
      text(run?.period_start),
      text(run?.period_end),
      text(run?.pay_date),
    ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['payroll-pay-run', businessId, id] });
      void queryClient.invalidateQueries({ queryKey: ['payroll-pay-runs', businessId] });
    },
  });

  const approveMutation = useMutation({
    mutationFn: () => repos.payrollFullCycle.approvePayRun(businessId, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['payroll-pay-run', businessId, id] });
      void queryClient.invalidateQueries({ queryKey: ['payroll-pay-runs', businessId] });
    },
  });

  const postMutation = useMutation({
    mutationFn: async () => {
      const response = await repos.payrollFullCycle.postPayRun(id);
      const entryId = text(response.journalEntryId ?? response.journal_entry_id);
      let entryNumber = text(response.journalEntryNumber ?? response.journal_entry_number);
      if (entryId) {
        try {
          const journal = await repos.journal.findByIdWithLines(entryId);
          entryNumber = text(journal.entry.entry_number, entryNumber);
        } catch { /* Posting remains successful if the optional journal-number lookup fails. */ }
      }
      return { entryId, entryNumber };
    },
    onSuccess: (result) => {
      setPostSuccess({ entryId: result.entryId, entryNumber: result.entryNumber || result.entryId });
      setPostErrorMessage('');
      void queryClient.invalidateQueries({ queryKey: ['payroll-pay-run', businessId, id] });
      void queryClient.invalidateQueries({ queryKey: ['payroll-pay-runs', businessId] });
    },
    onError: (error) => {
      const translated = payRunPostingErrorTranslation(error);
      setPostErrorMessage(t(translated.key, translated.values));
    },
  });

  const reverseMutation = useMutation({
    mutationFn: () => repos.payrollFullCycle.reversePayRun(id),
    onSuccess: (result) => {
      const entryId = text(result.reversalJournalEntryId ?? result.reversal_journal_entry_id ?? result.journalEntryId);
      setReversalEntryId(entryId);
      setReverseFeedback(t('payroll.reverseSuccess'));
      setConfirmReverse(false);
      void queryClient.invalidateQueries({ queryKey: ['payroll-pay-run', businessId, id] });
      void queryClient.invalidateQueries({ queryKey: ['payroll-pay-runs', businessId] });
    },
    onError: (error) => {
      setReverseFeedback(t(reversalUnavailable(error) ? 'payroll.reverseNotAvailable' : 'payroll.reverseFailed'));
      setConfirmReverse(false);
    },
  });

  const reversalEntry = reversalEntryId
    || text(run?.reversal_journal_entry_id ?? run?.reversal_entry_id ?? run?.reversalJournalEntryId);
  const originalJournalId = text(run?.journal_entry_id);
  const showReversalEntry = () => {
    if (reversalEntry) setSelectedJournalEntryId(reversalEntry);
    else setReverseFeedback(t('payroll.reversalEntryUnavailable'));
  };

  if (payRunQuery.isPending) {
    return <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6"><TableSkeleton rows={6} /></main>;
  }
  if (payRunQuery.isError || !run) {
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
        <Button variant="secondary" onClick={() => navigate('/payroll/pay-runs')}><ArrowLeft className="h-4 w-4" aria-hidden="true" />{t('payroll.backToPayRuns')}</Button>
        <section className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <h1 className="text-xl font-semibold text-gray-900">{t('payroll.payRunNotFound')}</h1>
          <p className="mt-2 text-sm text-gray-600">{t('payroll.payRunLoadFailed')}</p>
        </section>
      </main>
    );
  }

  const canApprove = status === 'calculated';
  const printRun = () => window.print();
  const payslipLines = lines;

  return (
    <>
      <main className="no-print mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Button variant="secondary" size="icon" aria-label={t('payroll.backToPayRuns')} onClick={() => navigate('/payroll/pay-runs')}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-bold text-gray-900">{t('payroll.payRunForPeriod', { period: formatPayPeriod(run.period_start, i18n.language) })}</h1>
                <PayRunStatusBadge status={status} />
              </div>
              <p className="mt-1 text-sm text-gray-600">{formatDate(run.period_start, i18n.language)} – {formatDate(run.period_end, i18n.language)} · {t('payroll.payDate')}: {formatDate(run.pay_date, i18n.language)}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {(status === 'draft' || status === 'calculated') && (
              <Button variant="secondary" onClick={() => recalculateMutation.mutate()} isLoading={recalculateMutation.isPending}>
                {recalculateMutation.isPending ? t('payroll.recalculatingPayRun') : t('payroll.recalculatePayRun')}
              </Button>
            )}
            {(status === 'draft' || status === 'calculated') && (
              <Button onClick={() => approveMutation.mutate()} isLoading={approveMutation.isPending} disabled={!canApprove}>
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                {approveMutation.isPending ? t('payroll.approvingPayRun') : t('payroll.approvePayRun')}
              </Button>
            )}
            {status === 'approved' && (
              <Button onClick={() => postMutation.mutate()} isLoading={postMutation.isPending}>
                <Send className="h-4 w-4" aria-hidden="true" />
                {postMutation.isPending ? t('payroll.postingPayRun') : t('payroll.postPayRun')}
              </Button>
            )}
            {status === 'posted' && (
              <>
                <Button variant="secondary" onClick={printRun}><Printer className="h-4 w-4" aria-hidden="true" />{t('payroll.printPayslips')}</Button>
                {originalJournalId && <Button variant="secondary" onClick={() => setSelectedJournalEntryId(originalJournalId)}>{t('payroll.viewJournalEntry')}</Button>}
                <Button variant="destructive" onClick={() => { setReverseFeedback(''); setConfirmReverse(true); }}>
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />{t('payroll.reversePayRun')}
                </Button>
              </>
            )}
            {status === 'reversed' && (
              <Button variant="secondary" onClick={showReversalEntry}>{t('payroll.viewReversalEntry')}</Button>
            )}
          </div>
        </header>

        {status === 'draft' && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{t('payroll.approveRequiresCalculation')}</p>}
        {recalculateMutation.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{t('payroll.calculateFailed')}</p>}
        {approveMutation.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{t('payroll.approveFailed')}</p>}
        {postMutation.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{postErrorMessage || t('payroll.postFailed')}</p>}
        {postSuccess && (
          <div role="status" className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900">
            <p className="font-semibold">{t('payroll.payRunPosted')}</p>
            <p className="mt-1">{t('payroll.postSuccessWithJournal', { number: postSuccess.entryNumber })}</p>
            {postSuccess.entryId && <Button variant="secondary" size="sm" className="mt-3" onClick={() => setSelectedJournalEntryId(postSuccess.entryId)}>{t('payroll.viewJournalEntry')}</Button>}
          </div>
        )}
        {reverseFeedback && <p role="status" className={`rounded-lg p-3 text-sm ${reverseFeedback === t('payroll.reverseSuccess') ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}>{reverseFeedback}</p>}

        <PayRunSummaryCards payRun={run} currency={currency} locale={i18n.language} />
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{t('payroll.employeeBreakdown')}</h2>
            <p className="mt-1 text-sm text-gray-500">{t('payroll.employeeBreakdownDescription')}</p>
          </div>
          <PayRunLinesTable lines={lines} currency={currency} locale={i18n.language} />
        </section>
      </main>

      <section id="pay-run-print-view" className="print-only" aria-label={t('payroll.printablePayslips')}>
        {payslipLines.map((line, index) => {
          const employee = asRow(line.employee);
          const components = asRows(line.components);
          const earnings = components.filter((component) => component.is_earning === true);
          const deductions = components.filter((component) => component.is_earning !== true);
          const name = employeeDisplayName(employee) || text(employee.employee_number, t('payroll.employee'));
          const componentName = (component: Row) => {
            const payComponent = asRow(component.pay_component);
            return text(payComponent.name, text(payComponent.code, t('payroll.unnamedComponent')));
          };
          return (
            <article key={text(line.id, `${text(line.employee_id)}-${index}`)} className="payslip-page mx-auto max-w-3xl p-8 text-gray-900">
              <header className="border-b-2 border-gray-900 pb-5">
                <p className="text-sm font-semibold uppercase tracking-widest text-gray-500">{t('payroll.payslip')}</p>
                <h1 className="mt-2 text-2xl font-bold">{text(currentBusiness?.business?.name, t('payroll.companyName'))}</h1>
                <p className="mt-1 text-sm">{formatPayPeriod(run.period_start, i18n.language)} · {formatDate(run.period_start, i18n.language)} – {formatDate(run.period_end, i18n.language)}</p>
              </header>
              <div className="grid grid-cols-2 gap-4 border-b border-gray-300 py-5 text-sm">
                <div><p className="text-gray-500">{t('payroll.employee')}</p><p className="mt-1 font-semibold">{name}</p></div>
                <div><p className="text-gray-500">{t('payroll.employeeNumber')}</p><p className="mt-1 font-semibold">{text(employee.employee_number, '—')}</p></div>
                <div><p className="text-gray-500">{t('payroll.payDate')}</p><p className="mt-1 font-semibold">{formatDate(run.pay_date, i18n.language)}</p></div>
                <div><p className="text-gray-500">{t('payroll.daysWorked')}</p><p className="mt-1 font-semibold">{numeric(line.days_worked)}</p></div>
              </div>
              <div className="space-y-6 py-5">
                <PayslipComponents title={t('payroll.earnings')} items={earnings} nameFor={componentName} currency={currency} locale={i18n.language} noItems={t('payroll.noComponentDetails')} />
                <PayslipComponents title={t('payroll.deductions')} items={deductions} nameFor={componentName} currency={currency} locale={i18n.language} noItems={t('payroll.noComponentDetails')} />
              </div>
              <dl className="ml-auto max-w-sm space-y-2 border-t border-gray-300 pt-4 text-sm">
                <div className="flex justify-between"><dt>{t('payroll.grossPay')}</dt><dd>{formatPayRunMoney(line.gross_pay, currency, i18n.language)}</dd></div>
                <div className="flex justify-between"><dt>{t('payroll.totalDeductions')}</dt><dd>{formatPayRunMoney(line.total_deductions, currency, i18n.language)}</dd></div>
                <div className="flex justify-between border-t border-gray-400 pt-2 text-base font-bold"><dt>{t('payroll.netPay')}</dt><dd>{formatPayRunMoney(line.net_pay, currency, i18n.language)}</dd></div>
              </dl>
              <p className="mt-10 border-t border-gray-200 pt-3 text-xs text-gray-500">{t('payroll.payslipFooter')}</p>
            </article>
          );
        })}
      </section>

      <style>{`\n        .print-only { display: none; }\n        @media print {\n          @page { margin: 14mm; }\n          body * { visibility: hidden !important; }\n          .no-print { display: none !important; }\n          .print-only, .print-only * { visibility: visible !important; }\n          .print-only { display: block !important; position: absolute; inset: 0; width: 100%; max-width: none; margin: 0; background: white; }\n          .payslip-page { break-after: page; page-break-after: always; }\n          .payslip-page:last-child { break-after: auto; page-break-after: auto; }\n        }\n      `}</style>

      {confirmReverse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/50 p-4" role="presentation">
          <section role="alertdialog" aria-modal="true" aria-labelledby="reverse-title" className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h2 id="reverse-title" className="text-lg font-semibold text-gray-900">{t('payroll.reverseConfirmationTitle')}</h2>
            <p className="mt-2 text-sm leading-6 text-gray-600">{t('payroll.reverseConfirmationDescription')}</p>
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setConfirmReverse(false)}>{t('payroll.cancel')}</Button>
              <Button variant="destructive" onClick={() => reverseMutation.mutate()} isLoading={reverseMutation.isPending}>{t('payroll.confirmReverse')}</Button>
            </div>
          </section>
        </div>
      )}

      {selectedJournalEntryId && <PayRunJournalEntryModal entryId={selectedJournalEntryId} onClose={() => setSelectedJournalEntryId(null)} />}
    </>
  );
}

function PayslipComponents({
  title,
  items,
  nameFor,
  currency,
  locale,
  noItems,
}: {
  title: string;
  items: Row[];
  nameFor: (component: Row) => string;
  currency: string;
  locale: string;
  noItems: string;
}) {
  return (
    <section>
      <h2 className="mb-2 border-b border-gray-300 pb-2 text-sm font-bold uppercase tracking-wide">{title}</h2>
      {items.length ? <ul className="space-y-2 text-sm">
        {items.map((item, index) => <li key={text(item.id, `${title}-${index}`)} className="flex justify-between gap-4"><span>{nameFor(item)}</span><span>{formatPayRunMoney(item.amount, currency, locale)}</span></li>)}
      </ul> : <p className="text-sm text-gray-500">{noItems}</p>}
    </section>
  );
}
