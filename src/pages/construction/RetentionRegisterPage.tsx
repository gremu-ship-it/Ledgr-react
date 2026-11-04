import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CircleDollarSign, History, Plus, WalletCards } from 'lucide-react';
import type { Project, ProjectRetentionEntry } from '@/dal/repositories/ProjectRepository';
import { CONSTRUCTION_CAPABILITIES } from '@/dal/repositories/ConstructionProcurementRepository';
import { repos } from '@/lib/repositories';
import { formatMoney } from '@/lib/construction/constructionWorkspaceView';
import { useAppStore } from '@/store/useAppStore';

const k = 'construction.retentionRegister';

async function allProjects(businessId: string): Promise<Project[]> {
  const projects: Project[] = [];
  for (let page = 0; page < 100; page += 1) {
    const result = await repos.projects.list(businessId, { page });
    projects.push(...result.rows);
    if (projects.length >= result.count) break;
  }
  return projects;
}

function dateOnly(value: string) {
  return value.slice(0, 10);
}

export function RetentionRegisterPage() {
  const { t } = useTranslation();
  const cache = useQueryClient();
  const currentBusiness = useAppStore((state) => state.currentBusiness);
  const businessId = currentBusiness?.business?.id ?? null;
  const currency = currentBusiness?.business?.base_currency ?? 'MWK';
  const [projectId, setProjectId] = useState('');
  const [showRelease, setShowRelease] = useState(false);
  const [releaseAmount, setReleaseAmount] = useState('');
  const [releaseDescription, setReleaseDescription] = useState('');
  const [errorKey, setErrorKey] = useState('');

  const projectsQuery = useQuery({
    queryKey: ['construction', 'retention-register-projects', businessId],
    queryFn: () => allProjects(businessId as string),
    enabled: Boolean(businessId),
  });
  const project = projectsQuery.data?.find((row) => row.id === projectId) ?? null;
  const capabilitiesQuery = useQuery({
    queryKey: ['construction', 'retention-register-capabilities', businessId],
    queryFn: () => repos.construction.findCapabilities(businessId as string),
    enabled: Boolean(businessId),
  });
  const historyQuery = useQuery({
    queryKey: ['construction', 'valuation-history', projectId],
    queryFn: () => repos.projects.getValuationHistory(projectId),
    enabled: Boolean(projectId),
  });
  const summaryQuery = useQuery({
    queryKey: ['construction', 'retention-summary', projectId],
    queryFn: () => repos.projects.getRetentionSummary(projectId),
    enabled: Boolean(projectId),
  });
  const entries = historyQuery.data?.retention_entries ?? [];
  const summary = summaryQuery.data;
  const balance = Number(summary?.balance_held ?? 0);
  const canRelease = Boolean(summary?.can_release)
    && (capabilitiesQuery.data ?? []).includes(CONSTRUCTION_CAPABILITIES.exceptionAuthorize);

  const refresh = () => {
    void cache.invalidateQueries({ queryKey: ['construction', 'valuation-history', projectId] });
    void cache.invalidateQueries({ queryKey: ['construction', 'retention-summary', projectId] });
    void cache.invalidateQueries({ queryKey: ['construction', 'dashboard-retention-aging', businessId] });
  };
  const releaseMutation = useMutation({
    mutationFn: () => repos.projects.releaseRetention(projectId, Number(releaseAmount), releaseDescription.trim()),
    onSuccess: () => {
      setShowRelease(false);
      setReleaseAmount('');
      setReleaseDescription('');
      setErrorKey('');
      refresh();
    },
    onError: () => setErrorKey(`${k}.errors.releaseFailed`),
  });

  const closeDialog = () => {
    setShowRelease(false);
    setErrorKey('');
  };
  const submitRelease = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amount = Number(releaseAmount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > balance) {
      setErrorKey(`${k}.exceedsHeld`);
      return;
    }
    if (!releaseDescription.trim()) {
      setErrorKey(`${k}.descriptionRequired`);
      return;
    }
    setErrorKey('');
    releaseMutation.mutate();
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
          onClick={() => { setErrorKey(''); setShowRelease(true); }}
          disabled={!projectId || !canRelease || balance <= 0}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />{t(`${k}.newRelease`)}
        </button>
      </header>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <label htmlFor="retention-project" className="mb-2 block text-sm font-medium text-gray-700">{t(`${k}.selectProject`)}</label>
        <select id="retention-project" value={projectId} onChange={(event) => setProjectId(event.target.value)} className="w-full max-w-lg rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
          <option value="">{t(`${k}.selectProjectPlaceholder`)}</option>
          {(projectsQuery.data ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select>
        {projectsQuery.isLoading ? <p className="mt-2 text-sm text-gray-500">{t(`${k}.loadingProjects`)}</p> : null}
        {!projectsQuery.isLoading && (projectsQuery.data?.length ?? 0) === 0 ? <p className="mt-2 text-sm text-gray-500">{t(`${k}.noProjects`)}</p> : null}
      </section>

      {errorKey ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t(errorKey)}</p> : null}
      {projectId ? (
        <>
          <section className="grid gap-4 sm:grid-cols-3" aria-label={t(`${k}.summaryLabel`)}>
            <SummaryCard label={t(`${k}.totalRetained`)} value={formatMoney(Number(summary?.total_withheld ?? 0), currency)} icon={<WalletCards className="h-5 w-5" aria-hidden="true" />} />
            <SummaryCard label={t(`${k}.totalReleased`)} value={formatMoney(Number(summary?.total_released ?? 0), currency)} icon={<History className="h-5 w-5" aria-hidden="true" />} />
            <SummaryCard label={t(`${k}.currentlyHeld`)} value={formatMoney(balance, currency)} icon={<CircleDollarSign className="h-5 w-5" aria-hidden="true" />} />
          </section>
          <p className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">{t(`${k}.ledgerNote`)}</p>
          {!canRelease && summary ? <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{t(`${k}.cannotRelease`)}</p> : null}
          <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            {historyQuery.isLoading || summaryQuery.isLoading ? <div className="p-8 text-center text-sm text-gray-500">{t(`${k}.loading`)}</div> : null}
            {!historyQuery.isLoading && entries.length === 0 ? <div className="p-8 text-center text-sm text-gray-500">{t(`${k}.empty`)}</div> : null}
            {!historyQuery.isLoading && entries.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-4 py-3">{t(`${k}.entryNumber`)}</th>
                      <th className="px-4 py-3">{t(`${k}.date`)}</th>
                      <th className="px-4 py-3">{t(`${k}.entryType`)}</th>
                      <th className="px-4 py-3 text-right">{t(`${k}.amount`)}</th>
                      <th className="px-4 py-3">{t(`${k}.descriptionColumn`)}</th>
                      <th className="px-4 py-3">{t(`${k}.invoice`)}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {[...entries].sort((a, b) => a.created_at.localeCompare(b.created_at)).map((entry, index) => (
                      <RetentionRow key={entry.id} entry={entry} index={index + 1} currency={currency} t={t} />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      {showRelease ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation">
          <form onSubmit={submitRelease} className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="new-retention-release-title">
            <div>
              <h2 id="new-retention-release-title" className="text-lg font-semibold text-gray-900">{t(`${k}.newRelease`)}</h2>
              <p className="mt-1 text-sm text-gray-600">{t(`${k}.releaseAvailability`, { balance: formatMoney(balance, currency), projectStatus: t(`construction.projects.statuses.${project?.status ?? 'active'}`) })}</p>
            </div>
            <label className="block text-sm font-medium text-gray-700">
              {t(`${k}.releaseAmount`)}
              <input required type="number" min="0.01" step="0.01" value={releaseAmount} onChange={(event) => setReleaseAmount(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" />
            </label>
            <label className="block text-sm font-medium text-gray-700">
              {t(`${k}.releaseDescription`)}
              <textarea required maxLength={500} rows={3} value={releaseDescription} onChange={(event) => setReleaseDescription(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" />
            </label>
            <p className="text-xs text-gray-500">{t(`${k}.releaseInvoiceNote`)}</p>
            {errorKey ? <p role="alert" className="text-sm text-red-700">{t(errorKey)}</p> : null}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={closeDialog} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700">{t(`${k}.cancel`)}</button>
              <button type="submit" disabled={releaseMutation.isPending || !canRelease} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{releaseMutation.isPending ? t(`${k}.saving`) : t(`${k}.createRelease`)}</button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}

function RetentionRow({ entry, index, currency, t }: { entry: ProjectRetentionEntry; index: number; currency: string; t: (key: string, options?: Record<string, unknown>) => string }) {
  const isReleased = entry.type === 'released';
  return (
    <tr>
      <td className="px-4 py-3 tabular-nums">{index}</td>
      <td className="whitespace-nowrap px-4 py-3">{dateOnly(entry.created_at)}</td>
      <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${isReleased ? 'bg-blue-50 text-blue-800' : 'bg-amber-50 text-amber-800'}`}>{t(`${k}.types.${entry.type}`)}</span></td>
      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatMoney(Number(entry.amount), currency)}</td>
      <td className="min-w-56 px-4 py-3 text-gray-600">{entry.description ?? t(`${k}.noDescription`)}</td>
      <td className="whitespace-nowrap px-4 py-3">{entry.invoice?.invoice_number ?? t(`${k}.noInvoice`)}</td>
    </tr>
  );
}

function SummaryCard({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2"><p className="text-sm font-medium text-gray-500">{label}</p><span className="text-brand-700">{icon}</span></div>
      <p className="mt-2 text-xl font-semibold tabular-nums text-gray-900">{value}</p>
    </div>
  );
}
