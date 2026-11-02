import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import { ConstructionQualityReferenceFields } from './ConstructionQualityReferenceFields';
import { loadAllProjects, loadChangeOrderProjectReferences } from './qualityPageData';

const K = 'construction.itps';
const inputClass = 'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100';
const labelClass = 'block text-sm font-medium text-gray-700';

export function ItpNewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const businessId = useAppStore((state) => state.currentBusiness?.business?.id ?? null);
  const [projectId, setProjectId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [boqSectionId, setBoqSectionId] = useState('');
  const [subcontractId, setSubcontractId] = useState('');
  const [itpNumber, setItpNumber] = useState('');
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState('');
  const [evidenceReference, setEvidenceReference] = useState('');

  const projectsQuery = useQuery({
    queryKey: ['construction', 'quality-projects', businessId],
    queryFn: () => loadAllProjects(businessId as string),
    enabled: Boolean(businessId),
  });
  const referencesQuery = useQuery({
    queryKey: ['construction', 'quality-references', businessId, projectId],
    queryFn: () => loadChangeOrderProjectReferences(businessId as string, projectId),
    enabled: Boolean(businessId && projectId),
  });
  const createMutation = useMutation({
    mutationFn: () => repos.quality.createItp(businessId as string, {
      project_id: projectId,
      site_id: siteId || null,
      itp_number: itpNumber.trim(),
      title: title.trim(),
      scope: scope.trim(),
      boq_section_id: boqSectionId || null,
      subcontract_id: subcontractId || null,
      evidence_reference: evidenceReference.trim() || null,
    }),
    onSuccess: (itp) => navigate(`/construction/itps/${itp.id}`),
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createMutation.mutate();
  };
  const changeProject = (value: string) => {
    setProjectId(value);
    setSiteId('');
    setBoqSectionId('');
    setSubcontractId('');
  };

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      <Link to="/construction/itps" className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />{t(`${K}.backToList`)}
      </Link>
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">{t(`${K}.newTitle`)}</h1>
        <p className="mt-1 text-sm text-gray-600">{t(`${K}.newDescription`)}</p>
      </header>
      <form onSubmit={submit} className="space-y-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
        {createMutation.isError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t(`${K}.errors.create`)}</p> : null}
        {projectsQuery.isError || referencesQuery.isError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t(`${K}.errors.references`)}</p> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <ConstructionQualityReferenceFields
            namespace="itps"
            projects={projectsQuery.data ?? []}
            projectId={projectId}
            siteId={siteId}
            boqSectionId={boqSectionId}
            subcontractId={subcontractId}
            references={referencesQuery.data}
            includeBoqSection
            onProjectChange={changeProject}
            onSiteChange={setSiteId}
            onBoqSectionChange={setBoqSectionId}
            onSubcontractChange={setSubcontractId}
          />
          <label className={labelClass}>
            {t(`${K}.fields.number`)} <span aria-hidden="true">*</span>
            <input required maxLength={80} className={inputClass} value={itpNumber} onChange={(event) => setItpNumber(event.target.value)} />
          </label>
          <label className={labelClass}>
            {t(`${K}.fields.title`)} <span aria-hidden="true">*</span>
            <input required maxLength={200} className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            {t(`${K}.fields.scope`)} <span aria-hidden="true">*</span>
            <textarea required maxLength={20000} rows={5} className={inputClass} value={scope} onChange={(event) => setScope(event.target.value)} />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>
            {t(`${K}.fields.evidenceReference`)}
            <input className={inputClass} maxLength={2000} value={evidenceReference} onChange={(event) => setEvidenceReference(event.target.value)} />
          </label>
        </div>
        <div className="flex justify-end">
          <Button type="submit" isLoading={createMutation.isPending}>{t(`${K}.actions.create`)}</Button>
        </div>
      </form>
    </main>
  );
}
