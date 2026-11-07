import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  DollarSign,
  LoaderCircle,
  RotateCcw,
  ShoppingBag,
  TrendingUp,
} from 'lucide-react';
import { formatMwkDetailed } from '@/lib/formatters';
import { usePosOwnerAnalytics, type PosAnalyticsRange } from '@/hooks/usePosOwnerAnalytics';

interface PosOwnerAnalyticsProps {
  businessId?: string;
  currentBranchId?: string;
  branches?: Array<{ id: string; name: string }>;
}

function LoadingCards({ label }: { label: string }) {
  return (
    <div aria-label={label} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="h-32 animate-pulse rounded-3xl border border-gray-200 bg-white p-5">
          <div className="mb-5 h-3 w-2/3 rounded bg-gray-100" />
          <div className="h-7 w-4/5 rounded bg-gray-100" />
        </div>
      ))}
    </div>
  );
}

export function PosOwnerAnalytics({ businessId, currentBranchId, branches = [] }: PosOwnerAnalyticsProps) {
  const { t } = useTranslation();
  const [dateRange, setDateRange] = useState<PosAnalyticsRange>('today');
  const [selectedBranch, setSelectedBranch] = useState<string>(currentBranchId || 'all');
  const query = usePosOwnerAnalytics(businessId, selectedBranch === 'all' ? null : selectedBranch, dateRange);
  const analytics = query.data;
  const paymentBreakdown = Object.entries(analytics?.payment_breakdown ?? {})
    .sort(([, left], [, right]) => right.total - left.total);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex flex-col items-start justify-between gap-4 border-b border-gray-200 pb-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-black tracking-tight text-gray-900">
            <TrendingUp className="h-6 w-6 text-brand-600" />
            {t('pos.analytics.title')}
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">{t('pos.analytics.description')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {branches.length > 0 && (
            <label className="sr-only" htmlFor="pos-analytics-branch">{t('pos.analytics.branchFilter')}</label>
          )}
          {branches.length > 0 && (
            <select
              id="pos-analytics-branch"
              aria-label={t('pos.analytics.branchFilter')}
              value={selectedBranch}
              onChange={(event) => setSelectedBranch(event.target.value)}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 shadow-2xs focus:border-brand-500 focus:outline-none"
            >
              <option value="all">{t('pos.analytics.allBranches')}</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          )}

          <div aria-label={t('pos.analytics.dateRange')} className="flex rounded-xl bg-gray-100 p-1">
            {(['today', '7d', '30d', 'all_time'] as const).map((range) => (
              <button
                key={range}
                type="button"
                aria-pressed={dateRange === range}
                onClick={() => setDateRange(range)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${dateRange === range ? 'bg-white text-gray-900 shadow-2xs' : 'text-gray-500 hover:text-gray-900'}`}
              >
                {t(`pos.analytics.ranges.${range}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {query.isLoading ? (
        <LoadingCards label={t('pos.analytics.loading')} />
      ) : query.isError ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-bold">{t('pos.analytics.loadError')}</p>
              <button
                type="button"
                onClick={() => void query.refetch()}
                className="mt-3 inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-3 py-2 text-xs font-bold hover:bg-red-50"
              >
                {query.isFetching && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
                {t('common.retry')}
              </button>
            </div>
          </div>
        </div>
      ) : !analytics || analytics.order_count === 0 ? (
        <div role="status" className="rounded-2xl border border-gray-200 bg-white px-6 py-12 text-center text-sm font-semibold text-gray-500">
          {t('pos.analytics.empty')}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard title={t('pos.analytics.grossSales')} value={formatMwkDetailed(analytics.gross_sales)} icon={<DollarSign className="h-4 w-4" />} />
            <MetricCard title={t('pos.analytics.netSales')} value={formatMwkDetailed(analytics.net_sales)} icon={<TrendingUp className="h-4 w-4" />} />
            <MetricCard title={t('pos.analytics.averageTicket')} value={formatMwkDetailed(analytics.average_ticket)} icon={<ShoppingBag className="h-4 w-4" />} />
            <MetricCard title={t('pos.analytics.discounts')} value={formatMwkDetailed(analytics.discount_total)} icon={<RotateCcw className="h-4 w-4" />} />
            <MetricCard title={t('pos.analytics.orders')} value={t('pos.analytics.orderCount', { count: analytics.order_count })} icon={<ShoppingBag className="h-4 w-4" />} />
            <MetricCard title={t('pos.analytics.returns')} value={t('pos.analytics.returnCount', { count: analytics.return_count })} detail={formatMwkDetailed(analytics.refunds_total)} icon={<RotateCcw className="h-4 w-4" />} />
          </div>

          <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-2xs">
            <h3 className="mb-4 text-sm font-black uppercase tracking-wider text-gray-900">
              {t('pos.analytics.paymentBreakdown')}
            </h3>
            {paymentBreakdown.length === 0 ? (
              <p className="py-3 text-center text-xs text-gray-500">{t('pos.analytics.noPayments')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-gray-100 text-[10px] font-bold uppercase text-gray-400">
                    <tr>
                      <th className="px-3 py-2.5">{t('pos.analytics.paymentMethod')}</th>
                      <th className="px-3 py-2.5">{t('pos.analytics.paymentCount')}</th>
                      <th className="px-3 py-2.5">{t('pos.analytics.paymentTotal')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 font-semibold text-gray-800">
                    {paymentBreakdown.map(([method, values]) => (
                      <tr key={method}>
                        <td className="px-3 py-3 font-bold">{t(`pos.paymentMethods.${method}`, { defaultValue: method })}</td>
                        <td className="px-3 py-3">{values.count}</td>
                        <td className="px-3 py-3 font-black text-brand-700">{formatMwkDetailed(values.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function MetricCard({ title, value, detail, icon }: { title: string; value: string; detail?: string; icon: ReactNode }) {
  return (
    <div className="space-y-2 rounded-3xl border border-gray-200 bg-white p-5 shadow-2xs">
      <div className="flex items-center justify-between text-gray-500">
        <span className="text-xs font-bold uppercase tracking-wider">{title}</span>
        <div className="rounded-xl bg-brand-50 p-2 text-brand-600">{icon}</div>
      </div>
      <p className="text-2xl font-black text-gray-900">{value}</p>
      {detail && <p className="text-[11px] font-semibold text-gray-500">{detail}</p>}
    </div>
  );
}
