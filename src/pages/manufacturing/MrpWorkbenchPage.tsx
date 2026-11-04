import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Activity, ClipboardList, Factory, PackageCheck, Plus, RefreshCw, X } from 'lucide-react';
import { CapabilityGate } from '@/components/billing/CapabilityGate';
import { PlanGate } from '@/components/billing/PlanGate';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';
import type { MrpDemandInput, MrpRecommendationSummary, MrpRun } from '@/dal/repositories/ManufacturingRepository';

const prefix = 'manufacturing.mrp';

type DemandDraft = { product_id: string; quantity: string; required_date: string };
type RecommendationKind = 'all' | 'make' | 'buy';
type RecommendationStatus = 'all' | 'open' | 'dismissed' | 'converted';
const EMPTY_RUNS: MrpRun[] = [];
const EMPTY_RECOMMENDATIONS: MrpRecommendationSummary[] = [];

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatQuantity(value: number | null | undefined): string {
  return Number(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function formatDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export function MrpWorkbenchPage() {
  return (
    <PlanGate minPlan="enterprise" featureNameKey="navigation.sections.manufacturing">
      <CapabilityGate capability="manufacturing">
        <MrpWorkbenchPageContent />
      </CapabilityGate>
    </PlanGate>
  );
}

function MrpWorkbenchPageContent() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const businessId = useAppStore((state) => state.currentBusiness?.business?.id ?? '');
  const [today] = useState(() => dateKey(new Date()));
  const [horizonStart, setHorizonStart] = useState(today);
  const [horizonEnd, setHorizonEnd] = useState(() => {
    const end = new Date(`${today}T00:00:00`);
    end.setDate(end.getDate() + 30);
    return dateKey(end);
  });
  const [demandDrafts, setDemandDrafts] = useState<DemandDraft[]>([
    { product_id: '', quantity: '', required_date: today },
  ]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [kindFilter, setKindFilter] = useState<RecommendationKind>('all');
  const [statusFilter, setStatusFilter] = useState<RecommendationStatus>('all');
  const [actionError, setActionError] = useState('');
  const [busyRecommendationId, setBusyRecommendationId] = useState('');

  const runsQuery = useQuery({
    queryKey: ['manufacturing', 'mrp-runs', businessId],
    queryFn: () => repos.manufacturing.listMrpRuns(businessId),
    enabled: Boolean(businessId),
  });
  const productsQuery = useQuery({
    queryKey: ['manufacturing', 'mrp-products', businessId],
    queryFn: () => repos.inventory.findAllProducts(businessId),
    enabled: Boolean(businessId),
  });
  const runs = runsQuery.data ?? EMPTY_RUNS;
  const activeRunId = selectedRunId || runs[0]?.id || '';
  const recommendationsQuery = useQuery({
    queryKey: ['manufacturing', 'mrp-recommendations', businessId, activeRunId],
    queryFn: () => repos.manufacturing.listMrpRecommendations(businessId, activeRunId),
    enabled: Boolean(businessId && activeRunId),
  });

  const runMutation = useMutation({
    mutationFn: (demandInputs: MrpDemandInput[]) => repos.manufacturing.runMrp(
      businessId, horizonStart, horizonEnd, demandInputs,
    ),
    onSuccess: async (runId) => {
      setSelectedRunId(runId);
      setActionError('');
      setDemandDrafts([{ product_id: '', quantity: '', required_date: horizonStart }]);
      await queryClient.invalidateQueries({ queryKey: ['manufacturing', 'mrp-runs', businessId] });
      await queryClient.invalidateQueries({ queryKey: ['manufacturing', 'mrp-recommendations', businessId] });
    },
    onError: () => setActionError(t(`${prefix}.errors.runFailed`)),
  });

  const products = productsQuery.data ?? [];
  const recommendations = recommendationsQuery.data ?? EMPTY_RECOMMENDATIONS;
  const selectedRun = runs.find((run) => run.id === activeRunId) ?? null;
  const filteredRecommendations = useMemo(() => recommendations.filter((recommendation) => {
    if (kindFilter !== 'all' && recommendation.recommendation_type !== kindFilter) return false;
    return statusFilter === 'all' || recommendation.status === statusFilter;
  }), [recommendations, kindFilter, statusFilter]);

  const summary = useMemo(() => recommendations.reduce((result, row) => {
    result.totalNet += Number(row.net_requirement);
    if (row.recommendation_type === 'make') result.make += 1;
    else result.buy += 1;
    if (row.status === 'open') result.open += 1;
    return result;
  }, { make: 0, buy: 0, open: 0, totalNet: 0 }), [recommendations]);

  const updateDraft = (index: number, patch: Partial<DemandDraft>) => {
    setDemandDrafts((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  };

  const handleRun = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setActionError('');
    if (!businessId || !horizonStart || !horizonEnd || horizonEnd < horizonStart) {
      setActionError(t(`${prefix}.errors.invalidHorizon`));
      return;
    }
    const inputs: MrpDemandInput[] = [];
    for (const row of demandDrafts) {
      if (!row.product_id && !row.quantity) continue;
      const quantity = Number(row.quantity);
      if (!row.product_id || !Number.isFinite(quantity) || quantity <= 0 || !row.required_date
        || row.required_date < horizonStart || row.required_date > horizonEnd) {
        setActionError(t(`${prefix}.errors.invalidDemand`));
        return;
      }
      inputs.push({ product_id: row.product_id, quantity, required_date: row.required_date });
    }
    runMutation.mutate(inputs);
  };

  const runAction = async (recommendation: MrpRecommendationSummary, action: 'convert' | 'dismiss') => {
    setActionError('');
    setBusyRecommendationId(recommendation.id);
    try {
      if (action === 'convert') await repos.manufacturing.convertMrpRecommendation(recommendation.id);
      else await repos.manufacturing.dismissMrpRecommendation(businessId, recommendation.id);
      await queryClient.invalidateQueries({ queryKey: ['manufacturing', 'mrp-recommendations', businessId, activeRunId] });
      await queryClient.invalidateQueries({ queryKey: ['manufacturing', 'mrp-runs', businessId] });
    } catch {
      setActionError(t(action === 'convert' ? `${prefix}.errors.convertFailed` : `${prefix}.errors.dismissFailed`));
    } finally {
      setBusyRecommendationId('');
    }
  };

  const pageError = runsQuery.isError || productsQuery.isError || recommendationsQuery.isError;

  return (
    <main className="mx-auto max-w-[1440px] space-y-6 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <Factory className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{t(`${prefix}.title`)}</h1>
          <p className="text-sm text-gray-500">{t(`${prefix}.description`)}</p>
        </div>
      </header>

      {pageError ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {t(`${prefix}.errors.loadFailed`)}
        </div>
      ) : null}
      {actionError ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {actionError}
        </div>
      ) : null}

      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Activity className="h-5 w-5 text-brand-700" aria-hidden="true" />
          <h2 className="text-base font-semibold text-gray-900">{t(`${prefix}.newRun.title`)}</h2>
        </div>
        <p className="mb-4 text-sm text-gray-600">{t(`${prefix}.newRun.explanation`)}</p>
        <form onSubmit={handleRun} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-gray-700">
              {t(`${prefix}.newRun.horizonStart`)}
              <input type="date" value={horizonStart} onChange={(event) => setHorizonStart(event.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" required />
            </label>
            <label className="block text-sm font-medium text-gray-700">
              {t(`${prefix}.newRun.horizonEnd`)}
              <input type="date" value={horizonEnd} onChange={(event) => setHorizonEnd(event.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" required />
            </label>
          </div>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-800">{t(`${prefix}.newRun.demandLines`)}</h3>
              <button type="button" onClick={() => setDemandDrafts((rows) => [...rows, { product_id: '', quantity: '', required_date: horizonStart }])} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                <Plus className="h-4 w-4" aria-hidden="true" />{t(`${prefix}.newRun.addDemand`)}
              </button>
            </div>
            {demandDrafts.map((row, index) => (
              <div key={index} className="grid gap-3 rounded-xl border border-gray-200 p-3 sm:grid-cols-[minmax(0,2fr)_1fr_1fr_auto] sm:items-end">
                <label className="block text-sm font-medium text-gray-700">
                  {t(`${prefix}.newRun.product`)}
                  <select value={row.product_id} onChange={(event) => updateDraft(index, { product_id: event.target.value })} className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" aria-label={`${t(`${prefix}.newRun.product`)} ${index + 1}`}>
                    <option value="">{t(`${prefix}.newRun.selectProduct`)}</option>
                    {products.map((product) => <option key={product.id} value={product.id}>{product.name}{product.sku ? ` · ${product.sku}` : ''}</option>)}
                  </select>
                </label>
                <label className="block text-sm font-medium text-gray-700">
                  {t(`${prefix}.newRun.quantity`)}
                  <input type="number" min="0.000001" step="any" value={row.quantity} onChange={(event) => updateDraft(index, { quantity: event.target.value })} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" aria-label={`${t(`${prefix}.newRun.quantity`)} ${index + 1}`} />
                </label>
                <label className="block text-sm font-medium text-gray-700">
                  {t(`${prefix}.newRun.requiredDate`)}
                  <input type="date" min={horizonStart} max={horizonEnd} value={row.required_date} onChange={(event) => updateDraft(index, { required_date: event.target.value })} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" aria-label={`${t(`${prefix}.newRun.requiredDate`)} ${index + 1}`} />
                </label>
                <button type="button" onClick={() => setDemandDrafts((rows) => rows.length > 1 ? rows.filter((_, rowIndex) => rowIndex !== index) : [{ product_id: '', quantity: '', required_date: horizonStart }])} className="inline-flex h-10 items-center justify-center rounded-lg border border-gray-300 px-3 text-gray-600 hover:bg-gray-50" aria-label={t(`${prefix}.newRun.removeDemand`)}>
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={runMutation.isPending || !businessId} className="inline-flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-60">
              <RefreshCw className={`h-4 w-4 ${runMutation.isPending ? 'animate-spin' : ''}`} aria-hidden="true" />
              {runMutation.isPending ? t(`${prefix}.newRun.running`) : t(`${prefix}.newRun.run`)}
            </button>
            <span className="text-xs text-gray-500">{t(`${prefix}.newRun.automaticWorkOrderDemand`)}</span>
          </div>
        </form>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-brand-700" aria-hidden="true" />
            <h2 className="text-base font-semibold text-gray-900">{t(`${prefix}.history.title`)}</h2>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            {t(`${prefix}.history.selectRun`)}
            <select value={activeRunId} onChange={(event) => setSelectedRunId(event.target.value)} className="max-w-full rounded-lg border border-gray-300 bg-white px-3 py-2">
              {!runs.length ? <option value="">{t(`${prefix}.history.empty`)}</option> : null}
              {runs.map((run) => <option key={run.id} value={run.id}>{t(`${prefix}.history.runLabel`, { number: run.run_number, date: formatDate(run.created_at) })}</option>)}
            </select>
          </label>
        </div>

        {runsQuery.isLoading ? <div className="h-20 animate-pulse rounded-2xl bg-gray-100" /> : null}
        {runs.length === 0 && !runsQuery.isLoading ? <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">{t(`${prefix}.history.emptyState`)}</div> : null}

        {selectedRun ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCard label={t(`${prefix}.summary.recommendations`)} value={String(selectedRun.recommendation_count)} icon={<ClipboardList className="h-5 w-5" aria-hidden="true" />} />
              <SummaryCard label={t(`${prefix}.summary.make`)} value={String(selectedRun.make_count)} icon={<Factory className="h-5 w-5" aria-hidden="true" />} />
              <SummaryCard label={t(`${prefix}.summary.buy`)} value={String(selectedRun.buy_count)} icon={<PackageCheck className="h-5 w-5" aria-hidden="true" />} />
              <SummaryCard label={t(`${prefix}.summary.netQuantity`)} value={formatQuantity(summary.totalNet)} icon={<Activity className="h-5 w-5" aria-hidden="true" />} />
            </div>

            <RecommendationsSection
              run={selectedRun}
              rows={filteredRecommendations}
              totalRows={recommendations.length}
              kindFilter={kindFilter}
              statusFilter={statusFilter}
              onKindChange={setKindFilter}
              onStatusChange={setStatusFilter}
              onAction={runAction}
              busyRecommendationId={busyRecommendationId}
              isLoading={recommendationsQuery.isLoading}
              t={t}
            />
          </>
        ) : null}
      </section>
    </main>
  );
}

function SummaryCard({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        <span className="text-brand-700">{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function RecommendationsSection({
  run,
  rows,
  totalRows,
  kindFilter,
  statusFilter,
  onKindChange,
  onStatusChange,
  onAction,
  busyRecommendationId,
  isLoading,
  t,
}: {
  run: MrpRun;
  rows: MrpRecommendationSummary[];
  totalRows: number;
  kindFilter: RecommendationKind;
  statusFilter: RecommendationStatus;
  onKindChange: (value: RecommendationKind) => void;
  onStatusChange: (value: RecommendationStatus) => void;
  onAction: (row: MrpRecommendationSummary, action: 'convert' | 'dismiss') => void;
  busyRecommendationId: string;
  isLoading: boolean;
  t: TFunction;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 p-5">
        <div>
          <h3 className="text-base font-semibold text-gray-900">{t(`${prefix}.recommendations.title`)}</h3>
          <p className="mt-1 text-xs text-gray-500">{t(`${prefix}.recommendations.horizon`, { start: formatDate(run.horizon_start), end: formatDate(run.horizon_end) })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="mrp-kind-filter">{t(`${prefix}.recommendations.filterType`)}</label>
          <select id="mrp-kind-filter" value={kindFilter} onChange={(event) => onKindChange(event.target.value as RecommendationKind)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            {(['all', 'make', 'buy'] as const).map((value) => <option key={value} value={value}>{t(`${prefix}.recommendations.types.${value}`)}</option>)}
          </select>
          <label className="sr-only" htmlFor="mrp-status-filter">{t(`${prefix}.recommendations.filterStatus`)}</label>
          <select id="mrp-status-filter" value={statusFilter} onChange={(event) => onStatusChange(event.target.value as RecommendationStatus)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            {(['all', 'open', 'dismissed', 'converted'] as const).map((value) => <option key={value} value={value}>{t(`${prefix}.recommendations.statuses.${value}`)}</option>)}
          </select>
        </div>
      </div>
      {isLoading ? <div className="h-36 animate-pulse bg-gray-50" /> : null}
      {!isLoading && totalRows === 0 ? <div className="p-8 text-center text-sm text-gray-500">{t(`${prefix}.recommendations.empty`)}</div> : null}
      {!isLoading && totalRows > 0 && rows.length === 0 ? <div className="p-8 text-center text-sm text-gray-500">{t(`${prefix}.recommendations.noMatches`)}</div> : null}
      {!isLoading && rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">{t(`${prefix}.recommendations.product`)}</th>
                <th className="px-4 py-3">{t(`${prefix}.recommendations.type`)}</th>
                <th className="px-4 py-3">{t(`${prefix}.recommendations.requiredDate`)}</th>
                <th className="px-4 py-3 text-right">{t(`${prefix}.recommendations.gross`)}</th>
                <th className="px-4 py-3 text-right">{t(`${prefix}.recommendations.onHand`)}</th>
                <th className="px-4 py-3 text-right">{t(`${prefix}.recommendations.productionSupply`)}</th>
                <th className="px-4 py-3 text-right">{t(`${prefix}.recommendations.approvedSupply`)}</th>
                <th className="px-4 py-3 text-right">{t(`${prefix}.recommendations.net`)}</th>
                <th className="px-4 py-3">{t(`${prefix}.recommendations.status`)}</th>
                <th className="px-4 py-3">{t(`${prefix}.recommendations.actions`)}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-900">
                    {row.product?.name ?? t(`${prefix}.recommendations.unknownProduct`)}
                    {row.product?.sku ? <span className="ml-1 text-xs text-gray-500">{row.product.sku}</span> : null}
                  </td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${row.recommendation_type === 'make' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-800'}`}>{t(`${prefix}.recommendations.types.${row.recommendation_type}`)}</span></td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">{formatDate(row.required_date)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatQuantity(row.gross_requirement)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatQuantity(row.on_hand_quantity)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatQuantity(row.active_production_quantity)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatQuantity(row.approved_supply_quantity)}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatQuantity(row.net_requirement)}{row.product?.unit_of_measure ? ` ${row.product.unit_of_measure}` : ''}</td>
                  <td className="whitespace-nowrap px-4 py-3">{t(`${prefix}.recommendations.statuses.${row.status}`)}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex items-center gap-2">
                      {row.status === 'open' && row.recommendation_type === 'make' ? (
                        <button type="button" disabled={busyRecommendationId === row.id} onClick={() => onAction(row, 'convert')} className="rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{t(`${prefix}.recommendations.convertToWorkOrder`)}</button>
                      ) : null}
                      {row.status === 'open' ? (
                        <button type="button" disabled={busyRecommendationId === row.id} onClick={() => onAction(row, 'dismiss')} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 disabled:opacity-50">{t(`${prefix}.recommendations.dismiss`)}</button>
                      ) : null}
                      {row.converted_work_order_id ? <Link className="text-xs font-semibold text-brand-700 underline" to={`/manufacturing/production/${row.converted_work_order_id}`}>{t(`${prefix}.recommendations.viewWorkOrder`)}</Link> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
