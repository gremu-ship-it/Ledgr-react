import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { ArrowLeft, CalendarDays, Check, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { PayRunJournalEntryModal } from './PayRunJournalEntryModal';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';
import { asRows, formatDate, numeric, text } from './employeeUtils';
import { PayRunLinesTable, PayRunSummaryCards } from './payRunComponents';
import { formatPayRunMoney, payRunPostingErrorTranslation } from './payRunUtils';

type Row = Record<string, unknown>;
type Step = 1 | 2 | 3;

function dateOnly(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function monthDefaults(): { start: string; end: string; payDate: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const payDate = new Date(end);
  while (payDate.getDay() === 0 || payDate.getDay() === 6) payDate.setDate(payDate.getDate() - 1);
  return { start: dateOnly(start), end: dateOnly(end), payDate: dateOnly(payDate) };
}

export function PayRunNewPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentBusiness = useAppStore((state) => state.currentBusiness);
  const businessId = currentBusiness?.business?.id ?? '';
  const currency = currentBusiness?.business?.base_currency ?? 'MWK';
  const defaults = monthDefaults();
  const [step, setStep] = useState<Step>(1);
  const [periodStart, setPeriodStart] = useState(defaults.start);
  const [periodEnd, setPeriodEnd] = useState(defaults.end);
  const [payDate, setPayDate] = useState(defaults.payDate);
  const [run, setRun] = useState<Row | null>(null);
  const [formError, setFormError] = useState('');
  const [confirmRecalculate, setConfirmRecalculate] = useState<Row | null>(null);
  const [checkingPeriod, setCheckingPeriod] = useState(false);
  const [journalEntryId, setJournalEntryId] = useState<string | null>(null);
  const [selectedJournalEntryId, setSelectedJournalEntryId] = useState<string | null>(null);
  const [journalEntryNumber, setJournalEntryNumber] = useState('');
  const [postError, setPostError] = useState('');

  const calculateMutation = useMutation({
    mutationFn: async () => {
      const preview = await repos.payrollFullCycle.calculatePayRun(businessId, periodStart, periodEnd, payDate);
      const payRunId = text(preview.payRunId ?? preview.pay_run_id);
      if (!payRunId) throw new Error('Missing pay run id');
      return repos.payrollFullCycle.getPayRun(businessId, payRunId);
    },
    onSuccess: (data) => {
      setRun(data);
      setStep(2);
      setFormError('');
      setConfirmRecalculate(null);
      setPostError('');
      void queryClient.invalidateQueries({ queryKey: ['payroll-pay-runs', businessId] });
    },
    onError: () => setFormError(t('payroll.calculateFailed')),
  });

  const approveMutation = useMutation({
    mutationFn: () => repos.payrollFullCycle.approvePayRun(businessId, text(run?.id)),
    onSuccess: (data) => {
      setRun((previous) => ({ ...(previous ?? {}), ...data }));
      setStep(3);
      setFormError('');
      void queryClient.invalidateQueries({ queryKey: ['payroll-pay-runs', businessId] });
      void queryClient.invalidateQueries({ queryKey: ['payroll-pay-run', businessId, text(run?.id)] });
    },
    onError: () => setFormError(t('payroll.approveFailed')),
  });

  const postMutation = useMutation({
    mutationFn: async () => {
      const response = await repos.payrollFullCycle.postPayRun(text(run?.id));
      const id = text(response.journalEntryId ?? response.journal_entry_id);
      const numberFromResponse = text(response.journalEntryNumber ?? response.journal_entry_number);
      let updated: Row = { ...(run ?? {}), status: 'posted', journal_entry_id: id || run?.journal_entry_id };
      if (run?.id) {
        try { updated = await repos.payrollFullCycle.getPayRun(businessId, text(run.id)); } catch { /* The post RPC is authoritative; keep its successful result visible. */ }
      }
      let entryNumber = numberFromResponse;
      if (id) {
        try {
          const journal = await repos.journal.findByIdWithLines(id);
          entryNumber = text(journal.entry.entry_number, entryNumber);
        } catch { /* A journal link is still available if the summary lookup is temporarily unavailable. */ }
      }
      return { updated, id, entryNumber };
    },
    onSuccess: ({ updated, id, entryNumber }) => {
      setRun(updated);
      setJournalEntryId(id || null);
      setJournalEntryNumber(entryNumber || id);
      setPostError('');
      void queryClient.invalidateQueries({ queryKey: ['payroll-pay-runs', businessId] });
      void queryClient.invalidateQueries({ queryKey: ['payroll-pay-run', businessId, text(updated.id)] });
    },
    onError: (error) => {
      const translated = payRunPostingErrorTranslation(error);
      setPostError(t(translated.key, translated.values));
    },
  });

  async function requestCalculation() {
    setFormError('');
    if (!businessId || !periodStart || !periodEnd || !payDate || periodStart > periodEnd || payDate < periodStart) {
      setFormError(t('payroll.invalidPayPeriod'));
      return;
    }
    setCheckingPeriod(true);
    try {
      const existing = await repos.payrollFullCycle.getPayRunByPeriod(businessId, periodStart, periodEnd);
      if (existing) {
        const existingStatus = text(existing.status);
        if (existingStatus === 'draft' || existingStatus === 'calculated') {
          setConfirmRecalculate(existing);
          return;
        }
        setFormError(t('payroll.periodAlreadyProcessed', { status: t(`payroll.${existingStatus}`, { defaultValue: existingStatus }) }));
        return;
      }
      calculateMutation.mutate();
    } catch {
      setFormError(t('payroll.periodCheckFailed'));
    } finally {
      setCheckingPeriod(false);
    }
  }

  const steps = [t('payroll.selectPeriod'), t('payroll.reviewResults'), t('payroll.confirmAndPost')];
  const lines = asRows(run?.lines);
  const runPeriod = `${formatDate(run?.period_start, i18n.language)} – ${formatDate(run?.period_end, i18n.language)}`;

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button variant="secondary" size="icon" aria-label={t('payroll.backToPayRuns')} onClick={() => navigate('/payroll/pay-runs')}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('payroll.newPayRun')}</h1>
            <p className="mt-1 text-sm text-gray-600">{t('payroll.newPayRunDescription')}</p>
          </div>
        </div>
      </header>

      <nav aria-label={t('payroll.payRunSteps')}>
        <ol className="grid gap-2 sm:grid-cols-3">
          {steps.map((label, index) => {
            const number = index + 1;
            const active = step === number;
            const complete = step > number;
            return (
              <li key={label} className={`flex items-center gap-3 rounded-xl border p-3 ${active ? 'border-brand-300 bg-brand-50' : complete ? 'border-emerald-200 bg-emerald-50' : 'border-gray-200 bg-white'}`}>
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${active ? 'bg-brand-600 text-white' : complete ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
                  {complete ? <Check className="h-4 w-4" aria-hidden="true" /> : number}
                </span>
                <span className={`text-sm font-medium ${active ? 'text-brand-800' : complete ? 'text-emerald-800' : 'text-gray-500'}`}>{label}</span>
              </li>
            );
          })}
        </ol>
      </nav>

      {formError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{formError}</p>}

      {step === 1 && (
        <section className="max-w-3xl rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="mb-5 flex items-center gap-3">
            <span className="rounded-lg bg-brand-50 p-2 text-brand-700"><CalendarDays className="h-5 w-5" aria-hidden="true" /></span>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{t('payroll.selectPayPeriod')}</h2>
              <p className="text-sm text-gray-500">{t('payroll.selectPayPeriodDescription')}</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="space-y-1.5 text-sm font-medium text-gray-700">
              <span>{t('payroll.periodStart')}</span>
              <input type="date" required value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} className="h-10 w-full rounded-lg border border-gray-300 px-3 text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
            </label>
            <label className="space-y-1.5 text-sm font-medium text-gray-700">
              <span>{t('payroll.periodEnd')}</span>
              <input type="date" required min={periodStart} value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} className="h-10 w-full rounded-lg border border-gray-300 px-3 text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
            </label>
            <label className="space-y-1.5 text-sm font-medium text-gray-700">
              <span>{t('payroll.payDate')}</span>
              <input type="date" required min={periodStart} value={payDate} onChange={(event) => setPayDate(event.target.value)} className="h-10 w-full rounded-lg border border-gray-300 px-3 text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
            </label>
          </div>
          <p className="mt-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-800">{t('payroll.functionalCurrencyOnly')}</p>
          <div className="mt-6 flex justify-end">
            <Button onClick={() => void requestCalculation()} isLoading={checkingPeriod || calculateMutation.isPending}>
              {checkingPeriod || calculateMutation.isPending ? t('payroll.calculatingPayRun') : t('payroll.calculatePayRun')}
              {!checkingPeriod && !calculateMutation.isPending && <ChevronRight className="h-4 w-4" aria-hidden="true" />}
            </Button>
          </div>
        </section>
      )}

      {step === 2 && run && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{t('payroll.reviewPayRun')}</h2>
              <p className="mt-1 text-sm text-gray-500">{runPeriod} · {t('payroll.payDate')}: {formatDate(run.pay_date, i18n.language)}</p>
            </div>
            <Button variant="secondary" onClick={() => setStep(1)}>{t('payroll.changePeriod')}</Button>
          </div>
          <PayRunSummaryCards payRun={run} currency={currency} locale={i18n.language} />
          <PayRunLinesTable lines={lines} currency={currency} locale={i18n.language} />
          {numeric(run.employee_count) === 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{t('payroll.noEmployeesIncludedWarning')}</p>}
          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="secondary" onClick={() => setStep(1)}>{t('payroll.previous')}</Button>
            <Button onClick={() => approveMutation.mutate()} isLoading={approveMutation.isPending} disabled={numeric(run.employee_count) === 0}>
              {approveMutation.isPending ? t('payroll.approvingPayRun') : t('payroll.confirmAndApprove')}
              {!approveMutation.isPending && <ChevronRight className="h-4 w-4" aria-hidden="true" />}
            </Button>
          </div>
        </div>
      )}

      {step === 3 && run && (
        <div className="space-y-5">
          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-7">
            <h2 className="text-lg font-semibold text-gray-900">{t('payroll.confirmPosting')}</h2>
            <p className="mt-1 text-sm text-gray-600">{t('payroll.confirmPostingDescription')}</p>
            <div className="mt-5 rounded-xl bg-gray-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">{runPeriod}</p>
                  <p className="mt-1 text-xs text-gray-500">{t('payroll.employeeCount', { count: lines.length })}</p>
                </div>
                <p className="text-xl font-semibold tabular-nums text-gray-900">{formatPayRunMoney(run.total_net, currency, i18n.language)}</p>
              </div>
            </div>
            <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{t('payroll.postingIsFinal')}</p>
            {postError && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{postError}</p>}
            {text(run.status) === 'posted' && (
              <div role="status" className="mt-4 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900">
                <p className="font-semibold">{t('payroll.payRunPosted')}</p>
                <p className="mt-1">{t('payroll.postSuccessWithJournal', { number: journalEntryNumber || text(run.journal_entry_id) })}</p>
                <div className="mt-3 flex flex-wrap gap-3">
                  {journalEntryId && <Button variant="secondary" size="sm" onClick={() => setSelectedJournalEntryId(journalEntryId)}>{t('payroll.viewJournalEntry')}</Button>}
                  <Button size="sm" onClick={() => navigate(`/payroll/pay-runs/${encodeURIComponent(text(run.id))}`)}>{t('payroll.viewPayRun')}</Button>
                </div>
              </div>
            )}
            <div className="mt-6 flex flex-wrap justify-between gap-3">
              <Button variant="secondary" onClick={() => setStep(2)}>{t('payroll.previous')}</Button>
              {text(run.status) !== 'posted' && <Button onClick={() => postMutation.mutate()} isLoading={postMutation.isPending}>
                {postMutation.isPending ? t('payroll.postingPayRun') : t('payroll.postPayRun')}
              </Button>}
            </div>
          </section>
          <PayRunSummaryCards payRun={run} currency={currency} locale={i18n.language} />
          <PayRunLinesTable lines={lines} currency={currency} locale={i18n.language} />
        </div>
      )}

      {confirmRecalculate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/50 p-4" role="presentation">
          <section role="alertdialog" aria-modal="true" aria-labelledby="recalculate-title" className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h2 id="recalculate-title" className="text-lg font-semibold text-gray-900">{t('payroll.existingRunWarningTitle')}</h2>
            <p className="mt-2 text-sm leading-6 text-gray-600">{t('payroll.existingRunWarning', { status: t(`payroll.${text(confirmRecalculate.status)}`, { defaultValue: text(confirmRecalculate.status) }) })}</p>
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setConfirmRecalculate(null)}>{t('payroll.cancel')}</Button>
              <Button onClick={() => calculateMutation.mutate()} isLoading={calculateMutation.isPending}>{t('payroll.recalculatePayRun')}</Button>
            </div>
          </section>
        </div>
      )}

      {selectedJournalEntryId && (
        <PayRunJournalEntryModal entryId={selectedJournalEntryId} onClose={() => setSelectedJournalEntryId(null)} />
      )}
    </main>
  );
}
