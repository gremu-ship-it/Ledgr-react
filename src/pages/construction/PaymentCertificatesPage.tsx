import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarDays, FileCheck2, Plus, ReceiptText } from 'lucide-react';
import type { Project, ProjectValuationDocument } from '@/dal/repositories/ProjectRepository';
import type { PaymentCertificate, PaymentCertificateStatus } from '@/dal/repositories/ConstructionCertificatesRepository';
import { repos } from '@/lib/repositories';
import { formatMoney } from '@/lib/construction/constructionWorkspaceView';
import { useAppStore } from '@/store/useAppStore';

const k = 'construction.certificates';
const EMPTY_CERTIFICATES: PaymentCertificate[] = [];

const statusClasses: Record<PaymentCertificateStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  issued: 'bg-violet-100 text-violet-800',
  paid: 'bg-emerald-100 text-emerald-800',
  partially_paid: 'bg-blue-100 text-blue-800',
  cancelled: 'bg-red-100 text-red-800',
};

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function allProjects(businessId: string): Promise<Project[]> {
  const projects: Project[] = [];
  for (let page = 0; page < 100; page += 1) {
    const result = await repos.projects.list(businessId, { page });
    projects.push(...result.rows);
    if (projects.length >= result.count) break;
  }
  return projects;
}

function effectiveRetentionPercent(document: ProjectValuationDocument): number {
  const gross = Number(document.valuation.gross_amount ?? 0);
  if (gross <= 0) return 0;
  return Math.round((Number(document.valuation.retention_amount ?? 0) / gross) * 10000) / 100;
}

