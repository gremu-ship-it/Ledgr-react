import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';
import { ConstructionHseReferenceFields } from './ConstructionHseReferenceFields';
import { loadAllProjects, loadProjectSites } from './hsePageData';

const K = 'construction.toolboxTalks';
const inputClass = 'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100';
const labelClass = 'block text-sm font-medium text-gray-700';

export function ToolboxTalkNewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const businessId = useAppStore((state) => state.currentBusiness?.business?.id ?? null);
  const [projectId, setProjectId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [talkDate, setTalkDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [topic, setTopic] = useState('');
  const [presenter, setPresenter] = useState('');
  const [attendeesCount, setAttendeesCount] = useState('0');
  const [summary, setSummary] = useState('');
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
    mutationFn: () => repos.hse.createToolboxTalk(businessId as string, {
      project_id: projectId,
      site_id: siteId || null,
      talk_date: talkDate,
      topic: topic.trim(),
      presenter: presenter.trim(),
      attendees_count: Number(attendeesCount),
      summary: summary.trim(),
      evidence_reference: evidenceReference.trim() || null,
    }),
    onSuccess: () => navigate('/construction/toolbox-talks'),
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
      <Link to="/construction/toolbox-talks" className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900"><ArrowLeft className="h-4 w-4" aria-hidden="true" />{t(`${K}.backToList`)}</Link>
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">{t(`${K}.newTitle`)}</h1>
        <p className="mt-1 text-sm text-gray-600">{t(`${K}.newDescription`)}</p>
      </header>
      <form onSubmit={submit} className="space-y-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
        {createMutation.isError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t(`${K}.errors.create`)}</p> : null}
        {projectsQuery.isError || sitesQuery.isError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t(`${K}.errors.references`)}</p> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <ConstructionHseReferenceFields
            namespace="toolboxTalks"
            projects={projectsQuery.data ?? []}
            sites={sitesQuery.data ?? []}
            projectId={projectId}
            siteId={siteId}
            onProjectChange={changeProject}
            onSiteChange={setSiteId}
          />
          <label className={labelClass}>
            {t(`${K}.fields.date`)} <span aria-hidden="true">*</span>
            <input type="date" required className={inputClass} value={talkDate} onChange={(event) => setTalkDate(event.target.value)} />
          </label>
          <label className={labelClass}>
            {t(`${K}.fields.topic`)} <span aria-hidden="true">*</span>
            <input required maxLength={200} className={inputClass} value={topic} onChange={(event) => setTopic(event.target.value)} />
          </label>
          <label className={labelClass}>
            {t(`${K}.fields.presenter`)} <span aria-hidden="true">*</span>
            <input required maxLength={200} className={inputClass} value={presenter} onChange={(event) => setPresenter(event.target.value)} />
          </label>
          <label className={labelClass}>
            {t(`${K}.fields.attendeesCount`)}
            <input type="number" min="0" max="100000" step="1" required className={inputClass} value={attendeesCount} onChange={(event) => setAttendeesCount(event.target.value)} />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            {t(`${K}.fields.summary`)} <span aria-hidden="true">*</span>
            <textarea required maxLength={20000} rows={5} className={inputClass} value={summary} onChange={(event) => setSummary(event.target.value)} />
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
