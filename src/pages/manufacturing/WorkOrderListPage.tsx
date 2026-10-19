import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Plus, Eye, Play, CheckCircle2, Lock, XCircle, ClipboardList } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { supabase } from '@/lib/supabase';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as unknown as { from: (t: string) => any; rpc: (n: string, p: unknown) => any; auth: any };
import { useCapability } from '@/hooks/useCapability';
import { CapabilityGate } from '@/components/billing/CapabilityGate';
import {
  WORK_ORDER_STATUSES,
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

type ProductRow = { id: string; name: string };

const RPC_BY_ACTION = {
  release: 'manufacturing_wo_release',
  start: 'manufacturing_wo_start',
  complete: 'manufacturing_wo_complete',
  close: 'manufacturing_wo_close',
  cancel: 'manufacturing_wo_cancel',
} as const;

type ActionName = keyof typeof RPC_BY_ACTION;

/** A number rendered without trailing zeros: 10 not 10.00, 4.5 not 4.500000. */
function formatQuantity(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString();
}

export function WorkOrderListPage() {
  const { t } = useTranslation();
  const businessId = useAppStore((s) => s.currentBusiness?.business?.id);
  const hasManufacturing = useCapability('manufacturing');

  const [workOrders, setWorkOrders] = useState<WorkOrderRow[]>([]);
  const [productsById, setProductsById] = useState<Record<string, ProductRow>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [productSearch, setProductSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const fetchWorkOrders = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: qError } = await sb
        .from('manufacturing_work_orders')
        .select('*')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false });
      if (qError) throw qError;

      const rows = (data as WorkOrderRow[]) ?? [];
      setWorkOrders(rows);

      const productIds = [...new Set(rows.map((r) => r.product_id))];
      if (productIds.length === 0) {
        setProductsById({});
        return;
      }
      const { data: prodData } = await sb.from('products').select('id,name').in('id', productIds);
      const map: Record<string, ProductRow> = {};
      for (const p of (prodData as ProductRow[]) ?? []) map[p.id] = p;
      setProductsById(map);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchWorkOrders();
  }, [fetchWorkOrders]);

  const runAction = async (action: ActionName, workOrder: WorkOrderRow) => {
    if (!window.confirm(confirmationFor(action, t))) return;
    setActionLoading(`${action}:${workOrder.id}`);
    try {
      const { error: rpcError } = await sb.rpc(RPC_BY_ACTION[action], {
        p_work_order_id: workOrder.id,
      });
      if (rpcError) throw rpcError;
      await fetchWorkOrders();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(null);
    }
  };

  const visible = useMemo(() => {
    const needle = productSearch.trim().toLowerCase();
    return workOrders.filter((wo) => {
      if (statusFilter !== 'all' && wo.status !== statusFilter) return false;
      if (needle) {
        const name = productsById[wo.product_id]?.name ?? '';
        if (
          !name.toLowerCase().includes(needle) &&
          !wo.work_order_number.toLowerCase().includes(needle)
        ) {
          return false;
        }
      }
      // Date range is applied to the planned window: a work order is in range
      // when its planned window overlaps the filter window at all.
      const start = wo.planned_start_date ?? wo.created_at.slice(0, 10);
      if (fromDate && (wo.planned_end_date ?? start) < fromDate) return false;
      if (toDate && start > toDate) return false;
      return true;
    });
  }, [workOrders, productsById, statusFilter, productSearch, fromDate, toDate]);

  if (!hasManufacturing) {
    return (
      <CapabilityGate capability="manufacturing">
        <div />
      </CapabilityGate>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{t('manufacturing.wo.title')}</h1>
          <p className="text-sm text-gray-500">{t('manufacturing.title')}</p>
        </div>
        <Link
          to="/manufacturing/production/new"
          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          data-testid="create-work-order-button"
        >
          <Plus className="h-4 w-4" />
          {t('manufacturing.wo.create')}
        </Link>
      </header>

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-2xl border border-gray-200 bg-white p-4">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          {t('common.status')}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-800"
            data-testid="status-filter"
          >
            <option value="all">{t('common.all')}</option>
            {WORK_ORDER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`manufacturing.wo.status.${workOrderStatusKey(status)}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          {t('manufacturing.wo.outputProduct')}
          <input
            type="search"
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
            placeholder={t('manufacturing.wo.outputProduct')}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-800"
            data-testid="product-search"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          {t('manufacturing.wo.plannedStart')}
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-800"
            data-testid="from-date"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          {t('manufacturing.wo.plannedEnd')}
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-800"
            data-testid="to-date"
          />
        </label>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          {t('common.loading')}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{error}</div>
      ) : visible.length === 0 ? (
        <div
          className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center"
          data-testid="work-order-empty-state"
        >
          <ClipboardList className="mx-auto mb-3 h-8 w-8 text-gray-400" aria-hidden />
          <p className="mb-4 text-sm text-gray-600">{t('manufacturing.wo.emptyState')}</p>
          <Link
            to="/manufacturing/production/new"
            className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            <Plus className="h-4 w-4" />
            {t('manufacturing.wo.create')}
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">{t('manufacturing.wo.workOrderNumber')}</th>
                  <th className="px-4 py-3">{t('manufacturing.wo.outputProduct')}</th>
                  <th className="px-4 py-3">{t('common.status')}</th>
                  <th className="px-4 py-3">{t('manufacturing.wo.progress')}</th>
                  <th className="px-4 py-3">{t('manufacturing.wo.yield')}</th>
                  <th className="px-4 py-3">
                    {t('manufacturing.wo.plannedStart')} / {t('manufacturing.wo.plannedEnd')}
                  </th>
                  <th className="px-4 py-3">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.map((wo) => {
                  const product = productsById[wo.product_id];
                  const pct = workOrderProgressPct(wo);
                  const yieldPct = workOrderYieldPct(wo);
                  const actions = workOrderActions(wo.status);
                  return (
                    <tr key={wo.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <Link
                          to={`/manufacturing/production/${wo.id}`}
                          className="font-medium text-brand-700 hover:underline"
                          data-testid="work-order-link"
                        >
                          {wo.work_order_number}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-900">
                        {product?.name ?? wo.product_id.slice(0, 8)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${workOrderStatusClass(wo.status)}`}
                          data-testid={`status-badge-${wo.status}`}
                        >
                          {t(`manufacturing.wo.status.${workOrderStatusKey(wo.status)}`)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div
                            className="h-2 w-24 overflow-hidden rounded-full bg-gray-200"
                            role="progressbar"
                            aria-valuenow={Math.round(pct)}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={t('manufacturing.wo.progress')}
                          >
                            <div
                              className="h-full rounded-full bg-brand-600"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-600">
                            {formatQuantity(wo.completed_quantity)} / {formatQuantity(wo.planned_quantity)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {yieldPct == null ? '—' : `${yieldPct.toFixed(1)}%`}
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {formatDate(wo.planned_start_date)} – {formatDate(wo.planned_end_date)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2" data-testid="row-actions">
                          <Link
                            to={`/manufacturing/production/${wo.id}`}
                            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                            aria-label={`${t('common.view')} ${wo.work_order_number}`}
                          >
                            <Eye className="h-3.5 w-3.5" />
                            {t('common.view')}
                          </Link>
                          {actions.release && (
                            <ActionButton
                              label={t('manufacturing.wo.release')}
                              icon={<Play className="h-3.5 w-3.5" />}
                              busy={actionLoading === `release:${wo.id}`}
                              onClick={() => runAction('release', wo)}
                            />
                          )}
                          {actions.start && (
                            <ActionButton
                              label={t('manufacturing.wo.start')}
                              icon={<Play className="h-3.5 w-3.5" />}
                              busy={actionLoading === `start:${wo.id}`}
                              onClick={() => runAction('start', wo)}
                            />
                          )}
                          {actions.complete && (
                            <ActionButton
                              label={t('manufacturing.wo.complete')}
                              icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                              busy={actionLoading === `complete:${wo.id}`}
                              onClick={() => runAction('complete', wo)}
                            />
                          )}
                          {actions.close && (
                            <ActionButton
                              label={t('manufacturing.wo.close')}
                              icon={<Lock className="h-3.5 w-3.5" />}
                              busy={actionLoading === `close:${wo.id}`}
                              onClick={() => runAction('close', wo)}
                            />
                          )}
                          {actions.cancel && (
                            <button
                              type="button"
                              disabled={!!actionLoading}
                              onClick={() => runAction('cancel', wo)}
                              className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              {t('manufacturing.wo.cancel')}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionButton({
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
      className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * Destructive and irreversible steps confirm first; the two that simply advance
 * the documented forward-only lifecycle do not.
 */
function confirmationFor(
  action: ActionName,
  t: (key: string) => string,
): string | undefined {
  switch (action) {
    case 'release':
      return t('manufacturing.wo.confirmRelease');
    case 'complete':
      return t('manufacturing.wo.confirmComplete');
    case 'cancel':
      return t('manufacturing.wo.confirmCancel');
    default:
      return undefined; // no confirmation needed — window.confirm is skipped
  }
}

export default WorkOrderListPage;
