import { useEffect, useMemo, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Play,
  CheckCircle2,
  Lock,
  XCircle,
  Factory,
  Package,
  CircleDot,
  AlertTriangle,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { supabase } from '@/lib/supabase';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as unknown as { from: (t: string) => any; rpc: (n: string, p: unknown) => any; auth: any };
import { useCapability } from '@/hooks/useCapability';
import { CapabilityGate } from '@/components/billing/CapabilityGate';
import {
  workOrderActions,
  workOrderProgressPct,
  workOrderStatusClass,
  workOrderStatusKey,
  workOrderYieldPct,
  type WorkOrderStatus,
} from './workOrderStatus';

type WorkOrderRow = {
  id: string;
  business_id: string;
  work_order_number: string;
  product_id: string;
  bom_id: string;
  planned_quantity: number;
  completed_quantity: number;
  scrapped_quantity: number;
  status: WorkOrderStatus;
  planned_start_date: string | null;
  planned_end_date: string | null;
  actual_start_date: string | null;
  actual_end_date: string | null;
  from_location_id: string | null;
  to_location_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type LineRow = {
  id: string;
  work_order_id: string;
  component_product_id: string;
  planned_quantity: number;
  actual_quantity_consumed: number;
  unit_of_measure: string | null;
  scrap_pct: number;
};

type RunRow = {
  id: string;
  work_order_id: string;
  run_number: number;
  output_quantity: number;
  scrap_quantity: number;
  status: 'in_progress' | 'completed' | 'cancelled';
  started_at: string | null;
  completed_at: string | null;
  notes: string | null;
};

type TxnRow = {
  id: string;
  work_order_id: string;
  run_id: string | null;
  component_product_id: string;
  quantity: number;
  transaction_type: 'consume' | 'return' | 'adjustment';
  from_location_id: string | null;
  to_location_id: string | null;
  recorded_by: string;
  recorded_at: string;
  notes: string | null;
};

type ProductRow = { id: string; name: string; purchase_price: number; unit_of_measure: string | null };
type LocationRow = { id: string; name: string };

type Tab = 'materials' | 'runs' | 'transactions';

const number = (value: number | null | undefined, digits = 2) =>
  Number(value ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });

const money = (value: number | null | undefined) =>
  Number(value ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString();
}

export function WorkOrderDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const businessId = useAppStore((s) => s.currentBusiness?.business?.id);
  const hasManufacturing = useCapability('manufacturing');

  const [workOrder, setWorkOrder] = useState<WorkOrderRow | null>(null);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [transactions, setTransactions] = useState<TxnRow[]>([]);
  const [productsById, setProductsById] = useState<Record<string, ProductRow>>({});
  const [locationsById, setLocationsById] = useState<Record<string, LocationRow>>({});
  const [bomUnitCost, setBomUnitCost] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>('materials');
  const [notesDraft, setNotesDraft] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  const [showRunModal, setShowRunModal] = useState(false);
  const [showConsumptionModal, setShowConsumptionModal] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!id || !businessId) return;
    setLoading(true);
    setError(null);
    try {
      const { data: woData, error: woErr } = await sb
        .from('manufacturing_work_orders')
        .select('*')
        .eq('id', id)
        .eq('business_id', businessId)
        .single();
      if (woErr) throw woErr;
      const wo = woData as WorkOrderRow;
      setWorkOrder(wo);
      setNotesDraft(wo.notes ?? '');

      const [{ data: lineData }, { data: runData }, { data: txnData }] = await Promise.all([
        sb.from('manufacturing_work_order_lines').select('*').eq('work_order_id', id).order('id'),
        sb.from('manufacturing_production_runs').select('*').eq('work_order_id', id).order('run_number'),
        sb
          .from('manufacturing_material_transactions')
          .select('*')
          .eq('work_order_id', id)
          .order('recorded_at', { ascending: false }),
      ]);
      const l = (lineData as LineRow[]) ?? [];
      const r = (runData as RunRow[]) ?? [];
      const tx = (txnData as TxnRow[]) ?? [];
      setLines(l);
      setRuns(r);
      setTransactions(tx);

      const productIds = [
        ...new Set([wo.product_id, ...l.map((x) => x.component_product_id), ...tx.map((x) => x.component_product_id)]),
      ];
      const { data: prodData } = await sb
        .from('products')
        .select('id,name,purchase_price,unit_of_measure')
        .in('id', productIds);
      const pmap: Record<string, ProductRow> = {};
      for (const p of (prodData as ProductRow[]) ?? []) pmap[p.id] = p;
      setProductsById(pmap);

      const locationIds = [
        ...new Set(
          [wo.from_location_id, wo.to_location_id, ...tx.flatMap((x) => [x.from_location_id, x.to_location_id])].filter(
            (v): v is string => !!v,
          ),
        ),
      ];
      if (locationIds.length > 0) {
        const { data: locData } = await sb.from('inventory_locations').select('id,name').in('id', locationIds);
        const lmap: Record<string, LocationRow> = {};
        for (const loc of (locData as LocationRow[]) ?? []) lmap[loc.id] = loc;
        setLocationsById(lmap);
      }

      const { data: costData } = await sb.rpc('manufacturing_bom_cost', { p_bom_id: wo.bom_id });
      setBomUnitCost(Number(costData ?? 0));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [id, businessId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchAll();
  }, [fetchAll]);

  const runCommand = useCallback(
    async (rpc: string, confirmKey: string | null, params: Record<string, unknown>) => {
      if (!id) return;
      if (confirmKey && !window.confirm(t(confirmKey))) return;
      setActionLoading(rpc);
      try {
        const { error: rpcError } = await sb.rpc(rpc, params);
        if (rpcError) throw rpcError;
        await fetchAll();
      } catch (e: unknown) {
        alert(e instanceof Error ? e.message : String(e));
      } finally {
        setActionLoading(null);
      }
    },
    [id, t, fetchAll],
  );

  const saveNotes = useCallback(async () => {
    if (!id || !workOrder || workOrder.status !== 'draft') return;
    setSavingNotes(true);
    try {
      const { error: upErr } = await sb
        .from('manufacturing_work_orders')
        .update({ notes: notesDraft || null })
        .eq('id', id);
      if (upErr) throw upErr;
      await fetchAll();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingNotes(false);
    }
  }, [id, workOrder, notesDraft, fetchAll]);

  const totals = useMemo(() => {
    const totalConsumed = lines.reduce(
      (sum, line) => sum + Number(line.actual_quantity_consumed ?? 0) * Number(productsById[line.component_product_id]?.purchase_price ?? 0),
      0,
    );
    const completed = Number(workOrder?.completed_quantity ?? 0);
    const totalReceived = completed * bomUnitCost;
    return {
      totalConsumed,
      totalReceived,
      wipBalance: totalConsumed - totalReceived,
      costPerUnit: completed > 0 ? totalConsumed / completed : bomUnitCost,
    };
  }, [lines, productsById, workOrder, bomUnitCost]);

  if (!hasManufacturing) {
    return (
      <CapabilityGate capability="manufacturing">
        <div />
      </CapabilityGate>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          {t('common.loading')}
        </div>
      </div>
    );
  }

  if (error || !workOrder) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-6">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          {error ?? t('common.error')}
        </div>
      </div>
    );
  }

  const actions = workOrderActions(workOrder.status);
  const pct = workOrderProgressPct(workOrder);
  const yieldPct = workOrderYieldPct(workOrder);
  const product = productsById[workOrder.product_id];
  const canRecord = workOrder.status === 'released' || workOrder.status === 'in_progress';

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6">
      <Link
        to="/manufacturing/production"
        className="mb-3 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('manufacturing.wo.title')}
      </Link>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="mb-5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-semibold text-gray-900">{workOrder.work_order_number}</h1>
              <span
                className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${workOrderStatusClass(workOrder.status)}`}
                data-testid="status-badge"
              >
                {t(`manufacturing.wo.status.${workOrderStatusKey(workOrder.status)}`)}
              </span>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {t('manufacturing.wo.outputProduct')}:{' '}
              <span className="font-medium text-gray-800">{product?.name ?? workOrder.product_id.slice(0, 8)}</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2" data-testid="status-actions">
            {actions.release && (
              <HeaderAction
                label={t('manufacturing.wo.release')}
                icon={<Play className="h-4 w-4" />}
                busy={actionLoading === 'manufacturing_wo_release'}
                onClick={() => runCommand('manufacturing_wo_release', 'manufacturing.wo.confirmRelease', { p_work_order_id: workOrder.id })}
              />
            )}
            {actions.start && (
              <HeaderAction
                label={t('manufacturing.wo.start')}
                icon={<Play className="h-4 w-4" />}
                busy={actionLoading === 'manufacturing_wo_start'}
                onClick={() => runCommand('manufacturing_wo_start', null, { p_work_order_id: workOrder.id })}
              />
            )}
            {actions.complete && (
              <HeaderAction
                label={t('manufacturing.wo.complete')}
                icon={<CheckCircle2 className="h-4 w-4" />}
                busy={actionLoading === 'manufacturing_wo_complete'}
                onClick={() => runCommand('manufacturing_wo_complete', 'manufacturing.wo.confirmComplete', { p_work_order_id: workOrder.id })}
              />
            )}
            {actions.close && (
              <HeaderAction
                label={t('manufacturing.wo.close')}
                icon={<Lock className="h-4 w-4" />}
                busy={actionLoading === 'manufacturing_wo_close'}
                onClick={() => runCommand('manufacturing_wo_close', null, { p_work_order_id: workOrder.id })}
              />
            )}
            {actions.cancel && (
              <button
                type="button"
                disabled={!!actionLoading}
                onClick={() => runCommand('manufacturing_wo_cancel', 'manufacturing.wo.confirmCancel', { p_work_order_id: workOrder.id })}
                className="inline-flex items-center gap-2 rounded-xl border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                <XCircle className="h-4 w-4" />
                {t('manufacturing.wo.cancel')}
              </button>
            )}
          </div>
        </div>

        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">
              {t('manufacturing.wo.progress')}
            </dt>
            <dd className="mt-1">
              <div className="flex items-center gap-2">
                <div
                  className="h-2 w-32 overflow-hidden rounded-full bg-gray-200"
                  role="progressbar"
                  aria-valuenow={Math.round(pct)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={t('manufacturing.wo.progress')}
                >
                  <div className="h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-sm text-gray-700">
                  {number(workOrder.completed_quantity)} / {number(workOrder.planned_quantity)}
                </span>
              </div>
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">{t('manufacturing.wo.yield')}</dt>
            <dd className="mt-1 text-sm text-gray-800">{yieldPct == null ? '—' : `${yieldPct.toFixed(1)}%`}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">
              {t('manufacturing.wo.scrappedQuantity')}
            </dt>
            <dd className="mt-1 text-sm text-gray-800">{number(workOrder.scrapped_quantity)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">
              {t('manufacturing.wo.plannedStart')} → {t('manufacturing.wo.actualStart')}
            </dt>
            <dd className="mt-1 text-sm text-gray-800">
              {formatDate(workOrder.planned_start_date)} → {formatDateTime(workOrder.actual_start_date)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">
              {t('manufacturing.wo.plannedEnd')} → {t('manufacturing.wo.actualEnd')}
            </dt>
            <dd className="mt-1 text-sm text-gray-800">
              {formatDate(workOrder.planned_end_date)} → {formatDateTime(workOrder.actual_end_date)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">
              {t('manufacturing.wo.sourceLocation')}
            </dt>
            <dd className="mt-1 text-sm text-gray-800">
              {workOrder.from_location_id ? locationsById[workOrder.from_location_id]?.name ?? '—' : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">
              {t('manufacturing.wo.destinationLocation')}
            </dt>
            <dd className="mt-1 text-sm text-gray-800">
              {workOrder.to_location_id ? locationsById[workOrder.to_location_id]?.name ?? '—' : '—'}
            </dd>
          </div>
        </dl>
      </header>

      {/* ── Cost summary ───────────────────────────────────────────────────── */}
      <section className="mb-5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">{t('manufacturing.wo.costSummary')}</h2>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">
              {t('manufacturing.wo.totalConsumed')}
            </dt>
            <dd className="mt-1 text-sm font-medium text-gray-900">{money(totals.totalConsumed)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">
              {t('manufacturing.wo.totalReceived')}
            </dt>
            <dd className="mt-1 text-sm font-medium text-gray-900">{money(totals.totalReceived)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">
              {t('manufacturing.wo.wipBalance')}
            </dt>
            <dd className="mt-1 text-sm font-medium text-gray-900">{money(totals.wipBalance)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">
              {t('manufacturing.wo.costPerUnit')}
            </dt>
            <dd className="mt-1 text-sm font-medium text-gray-900">{money(totals.costPerUnit)}</dd>
          </div>
        </dl>
      </section>

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-3">
          <TabButton active={tab === 'materials'} onClick={() => setTab('materials')} data-testid="tab-materials">
            <Package className="h-4 w-4" />
            {t('manufacturing.wo.materials')}
          </TabButton>
          <TabButton active={tab === 'runs'} onClick={() => setTab('runs')} data-testid="tab-runs">
            <Factory className="h-4 w-4" />
            {t('manufacturing.wo.productionRuns')}
          </TabButton>
          <TabButton
            active={tab === 'transactions'}
            onClick={() => setTab('transactions')}
            data-testid="tab-transactions"
          >
            <CircleDot className="h-4 w-4" />
            {t('manufacturing.wo.transactions')}
          </TabButton>

          <div className="ml-auto flex flex-wrap gap-2">
            {canRecord && (
              <>
                <button
                  type="button"
                  onClick={() => setShowRunModal(true)}
                  className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700"
                  data-testid="record-run-button"
                >
                  <Factory className="h-4 w-4" />
                  {t('manufacturing.wo.recordRun')}
                </button>
                <button
                  type="button"
                  onClick={() => setShowConsumptionModal(true)}
                  className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  data-testid="record-consumption-button"
                >
                  <Package className="h-4 w-4" />
                  {t('manufacturing.wo.recordConsumption')}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="overflow-x-auto p-4">
          {tab === 'materials' ? (
            <MaterialsTab lines={lines} productsById={productsById} t={t} />
          ) : tab === 'runs' ? (
            <RunsTab runs={runs} t={t} />
          ) : (
            <TransactionsTab
              transactions={transactions}
              runs={runs}
              productsById={productsById}
              locationsById={locationsById}
              t={t}
            />
          )}
        </div>
      </section>

      {/* ── Notes ──────────────────────────────────────────────────────────── */}
      <section className="mt-5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-gray-900">{t('common.details')}</h2>
        {workOrder.status === 'draft' ? (
          <>
            <textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900"
              data-testid="notes-textarea"
            />
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                disabled={savingNotes}
                onClick={saveNotes}
                className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {t('common.save')}
              </button>
            </div>
          </>
        ) : (
          <p className="text-sm text-gray-700" data-testid="notes-readonly">
            {workOrder.notes || '—'}
          </p>
        )}
      </section>

      {showRunModal && (
        <RecordRunModal
          workOrder={workOrder}
          onClose={() => setShowRunModal(false)}
          onSaved={async () => {
            setShowRunModal(false);
            await fetchAll();
          }}
        />
      )}
      {showConsumptionModal && (
        <RecordConsumptionModal
          workOrder={workOrder}
          lines={lines}
          productsById={productsById}
          runs={runs}
          onClose={() => setShowConsumptionModal(false)}
          onSaved={async () => {
            setShowConsumptionModal(false);
            await fetchAll();
          }}
        />
      )}
    </div>
  );
}

// ── Tabs ────────────────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  children,
  ...rest
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
} & Record<string, unknown>) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm font-medium ${
        active ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-50'
      }`}
      {...rest}
    >
      {children}
    </button>
  );
}

