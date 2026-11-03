import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { repos } from '@/lib/repositories';
import {
  PROJECT_STATUSES,
  type ProjectStatus,
  type RetentionAgingRow,
} from '@/dal/repositories/ProjectRepository';
import {
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  SectionCard,
} from '../constructionUi';
import { ProjectStatusBadge } from '../projects/ProjectsSection';

const rk = 'construction.reports.retentionAging';

function retentionAgeRowClass(daysHeld: number): string {
  if (daysHeld > 365) return 'bg-red-50 text-red-900';
  if (daysHeld > 180) return 'bg-yellow-50 text-yellow-900';
  return '';
}

function retentionAgeBadgeClass(daysHeld: number): string {
  if (daysHeld > 365) return 'bg-red-100 text-red-800 font-semibold';
  if (daysHeld > 180) return 'bg-yellow-100 text-yellow-800 font-semibold';
  return 'bg-gray-100 text-gray-700';
}

function formatMoney(value: number): string {
  return Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDateOnly(isoOrDate: string | null | undefined): string {
  if (!isoOrDate) return '—';
  return String(isoOrDate).slice(0, 10);
}

export function RetentionAgingReport({
  businessId,
}: {
  businessId: string;
  capabilities?: string[];
}) {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | ''>('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  const query = useQuery({
    queryKey: ['construction', 'retention-aging', businessId],
    queryFn: () => repos.projects.getRetentionAging(businessId),
    enabled: Boolean(businessId),
  });

  const rows: RetentionAgingRow[] = useMemo(
    () => query.data ?? [],
    [query.data],
  );

  const filteredRows = useMemo(() => {
    const byStatus = statusFilter
      ? rows.filter((row) => row.project_status === statusFilter)
      : rows;
    return [...byStatus].sort((a, b) =>
      sortOrder === 'desc'
        ? b.days_held - a.days_held
        : a.days_held - b.days_held,
    );
  }, [rows, statusFilter, sortOrder]);

  const summary = useMemo(() => {
    const totalRetentionHeld = filteredRows.reduce(
      (sum, row) => sum + Number(row.retention_balance || 0),
      0,
    );
    const projectCount = filteredRows.length;
    const avgDaysHeld =
      projectCount > 0
        ? Math.round(
            filteredRows.reduce(
              (sum, row) => sum + Number(row.days_held || 0),
              0,
            ) / projectCount,
          )
        : 0;
    return { totalRetentionHeld, projectCount, avgDaysHeld };
  }, [filteredRows]);

  if (query.isLoading) {
    return <LoadingBlock label={t(`${rk}.loading`)} />;
  }

  if (query.isError) {
    return (
      <ErrorBanner
        message={
          query.error instanceof Error ? query.error.message : t('construction.projects.error')
        }
      />
    );
  }

  return (
    <SectionCard
      title={t(`${rk}.title`)}
      description={t(`${rk}.description`)}
    >
      <div className="mb-5 grid gap-4 sm:grid-cols-3" data-testid="retention-aging-summary">
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            {t(`${rk}.summary.totalRetentionHeld`)}
          </p>
          <p className="mt-1 text-xl font-bold text-gray-900">
            {formatMoney(summary.totalRetentionHeld)}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            {t(`${rk}.summary.projectsWithRetention`)}
          </p>
          <p className="mt-1 text-xl font-bold text-gray-900">
            {summary.projectCount}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            {t(`${rk}.summary.averageDaysHeld`)}
          </p>
          <p className="mt-1 text-xl font-bold text-gray-900">
            {t(`${rk}.summary.daysUnit`, { days: summary.avgDaysHeld })}
          </p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <label className="text-sm text-gray-700">
            {t(`${rk}.filterStatus`)}
            <select
              aria-label={t(`${rk}.filterStatus`)}
              className="ml-2 rounded border border-gray-300 px-2.5 py-1.5 text-sm"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as ProjectStatus | '')
              }
            >
              <option value="">{t(`${rk}.allStatuses`)}</option>
              {PROJECT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(`construction.projects.statuses.${status}`)}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-gray-700">
            {t(`${rk}.sortByDays`)}
            <select
              aria-label={t(`${rk}.sortByDays`)}
              className="ml-2 rounded border border-gray-300 px-2.5 py-1.5 text-sm"
              value={sortOrder}
              onChange={(event) =>
                setSortOrder(event.target.value as 'desc' | 'asc')
              }
            >
              <option value="desc">{t(`${rk}.sortDesc`)}</option>
              <option value="asc">{t(`${rk}.sortAsc`)}</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-gray-300" />
            {t(`${rk}.thresholds.normal`)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
            {t(`${rk}.thresholds.warning`)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
            {t(`${rk}.thresholds.critical`)}
          </span>
        </div>
      </div>

      {filteredRows.length === 0 ? (
        <EmptyState title={t(`${rk}.empty`)} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <th className="p-2.5">{t(`${rk}.columns.project`)}</th>
                <th className="p-2.5">{t(`${rk}.columns.client`)}</th>
                <th className="p-2.5">{t(`${rk}.columns.status`)}</th>
                <th className="p-2.5 text-right">{t(`${rk}.columns.retentionBalance`)}</th>
                <th className="p-2.5">{t(`${rk}.columns.oldestEntry`)}</th>
                <th className="p-2.5 text-right">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-900"
                    onClick={() =>
                      setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))
                    }
                  >
                    {t(`${rk}.columns.daysHeld`)}
                    <span aria-hidden>{sortOrder === 'desc' ? '↓' : '↑'}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr
                  key={row.project_id}
                  data-testid={`retention-row-${row.project_id}`}
                  className={`border-t border-gray-200 ${retentionAgeRowClass(Number(row.days_held))}`}
                >
                  <td className="p-2.5 font-medium">
                    <Link
                      className="text-brand-700 underline"
                      to={`/construction/projects/${row.project_id}`}
                    >
                      {row.project_name}
                    </Link>
                  </td>
                  <td className="p-2.5">{row.client_name}</td>
                  <td className="p-2.5">
                    <ProjectStatusBadge status={row.project_status} />
                  </td>
                  <td className="p-2.5 text-right font-medium">
                    {formatMoney(Number(row.retention_balance))}
                  </td>
                  <td className="p-2.5">
                    {formatDateOnly(row.oldest_retention_date)}
                  </td>
                  <td className="p-2.5 text-right">
                    <span
                      data-testid={`retention-days-${row.project_id}`}
                      className={`inline-block rounded-full px-2.5 py-0.5 text-xs ${retentionAgeBadgeClass(Number(row.days_held))}`}
                    >
                      {row.days_held}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}
