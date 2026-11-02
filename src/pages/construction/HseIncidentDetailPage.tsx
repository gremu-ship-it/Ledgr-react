import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Check, Save } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { Button } from '@/components/ui/Button';
import type { ConstructionHseIncidentSeverity, ConstructionHseIncidentStatus } from '@/dal/repositories/ConstructionHseRepository';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';
import { loadAllProjects, loadProjectSites } from './hsePageData';

const K = 'construction.hseIncidents';
const STATUS_CLASSES: Record<ConstructionHseIncidentStatus, string> = {
  reported: 'bg-gray-100 text-gray-700',
  investigating: 'bg-blue-100 text-blue-800',
  resolved: 'bg-emerald-100 text-emerald-800',
  closed: 'bg-slate-100 text-slate-700',
};
const SEVERITY_CLASSES: Record<ConstructionHseIncidentSeverity, string> = {
  near_miss: 'bg-yellow-100 text-yellow-800',
  minor: 'bg-blue-100 text-blue-800',
  major: 'bg-orange-100 text-orange-800',
  critical: 'bg-red-100 text-red-800',
  fatality: 'bg-gray-950 text-white',
};
const TEXTAREA_CLASS = 'mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100';

function formatDate(value: string, locale: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short' }).format(date);
}

export function HseIncidentDetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const businessId = useAppStore((state) => state.currentBusiness?.business?.id ?? null);
  const queryClient = useQueryClient();
  const [rootCauseDraft, setRootCauseDraft] = useState<{ id: string; value: string } | null>(null);
  const [correctiveActionDraft, setCorrectiveActionDraft] = useState<{ id: string; value: string } | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [validationError, setValidationError] = useState<'rootCauseRequired' | 'correctiveActionRequired' | null>(null);

  const incidentQuery = useQuery({
    queryKey: ['construction', 'hse-incident', businessId, id],
    queryFn: () => repos.hse.getIncidentById(businessId as string, id as string),
    enabled: Boolean(businessId && id),
  });
  const incident = incidentQuery.data;
  const rootCause = incident && rootCauseDraft?.id === incident.id ? rootCauseDraft.value : incident?.root_cause ?? '';
  const correctiveAction = incident && correctiveActionDraft?.id === incident.id ? correctiveActionDraft.value : incident?.corrective_action ?? '';
  const projectsQuery = useQuery({
    queryKey: ['construction', 'quality-projects', businessId],
    queryFn: () => loadAllProjects(businessId as string),
    enabled: Boolean(businessId),
  });
  const sitesQuery = useQuery({
    queryKey: ['construction', 'hse-sites', businessId, incident?.project_id],
    queryFn: () => loadProjectSites(businessId as string, incident?.project_id as string),
    enabled: Boolean(businessId && incident?.project_id),
  });
  const project = useMemo(() => (projectsQuery.data ?? []).find((row) => row.id === incident?.project_id), [projectsQuery.data, incident?.project_id]);
  const site = sitesQuery.data?.find((row) => row.id === incident?.site_id);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['construction', 'hse-incident', businessId, id] }),
      queryClient.invalidateQueries({ queryKey: ['construction', 'hse-incidents', businessId] }),
    ]);
  };
  const transitionMutation = useMutation({
    mutationFn: (status: ConstructionHseIncidentStatus) => repos.hse.transitionIncidentStatus(id as string, status),
    onSuccess: refresh,
    onError: () => setActionError(true),
  });
  const updateMutation = useMutation({
    mutationFn: (changes: { root_cause?: string | null; corrective_action?: string | null }) =>
      repos.hse.updateIncident(businessId as string, id as string, changes),
    onSuccess: refresh,
    onError: () => setSaveError(true),
  });
  const confirmTransition = (status: ConstructionHseIncidentStatus) => {
    if (status === 'resolved' && !rootCause.trim()) {
      setValidationError('rootCauseRequired');
      return;
    }
    if (status === 'closed' && !correctiveAction.trim()) {
      setValidationError('correctiveActionRequired');
      return;
    }
    setValidationError(null);
    const key = status === 'investigating' ? 'confirmInvestigate' : status === 'resolved' ? 'confirmResolve' : 'confirmClose';
    if (!window.confirm(t(`${K}.${key}`))) return;
    setActionError(false);
    transitionMutation.mutate(status);
  };
  const saveRootCause = () => {
    setSaveError(false);
    updateMutation.mutate({ root_cause: rootCause.trim() || null });
  };
  const saveCorrectiveAction = () => {
    setSaveError(false);
    updateMutation.mutate({ corrective_action: correctiveAction.trim() || null });
  };

  if (incidentQuery.isLoading) return <main className="mx-auto max-w-6xl px-4 py-8 text-center text-sm text-gray-500">{t(`${K}.loadingDetail`)}</main>;
  if (incidentQuery.isError || !incident) return <main className="mx-auto max-w-6xl px-4 py-8"><p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t(`${K}.errors.detail`)}</p></main>;

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <Link to="/construction/hse-incidents" className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900"><ArrowLeft className="h-4 w-4" aria-hidden="true" />{t(`${K}.backToList`)}</Link>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-brand-700">{incident.incident_number}</p>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${SEVERITY_CLASSES[incident.severity]}`}>{t(`${K}.severities.${incident.severity}`)}</span>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASSES[incident.status]}`}>{t(`${K}.statuses.${incident.status}`)}</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-gray-900">{incident.title}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {incident.status === 'reported' ? <Button type="button" onClick={() => confirmTransition('investigating')} isLoading={transitionMutation.isPending}>{t(`${K}.actions.investigate`)}</Button> : null}
          {incident.status === 'investigating' ? <Button type="button" onClick={() => confirmTransition('resolved')} isLoading={transitionMutation.isPending}><Check className="h-4 w-4" aria-hidden="true" />{t(`${K}.actions.resolve`)}</Button> : null}
          {incident.status === 'resolved' ? <Button type="button" onClick={() => confirmTransition('closed')} isLoading={transitionMutation.isPending}><Check className="h-4 w-4" aria-hidden="true" />{t(`${K}.actions.close`)}</Button> : null}
        </div>
      </header>
      {actionError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t(`${K}.errors.action`)}</p> : null}
      {validationError ? <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{t(`${K}.errors.${validationError}`)}</p> : null}
      {saveError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t(`${K}.errors.update`)}</p> : null}

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">{t(`${K}.sections.incidentInformation`)}</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label={t(`${K}.fields.project`)} value={project?.name ?? t(`${K}.notAvailable`)} />
          <Detail label={t(`${K}.fields.site`)} value={site ? `${site.site_code} · ${site.site_name}` : t(`${K}.notAvailable`)} />
          <Detail label={t(`${K}.fields.dateTime`)} value={formatDate(incident.incident_date, i18n.language)} />
          <Detail label={t(`${K}.fields.locationDescription`)} value={incident.location_description || t(`${K}.notAvailable`)} />
          <Detail label={t(`${K}.fields.personsInvolved`)} value={new Intl.NumberFormat(i18n.language).format(incident.persons_involved)} />
          <Detail label={t(`${K}.fields.incidentType`)} value={t(`${K}.types.${incident.incident_type}`)} />
        </dl>
      </section>
      <TextSection title={t(`${K}.sections.description`)} value={incident.description} />
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">{t(`${K}.sections.rootCause`)}</h2>
        {incident.status === 'investigating' ? <>
          <textarea aria-label={t(`${K}.fields.rootCause`)} rows={4} className={TEXTAREA_CLASS} value={rootCause} onChange={(event) => { setRootCauseDraft({ id: incident.id, value: event.target.value }); setValidationError(null); }} />
          <div className="mt-3 flex justify-end"><Button type="button" onClick={saveRootCause} isLoading={updateMutation.isPending}><Save className="h-4 w-4" aria-hidden="true" />{t(`${K}.actions.saveRootCause`)}</Button></div>
        </> : <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{incident.root_cause || t(`${K}.notAvailable`)}</p>}
      </section>
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">{t(`${K}.sections.correctiveAction`)}</h2>
        {incident.status === 'resolved' ? <>
          <textarea aria-label={t(`${K}.fields.correctiveAction`)} rows={4} className={TEXTAREA_CLASS} value={correctiveAction} onChange={(event) => { setCorrectiveActionDraft({ id: incident.id, value: event.target.value }); setValidationError(null); }} />
          <div className="mt-3 flex justify-end"><Button type="button" onClick={saveCorrectiveAction} isLoading={updateMutation.isPending}><Save className="h-4 w-4" aria-hidden="true" />{t(`${K}.actions.saveCorrectiveAction`)}</Button></div>
        </> : <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{incident.corrective_action || t(`${K}.notAvailable`)}</p>}
      </section>
      {incident.evidence_reference ? <TextSection title={t(`${K}.sections.evidenceReference`)} value={incident.evidence_reference} /> : null}
    </main>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</dt><dd className="mt-1 text-sm text-gray-900">{value}</dd></div>;
}
function TextSection({ title, value }: { title: string; value: string }) {
  return <section className="rounded-xl border border-gray-200 bg-white p-5"><h2 className="text-base font-semibold text-gray-900">{title}</h2><p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-gray-800">{value}</p></section>;
}
