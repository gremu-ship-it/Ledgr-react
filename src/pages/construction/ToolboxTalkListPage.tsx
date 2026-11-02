import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Users, Plus } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';
import { loadAllProjects, loadProjectSites } from './hsePageData';

const K = 'construction.toolboxTalks';

function displayDate(value: string, locale: string): string {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}

export function ToolboxTalkListPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const businessId = useAppStore((state) => state.currentBusiness?.business?.id ?? null);
  const projectsQuery = useQuery({
    queryKey: ['construction', 'quality-projects', businessId],
    queryFn: () => loadAllProjects(businessId as string),
    enabled: Boolean(businessId),
  });
  const talksQuery = useQuery({
    queryKey: ['construction', 'toolbox-talks', businessId],
    queryFn: () => repos.hse.listToolboxTalks(businessId as string),
    enabled: Boolean(businessId),
  });
  const projectIds = useMemo(() => [...new Set((talksQuery.data ?? []).map((talk) => talk.project_id))].sort(), [talksQuery.data]);
  const sitesQuery = useQuery({
    queryKey: ['construction', 'toolbox-talk-sites', businessId, projectIds],
    queryFn: async () => {
      const siteGroups = await Promise.all(projectIds.map(async (projectId) => [projectId, await loadProjectSites(businessId as string, projectId)] as const));
      return new Map(siteGroups.flatMap(([projectId, sites]) => sites.map((site) => [site.id, { site, projectId }] as const)));
    },
    enabled: Boolean(businessId && talksQuery.data),
  });
  const projects = useMemo(() => new Map((projectsQuery.data ?? []).map((project) => [project.id, project.name])), [projectsQuery.data]);
  const loading = projectsQuery.isLoading || talksQuery.isLoading || sitesQuery.isLoading;
  const hasError = projectsQuery.isError || talksQuery.isError || sitesQuery.isError;
  const talks = talksQuery.data ?? [];

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t(`${K}.title`)}</h1>
          <p className="mt-1 text-sm text-gray-600">{t(`${K}.description`)}</p>
        </div>
        <Button type="button" onClick={() => navigate('/construction/toolbox-talks/new')}><Plus className="h-4 w-4" aria-hidden="true" />{t(`${K}.actions.record`)}</Button>
      </header>
      {hasError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t(`${K}.errors.load`)}</p> : null}
      {loading ? <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">{t(`${K}.loading`)}</div> : null}
      {!loading && !hasError && talks.length === 0 ? (
        <EmptyState icon={Users} title={t(`${K}.empty.title`)} description={t(`${K}.empty.description`)} actionLabel={t(`${K}.actions.record`)} onAction={() => navigate('/construction/toolbox-talks/new')} />
      ) : null}
      {!loading && !hasError && talks.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-4 py-3">{t(`${K}.columns.date`)}</th>
                <th scope="col" className="px-4 py-3">{t(`${K}.columns.topic`)}</th>
                <th scope="col" className="px-4 py-3">{t(`${K}.columns.presenter`)}</th>
                <th scope="col" className="px-4 py-3">{t(`${K}.columns.attendees`)}</th>
                <th scope="col" className="px-4 py-3">{t(`${K}.columns.project`)}</th>
                <th scope="col" className="px-4 py-3">{t(`${K}.columns.site`)}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {talks.map((talk) => (
                <tr key={talk.id}>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-700">{displayDate(talk.talk_date, i18n.language)}</td>
                  <td className="min-w-48 px-4 py-3 font-medium text-gray-900">{talk.topic}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-700">{talk.presenter}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-700">{new Intl.NumberFormat(i18n.language).format(talk.attendees_count)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-700">{projects.get(talk.project_id) ?? t('common.unknown')}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-700">{sitesQuery.data?.get(talk.site_id ?? '')?.site.site_name ?? t(`${K}.notAvailable`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  );
}
