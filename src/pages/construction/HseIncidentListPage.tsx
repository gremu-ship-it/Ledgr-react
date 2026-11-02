import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ShieldAlert, Plus } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import type {
  ConstructionHseIncidentSeverity,
  ConstructionHseIncidentStatus,
  ConstructionHseIncidentType,
} from '@/dal/repositories/ConstructionHseRepository';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';
import { loadAllProjects } from './hsePageData';

const K = 'construction.hseIncidents';
const STATUSES: ConstructionHseIncidentStatus[] = ['reported', 'investigating', 'resolved', 'closed'];
const SEVERITIES: ConstructionHseIncidentSeverity[] = ['near_miss', 'minor', 'major', 'critical', 'fatality'];
const TYPES: ConstructionHseIncidentType[] = ['injury', 'property_damage', 'environmental', 'near_miss', 'other'];
const SEVERITY_CLASSES: Record<ConstructionHseIncidentSeverity, string> = {
  near_miss: 'bg-yellow-100 text-yellow-800',
  minor: 'bg-blue-100 text-blue-800',
  major: 'bg-orange-100 text-orange-800',
  critical: 'bg-red-100 text-red-800',
  fatality: 'bg-gray-950 text-white',
};
const TYPE_CLASSES: Record<ConstructionHseIncidentType, string> = {
  injury: 'bg-blue-50 text-blue-800',
  property_damage: 'bg-orange-50 text-orange-800',
  environmental: 'bg-emerald-50 text-emerald-800',
  near_miss: 'bg-yellow-50 text-yellow-800',
  other: 'bg-gray-100 text-gray-700',
};
const STATUS_CLASSES: Record<ConstructionHseIncidentStatus, string> = {
  reported: 'bg-gray-100 text-gray-700',
  investigating: 'bg-blue-100 text-blue-800',
  resolved: 'bg-emerald-100 text-emerald-800',
  closed: 'bg-slate-100 text-slate-700',
};

