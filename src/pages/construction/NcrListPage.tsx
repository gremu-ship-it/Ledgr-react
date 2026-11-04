import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Plus } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import type { ConstructionNcrSeverity, ConstructionNcrStatus } from '@/dal/repositories/ConstructionQualityRepository';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';
import { loadAllProjects } from './qualityPageData';

const K = 'construction.ncrs';
const STATUSES: ConstructionNcrStatus[] = ['open', 'investigating', 'corrective_action', 'closed', 'cancelled'];
const SEVERITIES: ConstructionNcrSeverity[] = ['minor', 'major', 'critical'];
const STATUS_CLASSES: Record<ConstructionNcrStatus, string> = {
  open: 'bg-red-100 text-red-800',
  investigating: 'bg-blue-100 text-blue-800',
  corrective_action: 'bg-orange-100 text-orange-800',
  closed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-slate-100 text-slate-700',
};
const SEVERITY_CLASSES: Record<ConstructionNcrSeverity, string> = {
  minor: 'bg-yellow-100 text-yellow-800',
  major: 'bg-orange-100 text-orange-800',
  critical: 'bg-red-100 text-red-800',
};

function displayDate(value: string, locale: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}

export function NcrListPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const businessId = useAppStore((state) => state.currentBusiness?.business?.id ?? null);
  const [projectId, setProjectId] = useState('all');
  const [status, setStatus] = useState<'all' | ConstructionNcrStatus>('all');
  const [severity, setSeverity] = useState<'all' | ConstructionNcrSeverity>('all');
  const projectsQuery = useQuery({
    queryKey: ['construction', 'quality-projects', businessId],
    queryFn: () => loadAllProjects(businessId as string),
    enabled: Boolean(businessId),
  });
  const ncrsQuery = useQuery({
    queryKey: ['construction', 'ncrs', businessId, projectId, status, severity],
    queryFn: () => repos.quality.listNcrs(businessId as string, {
      projectId: projectId === 'all' ? undefined : projectId,
      status: status === 'all' ? undefined : status,
      severity: severity === 'all' ? undefined : severity,
    }),
    enabled: Boolean(businessId),
  });
  const projectNames = useMemo(() => new Map((projectsQuery.data ?? []).map((project) => [project.id, project.name])), [projectsQuery.data]);
  const loading = projectsQuery.isLoading || ncrsQuery.isLoading;
  const hasError = projectsQuery.isError || ncrsQuery.isError;
  const ncrs = ncrsQuery.data ?? [];

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t(`${K}.title`)}</h1>
          <p className="mt-1 text-sm text-gray-600">{t(`${K}.description`)}</p>
        </div>
        <Button type="button" onClick={() => navigate('/construction/ncrs/new')}>
          <Plus className="h-4 w-4" aria-hidden="true" />{t(`${K}.actions.new`)}
        </Button>
      </header>

      <section aria-label={t(`${K}.filters.title`)} className="grid gap-3 rounded-xl border border-gray-200 bg-white p-4 sm:grid-cols-3">
        <label className="block text-sm font-medium text-gray-700">
          {t(`${K}.fields.project`)}
          <select className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            <option value="all">{t(`${K}.filters.allProjects`)}</option>
            {(projectsQuery.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium text-gray-700">
          {t(`${K}.fields.status`)}
          <select className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" value={status} onChange={(event) => setStatus(event.target.value as 'all' | ConstructionNcrStatus)}>
            <option value="all">{t(`${K}.filters.allStatuses`)}</option>
            {STATUSES.map((value) => <option key={value} value={value}>{t(`${K}.statuses.${value}`)}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium text-gray-700">
          {t(`${K}.fields.severity`)}
          <select className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" value={severity} onChange={(event) => setSeverity(event.target.value as 'all' | ConstructionNcrSeverity)}>
            <option value="all">{t(`${K}.filters.allSeverities`)}</option>
            {SEVERITIES.map((value) => <option key={value} value={value}>{t(`${K}.severities.${value}`)}</option>)}
          </select>
        </label>
      </section>

      {hasError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t(`${K}.errors.load`)}</p> : null}
      {loading ? <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">{t(`${K}.loading`)}</div> : null}
      {!loading && !hasError && ncrs.length === 0 ? (
        <EmptyState icon={AlertTriangle} title={t(`${K}.empty.title`)} description={t(`${K}.empty.description`)} actionLabel={t(`${K}.actions.new`)} onAction={() => navigate('/construction/ncrs/new')} />
      ) : null}
      {!loading && !hasError && ncrs.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-4 py-3">{t(`${K}.columns.number`)}</th>
                <th scope="col" className="px-4 py-3">{t(`${K}.columns.title`)}</th>
                <th scope="col" className="px-4 py-3">{t(`${K}.columns.project`)}</th>
                <th scope="col" className="px-4 py-3">{t(`${K}.columns.severity`)}</th>
                <th scope="col" className="px-4 py-3">{t(`${K}.columns.status`)}</th>
                <th scope="col" className="px-4 py-3">{t(`${K}.columns.raised`)}</th>
                <th scope="col" className="px-4 py-3">{t(`${K}.columns.created`)}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {ncrs.map((ncr) => (
                <tr
                  key={ncr.id}
                  role="link"
                  tabIndex={0}
                  aria-label={t(`${K}.openNcr`, { number: ncr.ncr_number })}
                  className="cursor-pointer hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
                  onClick={() => navigate(`/construction/ncrs/${ncr.id}`)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      navigate(`/construction/ncrs/${ncr.id}`);
                    }
                  }}
                >
                  <td className="whitespace-nowrap px-4 py-3 font-semibold text-brand-700">{ncr.ncr_number}</td>
                  <td className="min-w-52 px-4 py-3 text-gray-900">{ncr.title}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">{projectNames.get(ncr.project_id) ?? t('common.unknown')}</td>
                  <td className="whitespace-nowrap px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${SEVERITY_CLASSES[ncr.severity]}`}>{t(`${K}.severities.${ncr.severity}`)}</span></td>
                  <td className="whitespace-nowrap px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASSES[ncr.status]}`}>{t(`${K}.statuses.${ncr.status}`)}</span></td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">{t(`${K}.teamMember`)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">{displayDate(ncr.created_at, i18n.language)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  );
}
