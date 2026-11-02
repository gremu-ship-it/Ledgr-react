import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import type { ConstructionHseIncidentSeverity, ConstructionHseIncidentType } from '@/dal/repositories/ConstructionHseRepository';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';
import { ConstructionHseReferenceFields } from './ConstructionHseReferenceFields';
import { loadAllProjects, loadProjectSites } from './hsePageData';

const K = 'construction.hseIncidents';
const SEVERITIES: ConstructionHseIncidentSeverity[] = ['near_miss', 'minor', 'major', 'critical', 'fatality'];
const TYPES: ConstructionHseIncidentType[] = ['injury', 'property_damage', 'environmental', 'near_miss', 'other'];
const inputClass = 'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100';
const labelClass = 'block text-sm font-medium text-gray-700';

export function HseIncidentNewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const businessId = useAppStore((state) => state.currentBusiness?.business?.id ?? null);
  const [projectId, setProjectId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [incidentNumber, setIncidentNumber] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [incidentDate, setIncidentDate] = useState('');
  const [incidentType, setIncidentType] = useState<ConstructionHseIncidentType>('injury');
  const [severity, setSeverity] = useState<ConstructionHseIncidentSeverity>('minor');
  const [locationDescription, setLocationDescription] = useState('');
  const [personsInvolved, setPersonsInvolved] = useState('0');
  const [evidenceReference, setEvidenceReference] = useState('');

  const projectsQuery = useQuery({
    queryKey: ['construction', 'quality-projects', businessId],
    queryFn: () => loadAllProjects(businessId as string),
    enabled: Boolean(businessId),
  });
  const sitesQuery = useQuery({
    queryKey: ['construction', 'hse-sites', businessId, projectId],
    queryFn: () => loadProjectSites(businessId as string, projectId),
    enabled: Boolean(businessId && projectId),
  });
  const createMutation = useMutation({
    mutationFn: () => repos.hse.createIncident(businessId as string, {
      project_id: projectId,
      site_id: siteId || null,
      incident_number: incidentNumber.trim(),
      title: title.trim(),
      description: description.trim(),
      incident_date: new Date(incidentDate).toISOString(),
      incident_type: incidentType,
      severity,
      location_description: locationDescription.trim() || null,
      persons_involved: Number(personsInvolved),
      evidence_reference: evidenceReference.trim() || null,
    }),
    onSuccess: (incident) => navigate(`/construction/hse-incidents/${incident.id}`),
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createMutation.mutate();
  };
  const changeProject = (value: string) => {
    setProjectId(value);
    setSiteId('');
  };

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      <Link to="/construction/hse-incidents" className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900"><ArrowLeft className="h-4 w-4" aria-hidden="true" />{t(`${K}.backToList`)}</Link>
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">{t(`${K}.newTitle`)}</h1>
        <p className="mt-1 text-sm text-gray-600">{t(`${K}.newDescription`)}</p>
      </header>
      <form onSubmit={submit} className="space-y-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
        {createMutation.isError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t(`${K}.errors.create`)}</p> : null}
        {projectsQuery.isError || sitesQuery.isError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t(`${K}.errors.references`)}</p> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <ConstructionHseReferenceFields
            namespace="hseIncidents"
            projects={projectsQuery.data ?? []}
            sites={sitesQuery.data ?? []}
            projectId={projectId}
            siteId={siteId}
            onProjectChange={changeProject}
            onSiteChange={setSiteId}
          />
          <label className={labelClass}>
            {t(`${K}.fields.incidentNumber`)} <span aria-hidden="true">*</span>
            <input required maxLength={80} className={inputClass} value={incidentNumber} onChange={(event) => setIncidentNumber(event.target.value)} />
          </label>
          <label className={labelClass}>
            {t(`${K}.fields.title`)} <span aria-hidden="true">*</span>
            <input required maxLength={200} className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className={labelClass}>
            {t(`${K}.fields.dateTime`)} <span aria-hidden="true">*</span>
            <input type="datetime-local" required className={inputClass} value={incidentDate} onChange={(event) => setIncidentDate(event.target.value)} />
          </label>
          <label className={labelClass}>
            {t(`${K}.fields.incidentType`)}
            <select className={inputClass} value={incidentType} onChange={(event) => setIncidentType(event.target.value as ConstructionHseIncidentType)}>
              {TYPES.map((value) => <option key={value} value={value}>{t(`${K}.types.${value}`)}</option>)}
            </select>
          </label>
          <label className={labelClass}>
            {t(`${K}.fields.severity`)}
            <select className={inputClass} value={severity} onChange={(event) => setSeverity(event.target.value as ConstructionHseIncidentSeverity)}>
              {SEVERITIES.map((value) => <option key={value} value={value}>{t(`${K}.severities.${value}`)}</option>)}
            </select>
          </label>
          <label className={labelClass}>
            {t(`${K}.fields.personsInvolved`)}
            <input type="number" min="0" max="100000" step="1" required className={inputClass} value={personsInvolved} onChange={(event) => setPersonsInvolved(event.target.value)} />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            {t(`${K}.fields.description`)} <span aria-hidden="true">*</span>
            <textarea required maxLength={20000} rows={5} className={inputClass} value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            {t(`${K}.fields.locationDescription`)}
            <input maxLength={500} className={inputClass} value={locationDescription} onChange={(event) => setLocationDescription(event.target.value)} />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            {t(`${K}.fields.evidenceReference`)}
            <input maxLength={2000} className={inputClass} value={evidenceReference} onChange={(event) => setEvidenceReference(event.target.value)} />
          </label>
        </div>
        <div className="flex justify-end"><Button type="submit" isLoading={createMutation.isPending}>{t(`${K}.actions.create`)}</Button></div>
      </form>
    </main>
  );
}
