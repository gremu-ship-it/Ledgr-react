import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Check, Save, X } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { Button } from '@/components/ui/Button';
import type { ConstructionNcrStatus, ConstructionNcrSeverity } from '@/dal/repositories/ConstructionQualityRepository';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';
import { loadAllProjects, loadChangeOrderProjectReferences, loadProjectCheckpointOptions } from './qualityPageData';

const K = 'construction.ncrs';
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
const TEXTAREA_CLASS = 'mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100';

export function NcrDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const businessId = useAppStore((state) => state.currentBusiness?.business?.id ?? null);
  const queryClient = useQueryClient();
  const [rootCauseDraft, setRootCauseDraft] = useState<{ id: string; value: string } | null>(null);
  const [correctiveActionDraft, setCorrectiveActionDraft] = useState<{ id: string; value: string } | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [validationError, setValidationError] = useState<'rootCauseRequired' | 'correctiveActionRequired' | null>(null);

  const ncrQuery = useQuery({
    queryKey: ['construction', 'ncr', businessId, id],
    queryFn: () => repos.quality.getNcrById(businessId as string, id as string),
    enabled: Boolean(businessId && id),
  });
  const ncr = ncrQuery.data;
  const rootCause = ncr && rootCauseDraft?.id === ncr.id ? rootCauseDraft.value : ncr?.root_cause ?? '';
  const correctiveAction = ncr && correctiveActionDraft?.id === ncr.id ? correctiveActionDraft.value : ncr?.corrective_action ?? '';
  const projectsQuery = useQuery({
    queryKey: ['construction', 'quality-projects', businessId],
    queryFn: () => loadAllProjects(businessId as string),
    enabled: Boolean(businessId),
  });
  const referencesQuery = useQuery({
    queryKey: ['construction', 'quality-references', businessId, ncr?.project_id],
    queryFn: () => loadChangeOrderProjectReferences(businessId as string, ncr?.project_id as string, true),
    enabled: Boolean(businessId && ncr?.project_id),
  });
  const checkpointsQuery = useQuery({
    queryKey: ['construction', 'ncr-checkpoint-options', businessId, ncr?.project_id],
    queryFn: () => loadProjectCheckpointOptions(businessId as string, ncr?.project_id as string),
    enabled: Boolean(businessId && ncr?.project_id),
  });
  const project = useMemo(() => (projectsQuery.data ?? []).find((row) => row.id === ncr?.project_id), [projectsQuery.data, ncr?.project_id]);
  const refs = referencesQuery.data;
  const site = refs?.sites.find((row) => row.id === ncr?.site_id);
  const subcontract = refs?.subcontracts.find((row) => row.id === ncr?.subcontract_id);
  const checkpointOption = checkpointsQuery.data?.find(({ checkpoint }) => checkpoint.id === ncr?.itp_checkpoint_id);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['construction', 'ncr', businessId, id] }),
      queryClient.invalidateQueries({ queryKey: ['construction', 'ncrs', businessId] }),
    ]);
  };
  const transitionMutation = useMutation({
    mutationFn: (status: ConstructionNcrStatus) => repos.quality.transitionNcrStatus(id as string, status),
    onSuccess: refresh,
    onError: () => setActionError(true),
  });
  const updateMutation = useMutation({
    mutationFn: (changes: { root_cause?: string | null; corrective_action?: string | null }) =>
      repos.quality.updateNcr(businessId as string, id as string, changes),
    onSuccess: refresh,
    onError: () => setSaveError(true),
  });
  const confirmTransition = (status: ConstructionNcrStatus) => {
    if (status === 'corrective_action' && !rootCause.trim()) {
      setValidationError('rootCauseRequired');
      return;
    }
    if (status === 'closed' && !correctiveAction.trim()) {
      setValidationError('correctiveActionRequired');
      return;
    }
    setValidationError(null);
    const key = status === 'investigating'
      ? 'confirmInvestigate'
      : status === 'corrective_action'
        ? 'confirmCorrectiveAction'
        : status === 'closed'
          ? 'confirmClose'
          : 'confirmCancel';
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

  if (ncrQuery.isLoading) return <main className="mx-auto max-w-6xl px-4 py-8 text-center text-sm text-gray-500">{t(`${K}.loadingDetail`)}</main>;
  if (ncrQuery.isError || !ncr) return <main className="mx-auto max-w-6xl px-4 py-8"><p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t(`${K}.errors.detail`)}</p></main>;

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <Link to="/construction/ncrs" className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />{t(`${K}.backToList`)}
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-brand-700">{ncr.ncr_number}</p>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${SEVERITY_CLASSES[ncr.severity]}`}>{t(`${K}.severities.${ncr.severity}`)}</span>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASSES[ncr.status]}`}>{t(`${K}.statuses.${ncr.status}`)}</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-gray-900">{ncr.title}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {ncr.status === 'open' ? <Button onClick={() => confirmTransition('investigating')} isLoading={transitionMutation.isPending}>{t(`${K}.actions.investigate`)}</Button> : null}
          {ncr.status === 'investigating' ? <Button onClick={() => confirmTransition('corrective_action')} isLoading={transitionMutation.isPending}>{t(`${K}.actions.proposeCorrectiveAction`)}</Button> : null}
          {ncr.status === 'corrective_action' ? <Button onClick={() => confirmTransition('closed')} isLoading={transitionMutation.isPending}><Check className="h-4 w-4" aria-hidden="true" />{t(`${K}.actions.close`)}</Button> : null}
          {ncr.status === 'open' || ncr.status === 'investigating' ? <Button variant="destructive" onClick={() => confirmTransition('cancelled')} isLoading={transitionMutation.isPending}><X className="h-4 w-4" aria-hidden="true" />{t(`${K}.actions.cancel`)}</Button> : null}
        </div>
      </header>
      {actionError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t(`${K}.errors.action`)}</p> : null}
      {validationError ? <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{t(`${K}.errors.${validationError}`)}</p> : null}
      {saveError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t(`${K}.errors.update`)}</p> : null}

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">{t(`${K}.sections.details`)}</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Detail label={t(`${K}.fields.project`)} value={project?.name ?? t(`${K}.notAvailable`)} />
          <Detail label={t(`${K}.fields.site`)} value={site ? `${site.site_code} · ${site.site_name}` : t(`${K}.notAvailable`)} />
          <Detail label={t(`${K}.fields.checkpoint`)} value={checkpointOption ? t(`${K}.checkpointOption`, { itpNumber: checkpointOption.itp.itp_number, sequence: checkpointOption.checkpoint.sequence_number, activity: checkpointOption.checkpoint.activity }) : t(`${K}.notAvailable`)} />
          <Detail label={t(`${K}.fields.subcontract`)} value={subcontract ? `${subcontract.reference} · ${subcontract.title}` : t(`${K}.notAvailable`)} />
        </dl>
      </section>

      <TextSection title={t(`${K}.sections.description`)} value={ncr.description} />
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">{t(`${K}.sections.rootCause`)}</h2>
        {ncr.status === 'investigating' ? (
          <>
            <textarea aria-label={t(`${K}.fields.rootCause`)} rows={4} className={TEXTAREA_CLASS} value={rootCause} onChange={(event) => { setRootCauseDraft({ id: ncr.id, value: event.target.value }); setValidationError(null); }} />
            <div className="mt-3 flex justify-end"><Button type="button" onClick={saveRootCause} isLoading={updateMutation.isPending}><Save className="h-4 w-4" aria-hidden="true" />{t(`${K}.actions.saveRootCause`)}</Button></div>
          </>
        ) : <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{ncr.root_cause || t(`${K}.notAvailable`)}</p>}
      </section>
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">{t(`${K}.sections.correctiveAction`)}</h2>
        {ncr.status === 'corrective_action' ? (
          <>
            <textarea aria-label={t(`${K}.fields.correctiveAction`)} rows={4} className={TEXTAREA_CLASS} value={correctiveAction} onChange={(event) => { setCorrectiveActionDraft({ id: ncr.id, value: event.target.value }); setValidationError(null); }} />
            <div className="mt-3 flex justify-end"><Button type="button" onClick={saveCorrectiveAction} isLoading={updateMutation.isPending}><Save className="h-4 w-4" aria-hidden="true" />{t(`${K}.actions.saveCorrectiveAction`)}</Button></div>
          </>
        ) : <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{ncr.corrective_action || t(`${K}.notAvailable`)}</p>}
      </section>
      <TextSection title={t(`${K}.sections.preventiveAction`)} value={ncr.preventive_action || t(`${K}.notAvailable`)} />
      {ncr.evidence_reference ? <TextSection title={t(`${K}.sections.evidenceReference`)} value={ncr.evidence_reference} /> : null}
    </main>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</dt><dd className="mt-1 text-sm text-gray-900">{value}</dd></div>;
}
function TextSection({ title, value }: { title: string; value: string }) {
  return <section className="rounded-xl border border-gray-200 bg-white p-5"><h2 className="text-base font-semibold text-gray-900">{title}</h2><p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-gray-800">{value}</p></section>;
}