function displayDate(value: string, locale: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function HseIncidentListPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const businessId = useAppStore((state) => state.currentBusiness?.business?.id ?? null);
  const [projectId, setProjectId] = useState('all');
  const [status, setStatus] = useState<'all' | ConstructionHseIncidentStatus>('all');
  const [severity, setSeverity] = useState<'all' | ConstructionHseIncidentSeverity>('all');
  const [incidentType, setIncidentType] = useState<'all' | ConstructionHseIncidentType>('all');

  const projectsQuery = useQuery({
    queryKey: ['construction', 'quality-projects', businessId],
    queryFn: () => loadAllProjects(businessId as string),
    enabled: Boolean(businessId),
  });
  const incidentsQuery = useQuery({
    queryKey: ['construction', 'hse-incidents', businessId, projectId, status, severity],
    queryFn: () => repos.hse.listIncidents(businessId as string, {
      projectId: projectId === 'all' ? undefined : projectId,
      status: status === 'all' ? undefined : status,
      severity: severity === 'all' ? undefined : severity,
    }),
    enabled: Boolean(businessId),
  });
  const incidents = useMemo(() => (incidentsQuery.data ?? []).filter((incident) => incidentType === 'all' || incident.incident_type === incidentType), [incidentsQuery.data, incidentType]);
  const loading = projectsQuery.isLoading || incidentsQuery.isLoading;
  const hasError = projectsQuery.isError || incidentsQuery.isError;

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t(`${K}.title`)}</h1>
          <p className="mt-1 text-sm text-gray-600">{t(`${K}.description`)}</p>
        </div>
        <Button type="button" onClick={() => navigate('/construction/hse-incidents/new')}>
          <Plus className="h-4 w-4" aria-hidden="true" />{t(`${K}.actions.report`)}
        </Button>
      </header>

      <section aria-label={t(`${K}.filters.title`)} className="grid gap-3 rounded-xl border border-gray-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Filter label={t(`${K}.fields.project`)} value={projectId} onChange={setProjectId}>
          <option value="all">{t(`${K}.filters.allProjects`)}</option>
          {(projectsQuery.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </Filter>
        <Filter label={t(`${K}.fields.status`)} value={status} onChange={(value) => setStatus(value as 'all' | ConstructionHseIncidentStatus)}>
          <option value="all">{t(`${K}.filters.allStatuses`)}</option>
          {STATUSES.map((value) => <option key={value} value={value}>{t(`${K}.statuses.${value}`)}</option>)}
        </Filter>
        <Filter label={t(`${K}.fields.severity`)} value={severity} onChange={(value) => setSeverity(value as 'all' | ConstructionHseIncidentSeverity)}>
          <option value="all">{t(`${K}.filters.allSeverities`)}</option>
          {SEVERITIES.map((value) => <option key={value} value={value}>{t(`${K}.severities.${value}`)}</option>)}
        </Filter>
        <Filter label={t(`${K}.fields.incidentType`)} value={incidentType} onChange={(value) => setIncidentType(value as 'all' | ConstructionHseIncidentType)}>
          <option value="all">{t(`${K}.filters.allTypes`)}</option>
          {TYPES.map((value) => <option key={value} value={value}>{t(`${K}.types.${value}`)}</option>)}
        </Filter>
      </section>

      {hasError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t(`${K}.errors.load`)}</p> : null}
      {loading ? <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">{t(`${K}.loading`)}</div> : null}
      {!loading && !hasError && incidents.length === 0 ? (
        <EmptyState icon={ShieldAlert} title={t(`${K}.empty.title`)} description={t(`${K}.empty.description`)} actionLabel={t(`${K}.actions.report`)} onAction={() => navigate('/construction/hse-incidents/new')} />
      ) : null}
      {!loading && !hasError && incidents.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-4 py-3">{t(`${K}.columns.number`)}</th>
                <th scope="col" className="px-4 py-3">{t(`${K}.columns.title`)}</th>
                <th scope="col" className="px-4 py-3">{t(`${K}.columns.type`)}</th>
                <th scope="col" className="px-4 py-3">{t(`${K}.columns.severity`)}</th>
                <th scope="col" className="px-4 py-3">{t(`${K}.columns.status`)}</th>
                <th scope="col" className="px-4 py-3">{t(`${K}.columns.date`)}</th>
                <th scope="col" className="px-4 py-3">{t(`${K}.columns.personsInvolved`)}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {incidents.map((incident) => (
                <tr
                  key={incident.id}
                  role="link"
                  tabIndex={0}
                  aria-label={t(`${K}.openIncident`, { number: incident.incident_number })}
                  className="cursor-pointer hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
                  onClick={() => navigate(`/construction/hse-incidents/${incident.id}`)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      navigate(`/construction/hse-incidents/${incident.id}`);
                    }
                  }}
                >
                  <td className="whitespace-nowrap px-4 py-3 font-semibold text-brand-700">{incident.incident_number}</td>
                  <td className="min-w-52 px-4 py-3 text-gray-900">{incident.title}</td>
                  <td className="whitespace-nowrap px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${TYPE_CLASSES[incident.incident_type]}`}>{t(`${K}.types.${incident.incident_type}`)}</span></td>
                  <td className="whitespace-nowrap px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${SEVERITY_CLASSES[incident.severity]}`}>{t(`${K}.severities.${incident.severity}`)}</span></td>
                  <td className="whitespace-nowrap px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASSES[incident.status]}`}>{t(`${K}.statuses.${incident.status}`)}</span></td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">{displayDate(incident.incident_date, i18n.language)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-700">{new Intl.NumberFormat(i18n.language).format(incident.persons_involved)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  );
}

function Filter({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return <label className="block text-sm font-medium text-gray-700">{label}<select className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" value={value} onChange={(event) => onChange(event.target.value)}>{children}</select></label>;
}
