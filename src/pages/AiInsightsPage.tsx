import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Activity, AlertTriangle, ArrowUpRight, CheckCircle2, CircleAlert, LoaderCircle, LockKeyhole, ScanSearch, ShieldCheck, Sparkles } from 'lucide-react';
import { Assistant } from '@/components/ai/Assistant';
import { useAppStore } from '@/store/useAppStore';
import { useUsage } from '@/hooks/useUsage';
import { aiRepository } from '@/lib/repositories/aiRepository';
import type { AiAnomalyLog, AnomalyCategory, AnomalySeverity } from '@/types/ai';

const FILTERS: Array<{ key: 'all' | AnomalyCategory; label: string }> = [
  { key: 'all', label: 'ai.filters.all' },
  { key: 'duplicate_invoice', label: 'ai.categories.duplicateInvoice' },
  { key: 'unallocated_cost_center', label: 'ai.categories.unallocatedCostCenter' },
  { key: 'missing_tax_tag', label: 'ai.categories.missingTaxTag' },
  { key: 'amount_outlier', label: 'ai.categories.amountOutlier' },
  { key: 'payroll_variance', label: 'ai.categories.payrollVariance' },
];

const SEVERITY_STYLE: Record<AnomalySeverity, string> = {
  high: 'border-red-200 bg-red-50 text-red-800',
  medium: 'border-amber-200 bg-amber-50 text-amber-800',
  low: 'border-sky-200 bg-sky-50 text-sky-800',
};

function recordPath(anomaly: AiAnomalyLog): string {
  if (anomaly.source_table === 'journal_entries' && anomaly.source_id) {
    return `/journals?entry=${encodeURIComponent(anomaly.source_id)}`;
  }
  if (anomaly.source_table === 'payroll_runs' && anomaly.source_id) {
    return `/payroll/pay-runs/${encodeURIComponent(anomaly.source_id)}`;
  }
  return '/expenses';
}

function metadataValues(anomaly: AiAnomalyLog, currency: string, locale: string): Record<string, string | number> {
  const raw = anomaly.metadata && typeof anomaly.metadata === 'object' && !Array.isArray(anomaly.metadata)
    ? anomaly.metadata as Record<string, unknown>
    : {};
  const result: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (['amount', 'average', 'taxAmount'].includes(key) && typeof value === 'number') {
      try {
        result[key] = new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
      } catch {
        result[key] = `${currency} ${value.toLocaleString(locale)}`;
      }
    } else if (key === 'zScore' && typeof value === 'number') {
      result[key] = value.toFixed(1);
    } else if (typeof value === 'string' || typeof value === 'number') {
      result[key] = value;
    }
  }
  return result;
}

