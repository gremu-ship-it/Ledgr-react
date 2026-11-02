import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Save } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';
import { loadAllProjects, loadProjectReferences } from './rfiPageData';
import { RfiFormFields, type RfiFormValues } from './RfiFormFields';

const k = 'construction.rfis';
const initialValues: RfiFormValues = {
  project_id: '', site_id: '', rfi_number: '', title: '', question: '', priority: 'normal',
  due_date: '', evidence: '', proposed_solution: '', boq_item_id: '', subcontract_id: '', drawing_reference: '',
};

export function RfiNewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const businessId = useAppStore((state) => state.currentBusiness?.business?.id ?? null);
  const [values, setValues] = useState<RfiFormValues>(initialValues);

  const projectsQuery = useQuery({
    queryKey: ['construction', 'rfi-projects', businessId],
    queryFn: () => loadAllProjects(businessId as string),
    enabled: Boolean(businessId),
  });
  const referencesQuery = useQuery({
    queryKey: ['construction', 'rfi-references', businessId, values.project_id],
    queryFn: () => loadProjectReferences(businessId as string, values.project_id),
    enabled: Boolean(businessId && values.project_id),
  });

  const createMutation = useMutation({
    mutationFn: () => repos.rfi.create({
      business_id: businessId as string,
      project_id: values.project_id,
      site_id: values.site_id || null,
      rfi_number: values.rfi_number.trim(),
      title: values.title.trim(),
      question: values.question.trim(),
      priority: values.priority,
      due_date: values.due_date || null,
      evidence: values.evidence.trim() || null,
      proposed_solution: values.proposed_solution.trim() || null,
      boq_item_id: values.boq_item_id || null,
      subcontract_id: values.subcontract_id || null,
      drawing_reference: values.drawing_reference.trim() || null,
    }),
    onSuccess: (rfi) => navigate(`/construction/rfis/${rfi.id}`),
  });

  const references = referencesQuery.data;
  const projectOptions = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createMutation.mutate();
  };

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      <Link to="/construction/rfis" className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />{t(`${k}.backToList`)}
      </Link>
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">{t(`${k}.newTitle`)}</h1>
        <p className="mt-1 text-sm text-gray-600">{t(`${k}.newDescription`)}</p>
      </header>

      {createMutation.isError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t(`${k}.errors.create`)}</p> : null}
      {projectsQuery.isError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t(`${k}.errors.projects`)}</p> : null}
      {referencesQuery.isError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t(`${k}.errors.references`)}</p> : null}

      <form onSubmit={handleSubmit} className="space-y-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
        <RfiFormFields
          values={values}
          setValues={setValues}
          projects={projectOptions}
          sites={references?.sites ?? []}
          boqItems={references?.boqItems ?? []}
          subcontracts={references?.subcontracts ?? []}
        />
        <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
          <Button type="button" variant="secondary" onClick={() => navigate('/construction/rfis')}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" isLoading={createMutation.isPending} disabled={!businessId || createMutation.isPending}>
            <Save className="h-4 w-4" aria-hidden="true" />{t(`${k}.actions.create`)}
          </Button>
        </div>
      </form>
    </main>
  );
}