function MaterialsTab({
  lines,
  productsById,
  t,
}: {
  lines: LineRow[];
  productsById: Record<string, ProductRow>;
  t: (key: string) => string;
}) {
  if (lines.length === 0) {
    return <p className="p-4 text-sm text-gray-500">{t('manufacturing.wo.emptyState')}</p>;
  }
  return (
    <table className="w-full text-left text-sm">
      <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
        <tr>
          <th className="px-4 py-3">{t('manufacturing.bom.component')}</th>
          <th className="px-4 py-3">{t('manufacturing.wo.planned')}</th>
          <th className="px-4 py-3">{t('manufacturing.wo.actual')}</th>
          <th className="px-4 py-3">{t('manufacturing.wo.variance')}</th>
          <th className="px-4 py-3">{t('manufacturing.bom.unitCost')}</th>
          <th className="px-4 py-3">{t('manufacturing.bom.lineCost')}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {lines.map((line) => {
          const product = productsById[line.component_product_id];
          const unitCost = Number(product?.purchase_price ?? 0);
          const variance = Number(line.actual_quantity_consumed) - Number(line.planned_quantity);
          const over = variance > 0;
          return (
            <tr key={line.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 text-gray-900">
                {product?.name ?? line.component_product_id.slice(0, 8)}
              </td>
              <td className="px-4 py-3 text-gray-700">{number(line.planned_quantity)}</td>
              <td className="px-4 py-3 text-gray-700">{number(line.actual_quantity_consumed)}</td>
              <td className={`px-4 py-3 ${over ? 'font-medium text-red-600' : 'text-gray-700'}`}>
                {variance > 0 ? '+' : ''}
                {number(variance)}
                {over ? (
                  <span className="ml-1 inline-flex items-center gap-1 text-xs text-red-600">
                    <AlertTriangle className="h-3 w-3" aria-hidden />
                    {t('manufacturing.wo.overConsumption')}
                  </span>
                ) : null}
              </td>
              <td className="px-4 py-3 text-gray-700">{money(unitCost)}</td>
              <td className="px-4 py-3 text-gray-700">
                {money(Number(line.actual_quantity_consumed) * unitCost)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function RunsTab({ runs, t }: { runs: RunRow[]; t: (key: string) => string }) {
  if (runs.length === 0) {
    return <p className="p-4 text-sm text-gray-500">{t('manufacturing.wo.emptyState')}</p>;
  }
  return (
    <table className="w-full text-left text-sm">
      <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
        <tr>
          <th className="px-4 py-3">{t('manufacturing.wo.runNumber')}</th>
          <th className="px-4 py-3">{t('manufacturing.wo.outputQty')}</th>
          <th className="px-4 py-3">{t('manufacturing.wo.scrapQty')}</th>
          <th className="px-4 py-3">{t('manufacturing.wo.yield')}</th>
          <th className="px-4 py-3">{t('common.date')}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {runs.map((run) => {
          const produced = Number(run.output_quantity) + Number(run.scrap_quantity);
          const runYield = produced > 0 ? (Number(run.output_quantity) / produced) * 100 : null;
          return (
            <tr key={run.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 text-gray-900">{run.run_number}</td>
              <td className="px-4 py-3 text-gray-700">{number(run.output_quantity)}</td>
              <td className="px-4 py-3 text-gray-700">{number(run.scrap_quantity)}</td>
              <td className="px-4 py-3 text-gray-700">
                {runYield == null ? '—' : `${runYield.toFixed(1)}%`}
              </td>
              <td className="px-4 py-3 text-gray-500">{formatDateTime(run.completed_at)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function TransactionsTab({
  transactions,
  runs,
  productsById,
  locationsById,
  t,
}: {
  transactions: TxnRow[];
  runs: RunRow[];
  productsById: Record<string, ProductRow>;
  locationsById: Record<string, LocationRow>;
  t: (key: string) => string;
}) {
  if (transactions.length === 0) {
    return <p className="p-4 text-sm text-gray-500">{t('manufacturing.wo.emptyState')}</p>;
  }
  const runNumberById = new Map(runs.map((r) => [r.id, r.run_number]));
  return (
    <table className="w-full text-left text-sm">
      <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
        <tr>
          <th className="px-4 py-3">{t('manufacturing.bom.component')}</th>
          <th className="px-4 py-3">{t('manufacturing.bom.quantity')}</th>
          <th className="px-4 py-3">{t('common.status')}</th>
          <th className="px-4 py-3">{t('manufacturing.wo.runNumber')}</th>
          <th className="px-4 py-3">{t('manufacturing.wo.sourceLocation')}</th>
          <th className="px-4 py-3">{t('common.date')}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {transactions.map((txn) => (
          <tr key={txn.id} className="hover:bg-gray-50">
            <td className="px-4 py-3 text-gray-900">
              {productsById[txn.component_product_id]?.name ?? txn.component_product_id.slice(0, 8)}
            </td>
            <td className="px-4 py-3 text-gray-700">{number(txn.quantity)}</td>
            <td className="px-4 py-3 text-gray-700">{txn.transaction_type}</td>
            <td className="px-4 py-3 text-gray-700">
              {txn.run_id ? (runNumberById.get(txn.run_id) ?? '—') : '—'}
            </td>
            <td className="px-4 py-3 text-gray-700">
              {txn.from_location_id
                ? locationsById[txn.from_location_id]?.name ?? '—'
                : txn.to_location_id
                  ? locationsById[txn.to_location_id]?.name ?? '—'
                  : '—'}
            </td>
            <td className="px-4 py-3 text-gray-500">{formatDateTime(txn.recorded_at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Modals ──────────────────────────────────────────────────────────────────

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-gray-900">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function RecordRunModal({
  workOrder,
  onClose,
  onSaved,
}: {
  workOrder: WorkOrderRow;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [outputQty, setOutputQty] = useState('');
  const [scrapQty, setScrapQty] = useState('0');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const output = Number(outputQty);
  const wouldExceed = Number.isFinite(output) &&
    Number(workOrder.completed_quantity) + output > Number(workOrder.planned_quantity) * 1.1;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error: rpcError } = await sb.rpc('manufacturing_wo_record_run', {
        p_work_order_id: workOrder.id,
        p_output_qty: output,
        p_scrap_qty: Number(scrapQty || 0),
        p_notes: notes || null,
      });
      if (rpcError) throw rpcError;
      await onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Modal title={t('manufacturing.wo.recordRun')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">
            {t('manufacturing.wo.outputQty')}
          </span>
          <input
            type="number"
            min="0.000001"
            step="any"
            required
            value={outputQty}
            onChange={(e) => setOutputQty(e.target.value)}
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
            data-testid="run-output-input"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">
            {t('manufacturing.wo.scrapQty')}
          </span>
          <input
            type="number"
            min="0"
            step="any"
            value={scrapQty}
            onChange={(e) => setScrapQty(e.target.value)}
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
            data-testid="run-scrap-input"
          />
        </label>
        {wouldExceed ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {t('manufacturing.wo.overproductionWarning')}
          </p>
        ) : null}
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">{t('common.details')}</span>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
          />
        </label>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={busy || !outputQty || Number(output) <= 0}
            className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            data-testid="run-submit-button"
          >
            {t('common.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RecordConsumptionModal({
  workOrder,
  lines,
  productsById,
  runs,
  onClose,
  onSaved,
}: {
  workOrder: WorkOrderRow;
  lines: LineRow[];
  productsById: Record<string, ProductRow>;
  runs: RunRow[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [componentId, setComponentId] = useState(lines[0]?.component_product_id ?? '');
  const [quantity, setQuantity] = useState('');
  const [runId, setRunId] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error: rpcError } = await sb.rpc('manufacturing_wo_record_consumption', {
        p_work_order_id: workOrder.id,
        p_run_id: runId || null,
        p_component_id: componentId,
        p_quantity: Number(quantity),
        p_from_location_id: workOrder.from_location_id ?? null,
        p_notes: notes || null,
      });
      if (rpcError) throw rpcError;
      await onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Modal title={t('manufacturing.wo.recordConsumption')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">
            {t('manufacturing.bom.component')}
          </span>
          <select
            value={componentId}
            onChange={(e) => setComponentId(e.target.value)}
            required
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
            data-testid="consumption-component-select"
          >
            {lines.map((line) => (
              <option key={line.id} value={line.component_product_id}>
                {productsById[line.component_product_id]?.name ?? line.component_product_id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">
            {t('manufacturing.bom.quantity')}
          </span>
          <input
            type="number"
            min="0.000001"
            step="any"
            required
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
            data-testid="consumption-quantity-input"
          />
        </label>
        {runs.length > 0 ? (
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">
              {t('manufacturing.wo.runNumber')} ({t('common.optional')})
            </span>
            <select
              value={runId}
              onChange={(e) => setRunId(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
            >
              <option value="">{t('common.none')}</option>
              {runs.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.run_number}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700">{t('common.details')}</span>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
          />
        </label>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={busy || !componentId || Number(quantity) <= 0}
            className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            data-testid="consumption-submit-button"
          >
            {t('common.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function HeaderAction({
  label,
  icon,
  busy,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
    >
      {icon}
      {label}
    </button>
  );
}

export default WorkOrderDetailPage;