function SeverityCard({ title, value, tone, icon: Icon }: { title: string; value: number; tone: string; icon: typeof Activity }) {
  return (
    <div className={`rounded-2xl border p-5 ${tone}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">{title}</p>
        <Icon className="h-5 w-5 opacity-80" aria-hidden="true" />
      </div>
      <p className="mt-3 text-3xl font-bold tabular-nums">{value.toLocaleString()}</p>
    </div>
  );
}

function EnterpriseUpgradeGate() {
  const { t } = useTranslation();
  return (
    <section className="mx-auto max-w-4xl py-8 sm:py-12">
      <div className="overflow-hidden rounded-3xl border border-emerald-200 bg-white shadow-sm">
        <div className="bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 px-6 py-10 text-white sm:px-10">
          <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-emerald-200">
            <LockKeyhole className="h-6 w-6" aria-hidden="true" />
          </div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-200">{t('ai.enterpriseBadge')}</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">{t('ai.enterpriseOnly')}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200">{t('ai.upgradePrompt')}</p>
          <Link to="/settings?tab=billing" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-5 py-3 text-sm font-bold text-slate-950 transition hover:bg-emerald-300">
            {t('ai.upgradeToEnterprise')} <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
        <div className="grid gap-4 p-6 sm:grid-cols-2 sm:p-8">
          {(['duplicateInvoice', 'unallocatedCostCenter', 'missingTaxTag', 'amountOutlier', 'payrollVariance'] as const).map((category) => (
            <div key={category} className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-slate-900">{t(`ai.categories.${category}`)}</p>
                <p className="mt-1 text-xs leading-5 text-slate-600">{t(`ai.preview.${category}`)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function AnomalyCard({ anomaly, currency, locale, onResolve, resolving }: {
  anomaly: AiAnomalyLog;
  currency: string;
  locale: string;
  onResolve: (id: string) => void;
  resolving: boolean;
}) {
  const { t } = useTranslation();
  const detailValues = useMemo(() => {
    const values = metadataValues(anomaly, currency, locale);
    if (typeof values.direction === 'string') values.direction = t(`ai.direction.${values.direction}`);
    return values;
  }, [anomaly, currency, locale, t]);
  return (
    <article className={`rounded-2xl border p-5 ${anomaly.is_resolved ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-white'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {anomaly.is_resolved
            ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
            : <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />}
          <div className="min-w-0">
            <h2 className="font-semibold text-slate-900">{t(anomaly.title, detailValues)}</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">{t(anomaly.description, detailValues)}</p>
          </div>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${SEVERITY_STYLE[anomaly.severity]}`}>
          {t(`ai.severity.${anomaly.severity}`)}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600">{t(`ai.categories.${categoryKey(anomaly.category)}`)}</span>
          <time dateTime={anomaly.created_at}>{new Date(anomaly.created_at).toLocaleDateString(locale)}</time>
          {anomaly.is_resolved && <span className="font-semibold text-emerald-700">{t('ai.resolved')}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to={recordPath(anomaly)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            {t('ai.investigate')} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
          {!anomaly.is_resolved && (
            <button type="button" onClick={() => onResolve(anomaly.id)} disabled={resolving} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
              {resolving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
              {t('ai.markResolved')}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function categoryKey(category: AnomalyCategory): string {
  const names: Record<AnomalyCategory, string> = {
    duplicate_invoice: 'duplicateInvoice',
    unallocated_cost_center: 'unallocatedCostCenter',
    missing_tax_tag: 'missingTaxTag',
    amount_outlier: 'amountOutlier',
    payroll_variance: 'payrollVariance',
  };
  return names[category];
}

function EnterpriseDashboard() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const currentBusiness = useAppStore((state) => state.currentBusiness);
  const currentUser = useAppStore((state) => state.currentUser);
  const businessId = currentBusiness?.business?.id ?? '';
  const currency = currentBusiness?.business?.base_currency ?? 'MWK';
  const [filter, setFilter] = useState<'all' | AnomalyCategory>('all');
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const { data: anomalies = [], isLoading, isError } = useQuery({
    queryKey: ['ai-anomaly-logs', businessId],
    queryFn: () => aiRepository.getAnomalies(businessId),
    enabled: Boolean(businessId),
  });
  const scanMutation = useMutation({
    mutationFn: () => aiRepository.runDiagnosticScan(businessId),
    onSuccess: (result) => {
      setActionError(null);
      setScanNotice(t('ai.scanComplete', { created: result.created, skipped: result.skippedExisting }));
      void queryClient.invalidateQueries({ queryKey: ['ai-anomaly-logs', businessId] });
    },
    onError: () => {
      setScanNotice(null);
      setActionError(t('ai.scanFailed'));
    },
  });
  const resolveMutation = useMutation({
    mutationFn: (anomalyId: string) => aiRepository.resolveAnomaly(anomalyId, currentUser?.id ?? ''),
    onMutate: (anomalyId) => setResolvingId(anomalyId),
    onSuccess: () => {
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: ['ai-anomaly-logs', businessId] });
    },
    onError: () => setActionError(t('ai.resolveFailed')),
    onSettled: () => setResolvingId(null),
  });

  const visibleAnomalies = useMemo(() => {
    const filtered = filter === 'all' ? anomalies : anomalies.filter((item) => item.category === filter);
    return [...filtered].sort((a, b) => Number(a.is_resolved) - Number(b.is_resolved) || new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [anomalies, filter]);
  const highCount = anomalies.filter((item) => !item.is_resolved && item.severity === 'high').length;
  const mediumCount = anomalies.filter((item) => !item.is_resolved && item.severity === 'medium').length;
  const lowCount = anomalies.filter((item) => !item.is_resolved && item.severity === 'low').length;
  const resolvedCount = anomalies.filter((item) => item.is_resolved).length;

  return (
    <div className="mx-auto max-w-6xl space-y-8 py-4">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> {t('ai.enterpriseBadge')}
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">{t('ai.dashboardTitle')}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{t('ai.dashboardDescription')}</p>
        </div>
        <button type="button" onClick={() => { setScanNotice(null); setActionError(null); scanMutation.mutate(); }} disabled={!businessId || scanMutation.isPending} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
          {scanMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ScanSearch className="h-4 w-4" aria-hidden="true" />}
          {scanMutation.isPending ? t('ai.scanning') : t('ai.runScan')}
        </button>
      </header>

      {scanNotice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{scanNotice}</p>}
      {actionError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{actionError}</p>}

      <section aria-label={t('ai.summary')} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SeverityCard title={t('ai.highSeverity')} value={highCount} tone="border-red-200 bg-red-50 text-red-900" icon={AlertTriangle} />
        <SeverityCard title={t('ai.mediumSeverity')} value={mediumCount} tone="border-amber-200 bg-amber-50 text-amber-900" icon={Activity} />
        <SeverityCard title={t('ai.lowSeverity')} value={lowCount} tone="border-sky-200 bg-sky-50 text-sky-900" icon={CircleAlert} />
        <SeverityCard title={t('ai.resolved')} value={resolvedCount} tone="border-emerald-200 bg-emerald-50 text-emerald-900" icon={CheckCircle2} />
      </section>

      <section>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-950">{t('ai.findingsTitle')}</h2>
            <p className="mt-1 text-sm text-slate-500">{t('ai.findingsDescription', { count: anomalies.length })}</p>
          </div>
          <div role="tablist" aria-label={t('ai.filterFindings')} className="flex max-w-full gap-2 overflow-x-auto pb-1">
            {FILTERS.map((item) => (
              <button key={item.key} type="button" role="tab" aria-selected={filter === item.key} onClick={() => setFilter(item.key)} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${filter === item.key ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'}`}>
                {t(item.label)}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white p-10 text-sm text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />{t('ai.loadingFindings')}</div>
        ) : isError ? (
          <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">{t('ai.loadFailed')}</p>
        ) : visibleAnomalies.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-emerald-300 bg-emerald-50/60 p-10 text-center">
            <ShieldCheck className="mx-auto h-9 w-9 text-emerald-700" aria-hidden="true" />
            <p className="mt-3 font-semibold text-emerald-950">{t('ai.noAnomalies')}</p>
            <p className="mt-1 text-sm text-emerald-900/70">{t('ai.noAnomaliesHint')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {visibleAnomalies.map((anomaly) => (
              <AnomalyCard key={anomaly.id} anomaly={anomaly} currency={currency} locale={i18n.language} onResolve={(id) => resolveMutation.mutate(id)} resolving={resolvingId === anomaly.id} />
            ))}
          </div>
        )}
      </section>

      <details className="group rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold text-slate-900">
          <span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-emerald-700" aria-hidden="true" />{t('ai.askAssistant')}</span>
          <ArrowUpRight className="h-4 w-4 transition group-open:rotate-45" aria-hidden="true" />
        </summary>
        <div className="mt-4 h-[min(70vh,680px)] min-h-[420px] overflow-hidden rounded-xl border border-slate-100">
          <Assistant variant="page" initialMode="ai" />
        </div>
      </details>
    </div>
  );
}

export function AiInsightsPage() {
  const { planTier } = useUsage();
  return planTier === 'enterprise' ? <EnterpriseDashboard /> : <EnterpriseUpgradeGate />;
}

export default AiInsightsPage;
