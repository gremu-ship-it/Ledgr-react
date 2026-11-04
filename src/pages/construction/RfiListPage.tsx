import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertCircle, MessageSquare, Plus } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import type { ConstructionRfiPriority, ConstructionRfiRow, ConstructionRfiStatus } from '@/dal/repositories/ConstructionRfiRepository';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';
import { loadAllProjects } from './rfiPageData';

const k = 'construction.rfis';
const EMPTY_RFIS: ConstructionRfiRow[] = [];
const statusClasses: Record<ConstructionRfiStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  open: 'bg-blue-100 text-blue-800',
  submitted: 'bg-sky-100 text-sky-800',
  answered: 'bg-emerald-100 text-emerald-800',
  closed: 'bg-slate-100 text-slate-700',
  cancelled: 'bg-red-100 text-red-800',
};
const priorityClasses: Record<ConstructionRfiPriority, string> = {
  low: 'bg-gray-100 text-gray-700',
  normal: 'bg-blue-100 text-blue-800',
  high: 'bg-orange-100 text-orange-800',
  urgent: 'bg-red-100 text-red-800',
};

function todayIso() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function formatDate(value: string | null, locale: string, missing: string) {
  if (!value) return missing;
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}

export function RfiListPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const businessId = useAppStore((state) => state.currentBusiness?.business?.id ?? null);
  const [projectId, setProjectId] = useState('all');
  const [status, setStatus] = useState<'all' | ConstructionRfiStatus>('all');
  const [priority, setPriority] = useState<'all' | ConstructionRfiPriority>('all');

  const projectsQuery = useQuery({
    queryKey: ['construction', 'rfi-projects', businessId],
    queryFn: () => loadAllProjects(businessId as string),
    enabled: Boolean(businessId),
  });
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  const rfisQuery = useQuery({
    queryKey: ['construction', 'rfis', businessId],
    queryFn: () => repos.rfi.listByBusiness(businessId as string),
    enabled: Boolean(businessId),
  });

  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);
  const rfis = rfisQuery.data ?? EMPTY_RFIS;
  const filtered = rfis.filter((rfi) =>
    (projectId === 'all' || rfi.project_id === projectId)
      && (status === 'all' || rfi.status === status)
      && (priority === 'all' || rfi.priority === priority),
  );

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t(`${k}.title`)}</h1>
          <p className="mt-1 text-sm text-gray-600">{t(`${k}.description`)}</p>
        </div>
        <Button type="button" onClick={() => navigate('/construction/rfis/new')}>
          <Plus className="h-4 w-4" aria-hidden="true" />{t(`${k}.actions.new`)}
        </Button>
      </header>

      <section aria-label={t(`${k}.filters.title`)} className="grid gap-3 rounded-xl border border-gray-200 bg-white p-4 sm:grid-cols-3">
        <label className="block text-sm font-medium text-gray-700">
          {t(`${k}.fields.project`)}
          <select className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            <option value="all">{t(`${k}.filters.allProjects`)}</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium text-gray-700">
          {t(`${k}.fields.status`)}
          <select className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" value={status} onChange={(event) => setStatus(event.target.value as 'all' | ConstructionRfiStatus)}>
            <option value="all">{t(`${k}.filters.allStatuses`)}</option>
            {(['draft', 'open', 'submitted', 'answered', 'closed', 'cancelled'] as const).map((value) => (
              <option key={value} value={value}>{t(`${k}.statuses.${value}`)}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-gray-700">
          {t(`${k}.fields.priority`)}
          <select className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" value={priority} onChange={(event) => setPriority(event.target.value as 'all' | ConstructionRfiPriority)}>
            <option value="all">{t(`${k}.filters.allPriorities`)}</option>
            {(['low', 'normal', 'high', 'urgent'] as const).map((value) => (
              <option key={value} value={value}>{t(`${k}.priorities.${value}`)}</option>
            ))}
          </select>
        </label>
      </section>

      {projectsQuery.isError || rfisQuery.isError ? (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t(`${k}.errors.load`)}</div>
      ) : null}
      {projectsQuery.isLoading || rfisQuery.isLoading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">{t(`${k}.loading`)}</div>
      ) : null}
      {!projectsQuery.isLoading && !rfisQuery.isLoading && !projectsQuery.isError && !rfisQuery.isError && filtered.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title={t(`${k}.empty.title`)}
          description={t(`${k}.empty.description`)}
          actionLabel={t(`${k}.actions.new`)}
          onAction={() => navigate('/construction/rfis/new')}
          variant="default"
        />
      ) : null}
      {!projectsQuery.isLoading && !rfisQuery.isLoading && filtered.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-4 py-3">{t(`${k}.columns.number`)}</th>
                <th scope="col" className="px-4 py-3">{t(`${k}.columns.subject`)}</th>
                <th scope="col" className="px-4 py-3">{t(`${k}.columns.project`)}</th>
                <th scope="col" className="px-4 py-3">{t(`${k}.columns.status`)}</th>
                <th scope="col" className="px-4 py-3">{t(`${k}.columns.priority`)}</th>
                <th scope="col" className="px-4 py-3">{t(`${k}.columns.dueDate`)}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((rfi) => {
                const rfiStatus = rfi.status as ConstructionRfiStatus;
                const rfiPriority = rfi.priority as ConstructionRfiPriority;
                const overdue = Boolean(rfi.due_date && rfi.due_date < todayIso() && ['open', 'submitted', 'answered'].includes(rfiStatus));
                return (
                  <tr
                    key={rfi.id}
                    role="link"
                    tabIndex={0}
                    aria-label={t(`${k}.openRfi`, { number: rfi.rfi_number })}
                    className="cursor-pointer hover:bg-gray-50 focus-within:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
                    onClick={() => navigate(`/construction/rfis/${rfi.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        navigate(`/construction/rfis/${rfi.id}`);
                      }
                    }}
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-semibold text-brand-700">{rfi.rfi_number}</td>
                    <td className="min-w-56 px-4 py-3 text-gray-900">{rfi.title}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">{projectById.get(rfi.project_id) ?? t('common.unknown')}</td>
                    <td className="whitespace-nowrap px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClasses[rfiStatus]}`}>{t(`${k}.statuses.${rfiStatus}`)}</span></td>
                    <td className="whitespace-nowrap px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${priorityClasses[rfiPriority]}`}>{t(`${k}.priorities.${rfiPriority}`)}</span></td>
                    <td className={`whitespace-nowrap px-4 py-3 ${overdue ? 'font-semibold text-red-700' : 'text-gray-600'}`}>
                      <span className="inline-flex items-center gap-1.5">
                        {overdue ? <AlertCircle className="h-4 w-4" aria-hidden="true" /> : null}
                        {formatDate(rfi.due_date, i18n.language, t(`${k}.notAvailable`))}
                        {overdue ? <span className="sr-only">{t(`${k}.overdue`)}</span> : null}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  );
}