export function PaymentCertificatesPage() {
  const { t } = useTranslation();
  const cache = useQueryClient();
  const currentBusiness = useAppStore((state) => state.currentBusiness);
  const businessId = currentBusiness?.business?.id ?? null;
  const currency = currentBusiness?.business?.base_currency ?? 'MWK';
  const [projectId, setProjectId] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedValuationId, setSelectedValuationId] = useState('');
  const [retentionPercentage, setRetentionPercentage] = useState('0');
  const [advanceRecovery, setAdvanceRecovery] = useState('0');
  const [penaltyDeductions, setPenaltyDeductions] = useState('0');
  const [otherDeductions, setOtherDeductions] = useState('0');
  const [dueDateInputs, setDueDateInputs] = useState<Record<string, string>>({});
  const [paymentInputs, setPaymentInputs] = useState<Record<string, string>>({});
  const [errorKey, setErrorKey] = useState('');

  const projectsQuery = useQuery({
    queryKey: ['construction', 'certificate-projects', businessId],
    queryFn: () => allProjects(businessId as string),
    enabled: Boolean(businessId),
  });
  const project = projectsQuery.data?.find((row) => row.id === projectId) ?? null;
  const certificatesQuery = useQuery({
    queryKey: ['construction', 'payment-certificates', businessId, projectId],
    queryFn: () => repos.certificates.list(businessId as string, projectId),
    enabled: Boolean(businessId && projectId),
  });
  const valuationHistoryQuery = useQuery({
    queryKey: ['construction', 'valuation-history', projectId],
    queryFn: () => repos.projects.getValuationHistory(projectId),
    enabled: Boolean(projectId),
  });
  const retentionSummaryQuery = useQuery({
    queryKey: ['construction', 'retention-summary', projectId],
    queryFn: () => repos.projects.getRetentionSummary(projectId),
    enabled: Boolean(projectId),
  });

  const certificates = certificatesQuery.data ?? EMPTY_CERTIFICATES;
  const valuationDocuments = valuationHistoryQuery.data?.valuations ?? [];
  const activeCertificateValuations = useMemo(
    () => new Set(certificates.filter((row) => row.status !== 'cancelled').map((row) => row.valuation_id)),
    [certificates],
  );
  const eligibleValuations = valuationDocuments.filter(({ valuation }) =>
    ['submitted', 'invoiced'].includes(valuation.status)
      && Number(valuation.gross_amount) > 0
      && !activeCertificateValuations.has(valuation.id),
  );
  const selectedValuation = valuationDocuments.find(({ valuation }) => valuation.id === selectedValuationId) ?? null;
  const grossPreview = Number(selectedValuation?.valuation.gross_amount ?? 0);
  const retentionPreview = selectedValuation
    ? Math.round((grossPreview * (Number(retentionPercentage) || 0) / 100) * 100) / 100
    : 0;
  const netPreview = Math.round((grossPreview - retentionPreview - Number(advanceRecovery || 0)
    - Number(penaltyDeductions || 0) - Number(otherDeductions || 0)) * 100) / 100;

  const refresh = () => {
    void cache.invalidateQueries({ queryKey: ['construction', 'payment-certificates', businessId, projectId] });
    void cache.invalidateQueries({ queryKey: ['construction', 'valuation-history', projectId] });
    void cache.invalidateQueries({ queryKey: ['construction', 'retention-summary', projectId] });
  };
  const createMutation = useMutation({
    mutationFn: () => repos.certificates.create({
      valuationId: selectedValuationId,
      retentionPercentage: Number(retentionPercentage),
      advanceRecovery: Number(advanceRecovery),
      penaltyDeductions: Number(penaltyDeductions),
      otherDeductions: Number(otherDeductions),
    }),
    onSuccess: () => {
      setShowCreate(false);
      setSelectedValuationId('');
      setErrorKey('');
      refresh();
    },
    onError: () => setErrorKey(`${k}.errors.createFailed`),
  });
  const issueMutation = useMutation({
    mutationFn: ({ id, dueDate }: { id: string; dueDate: string | null }) => repos.certificates.issue(id, dueDate),
    onSuccess: refresh,
    onError: () => setErrorKey(`${k}.errors.issueFailed`),
  });
  const paymentMutation = useMutation({
    mutationFn: ({ id, amount }: { id: string; amount: number }) => repos.certificates.recordPayment(id, amount, today()),
    onSuccess: (id) => {
      setPaymentInputs((current) => ({ ...current, [id]: '' }));
      refresh();
    },
    onError: () => setErrorKey(`${k}.errors.paymentFailed`),
  });
  const cancelMutation = useMutation({
    mutationFn: (id: string) => repos.certificates.cancel(id),
    onSuccess: refresh,
    onError: () => setErrorKey(`${k}.errors.cancelFailed`),
  });

  const liveCertificates = certificates.filter((row) => row.status !== 'cancelled');
  const totalCertified = liveCertificates.reduce((sum, row) => sum + Number(row.gross_amount), 0);
  const totalPaid = liveCertificates.reduce((sum, row) => sum + Number(row.paid_amount), 0);
  const outstanding = liveCertificates.reduce((sum, row) => sum + Math.max(0, Number(row.net_amount) - Number(row.paid_amount)), 0);
  const totalRetentionHeld = Number(retentionSummaryQuery.data?.balance_held ?? 0);
  const isBusy = createMutation.isPending || issueMutation.isPending || paymentMutation.isPending || cancelMutation.isPending;

  const openCreate = () => {
    setSelectedValuationId('');
    setRetentionPercentage(String(project?.retention_pct ?? 0));
    setAdvanceRecovery('0');
    setPenaltyDeductions('0');
    setOtherDeductions('0');
    setErrorKey('');
    setShowCreate(true);
  };

  const chooseValuation = (value: string) => {
    setSelectedValuationId(value);
    const document = valuationDocuments.find((item) => item.valuation.id === value);
    if (document) setRetentionPercentage(String(effectiveRetentionPercent(document)));
  };

  const submitCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorKey('');
    createMutation.mutate();
  };

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t(`${k}.title`)}</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">{t(`${k}.description`)}</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          disabled={!projectId || eligibleValuations.length === 0 || isBusy}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />{t(`${k}.new`)}
        </button>
      </header>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <label htmlFor="certificate-project" className="mb-2 block text-sm font-medium text-gray-700">{t(`${k}.selectProject`)}</label>
        <select id="certificate-project" value={projectId} onChange={(event) => setProjectId(event.target.value)} className="w-full max-w-lg rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
          <option value="">{t(`${k}.selectProjectPlaceholder`)}</option>
          {(projectsQuery.data ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select>
        {projectsQuery.isLoading ? <p className="mt-2 text-sm text-gray-500">{t(`${k}.loadingProjects`)}</p> : null}
        {!projectsQuery.isLoading && (projectsQuery.data?.length ?? 0) === 0 ? <p className="mt-2 text-sm text-gray-500">{t(`${k}.noProjects`)}</p> : null}
      </section>

      {errorKey ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t(errorKey)}</p> : null}
      {projectId ? (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label={t(`${k}.summaryLabel`)}>
            <SummaryCard label={t(`${k}.totalCertified`)} value={formatMoney(totalCertified, currency)} icon={<FileCheck2 className="h-5 w-5" aria-hidden="true" />} />
            <SummaryCard label={t(`${k}.totalPaid`)} value={formatMoney(totalPaid, currency)} icon={<ReceiptText className="h-5 w-5" aria-hidden="true" />} />
            <SummaryCard label={t(`${k}.totalRetentionHeld`)} value={formatMoney(totalRetentionHeld, currency)} icon={<CalendarDays className="h-5 w-5" aria-hidden="true" />} />
            <SummaryCard label={t(`${k}.outstanding`)} value={formatMoney(outstanding, currency)} icon={<ReceiptText className="h-5 w-5" aria-hidden="true" />} />
          </section>
          <p className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">{t(`${k}.paymentTrackingNote`)}</p>
          <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            {certificatesQuery.isLoading ? <div className="p-8 text-center text-sm text-gray-500">{t(`${k}.loading`)}</div> : null}
            {!certificatesQuery.isLoading && certificates.length === 0 ? <div className="p-8 text-center text-sm text-gray-500">{t(`${k}.empty`)}</div> : null}
            {!certificatesQuery.isLoading && certificates.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-4 py-3">{t(`${k}.certificateNumberColumn`)}</th>
                      <th className="px-4 py-3">{t(`${k}.certificateDate`)}</th>
                      <th className="px-4 py-3 text-right">{t(`${k}.grossAmount`)}</th>
                      <th className="px-4 py-3 text-right">{t(`${k}.retentionAmount`)}</th>
                      <th className="px-4 py-3 text-right">{t(`${k}.advanceRecovery`)}</th>
                      <th className="px-4 py-3 text-right">{t(`${k}.netAmount`)}</th>
                      <th className="px-4 py-3">{t(`${k}.statusLabel`)}</th>
                      <th className="px-4 py-3">{t(`${k}.actions`)}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {certificates.map((certificate) => (
                      <CertificateRow
                        key={certificate.id}
                        certificate={certificate}
                        currency={currency}
                        paymentValue={paymentInputs[certificate.id] ?? ''}
                        dueDateValue={dueDateInputs[certificate.id] ?? certificate.payment_due_date ?? ''}
                        busy={isBusy}
                        t={t}
                        onPaymentValue={(value) => setPaymentInputs((current) => ({ ...current, [certificate.id]: value }))}
                        onDueDateValue={(value) => setDueDateInputs((current) => ({ ...current, [certificate.id]: value }))}
                        onIssue={() => issueMutation.mutate({ id: certificate.id, dueDate: dueDateInputs[certificate.id] || null })}
                        onPayment={() => paymentMutation.mutate({ id: certificate.id, amount: Number(paymentInputs[certificate.id]) })}
                        onCancel={() => cancelMutation.mutate(certificate.id)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      {showCreate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation">
          <form onSubmit={submitCreate} className="w-full max-w-2xl space-y-4 rounded-2xl bg-white p-6 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="new-certificate-title">
            <div>
              <h2 id="new-certificate-title" className="text-lg font-semibold text-gray-900">{t(`${k}.new`)}</h2>
              <p className="mt-1 text-sm text-gray-600">{t(`${k}.valuationSourceNote`)}</p>
            </div>
            <label className="block text-sm font-medium text-gray-700">
              {t(`${k}.selectValuation`)}
              <select required value={selectedValuationId} onChange={(event) => chooseValuation(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2">
                <option value="">{t(`${k}.selectValuationPlaceholder`)}</option>
                {eligibleValuations.map(({ valuation }) => <option key={valuation.id} value={valuation.id}>{t(`${k}.valuationOption`, { number: valuation.valuation_number, date: valuation.valuation_date, amount: formatMoney(Number(valuation.gross_amount), currency) })}</option>)}
              </select>
            </label>
            {eligibleValuations.length === 0 ? <p className="text-sm text-gray-600">{t(`${k}.noEligibleValuations`)}</p> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <NumericField label={t(`${k}.retentionPercentage`)} value={retentionPercentage} onChange={setRetentionPercentage} min="0" max="100" step="0.01" />
              <NumericField label={t(`${k}.advanceRecovery`)} value={advanceRecovery} onChange={setAdvanceRecovery} min="0" step="0.01" />
              <NumericField label={t(`${k}.penaltyDeductions`)} value={penaltyDeductions} onChange={setPenaltyDeductions} min="0" step="0.01" />
              <NumericField label={t(`${k}.otherDeductions`)} value={otherDeductions} onChange={setOtherDeductions} min="0" step="0.01" />
            </div>
            {selectedValuation ? (
              <dl className="grid gap-2 rounded-lg bg-gray-50 p-4 text-sm sm:grid-cols-3">
                <AmountPreview label={t(`${k}.grossAmount`)} value={formatMoney(grossPreview, currency)} />
                <AmountPreview label={t(`${k}.retentionAmount`)} value={formatMoney(retentionPreview, currency)} />
                <AmountPreview label={t(`${k}.netAmount`)} value={formatMoney(netPreview, currency)} />
              </dl>
            ) : null}
            {errorKey ? <p role="alert" className="text-sm text-red-700">{t(errorKey)}</p> : null}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setShowCreate(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700">{t(`${k}.cancel`)}</button>
              <button type="submit" disabled={!selectedValuationId || netPreview < 0 || createMutation.isPending} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{createMutation.isPending ? t(`${k}.creating`) : t(`${k}.create`)}</button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}

function CertificateRow({
  certificate,
  currency,
  paymentValue,
  dueDateValue,
  busy,
  t,
  onPaymentValue,
  onDueDateValue,
  onIssue,
  onPayment,
  onCancel,
}: {
  certificate: PaymentCertificate;
  currency: string;
  paymentValue: string;
  dueDateValue: string;
  busy: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
  onPaymentValue: (value: string) => void;
  onDueDateValue: (value: string) => void;
  onIssue: () => void;
  onPayment: () => void;
  onCancel: () => void;
}) {
  const outstanding = Math.max(0, Number(certificate.net_amount) - Number(certificate.paid_amount));
  return (
    <tr>
      <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-900">{t(`${k}.certificateNumber`, { number: certificate.certificate_number })}</td>
      <td className="whitespace-nowrap px-4 py-3">{certificate.certificate_date}</td>
      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatMoney(Number(certificate.gross_amount), currency)}</td>
      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatMoney(Number(certificate.retention_amount), currency)}</td>
      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatMoney(Number(certificate.advance_recovery), currency)}</td>
      <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">{formatMoney(Number(certificate.net_amount), currency)}</td>
      <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClasses[certificate.status]}`}>{t(`${k}.statuses.${certificate.status}`)}</span></td>
      <td className="px-4 py-3">
        <div className="flex min-w-48 flex-wrap items-center gap-2">
          {certificate.status === 'draft' ? (
            <>
              <label className="sr-only" htmlFor={`due-${certificate.id}`}>{t(`${k}.paymentDueDate`)}</label>
              <input id={`due-${certificate.id}`} type="date" value={dueDateValue} onChange={(event) => onDueDateValue(event.target.value)} className="rounded border border-gray-300 px-2 py-1 text-xs" />
              <button type="button" disabled={busy} onClick={onIssue} className="rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{t(`${k}.issue`)}</button>
            </>
          ) : null}
          {certificate.status === 'issued' || certificate.status === 'partially_paid' ? (
            <div className="flex items-center gap-1">
              <label className="sr-only" htmlFor={`payment-${certificate.id}`}>{t(`${k}.paymentAmount`)}</label>
              <input id={`payment-${certificate.id}`} type="number" min="0.01" max={outstanding} step="0.01" value={paymentValue} onChange={(event) => onPaymentValue(event.target.value)} className="w-24 rounded border border-gray-300 px-2 py-1 text-xs" />
              <button type="button" disabled={busy || Number(paymentValue) <= 0 || Number(paymentValue) > outstanding} onClick={onPayment} className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs font-semibold text-gray-700 disabled:opacity-50">{t(`${k}.recordPayment`)}</button>
            </div>
          ) : null}
          {certificate.status === 'draft' || (certificate.status === 'issued' && certificate.paid_amount === 0) ? <button type="button" disabled={busy} onClick={onCancel} className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs font-semibold text-gray-700 disabled:opacity-50">{t(`${k}.cancelCertificate`)}</button> : null}
        </div>
      </td>
    </tr>
  );
}

function NumericField({ label, value, onChange, ...inputProps }: { label: string; value: string; onChange: (value: string) => void; min?: string; max?: string; step?: string }) {
  return (
    <label className="block text-sm font-medium text-gray-700">
      {label}
      <input type="number" required min={inputProps.min} max={inputProps.max} step={inputProps.step} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" />
    </label>
  );
}

function AmountPreview({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-gray-500">{label}</dt><dd className="mt-1 font-semibold text-gray-900">{value}</dd></div>;
}

function SummaryCard({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2"><p className="text-sm font-medium text-gray-500">{label}</p><span className="text-brand-700">{icon}</span></div>
      <p className="mt-2 text-xl font-semibold tabular-nums text-gray-900">{value}</p>
    </div>
  );
}
