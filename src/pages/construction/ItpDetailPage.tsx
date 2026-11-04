import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Check, Plus, X } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { Button } from '@/components/ui/Button';
import type {
  ConstructionItpCheckpointStatus,
  ConstructionItpHoldType,
  ConstructionItpStatus,
} from '@/dal/repositories/ConstructionQualityRepository';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';
import { loadAllProjects, loadChangeOrderProjectReferences } from './qualityPageData';

const K = 'construction.itps';
const STATUS_CLASSES: Record<ConstructionItpStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  active: 'bg-blue-100 text-blue-800',
  completed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-red-100 text-red-800',
};
const HOLD_CLASSES: Record<ConstructionItpHoldType, string> = {
  hold: 'bg-red-100 text-red-800',
  witness: 'bg-orange-100 text-orange-800',
  review: 'bg-blue-100 text-blue-800',
  surveillance: 'bg-gray-100 text-gray-700',
};
const CHECKPOINT_STATUS_CLASSES: Record<ConstructionItpCheckpointStatus, string> = {
  pending: 'bg-gray-100 text-gray-700',
  passed: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-800',
  waived: 'bg-slate-100 text-slate-700',
};
const HOLD_TYPES: ConstructionItpHoldType[] = ['hold', 'witness', 'review', 'surveillance'];

function formatDate(value: string | null, locale: string, missing: string): string {
  if (!value) return missing;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}

export function ItpDetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const businessId = useAppStore((state) => state.currentBusiness?.business?.id ?? null);
  const [showAddCheckpoint, setShowAddCheckpoint] = useState(false);
  const [activity, setActivity] = useState('');
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('');
  const [holdType, setHoldType] = useState<ConstructionItpHoldType>('witness');
  const [actionError, setActionError] = useState(false);
  const [checkpointError, setCheckpointError] = useState(false);

  const itpQuery = useQuery({
    queryKey: ['construction', 'itp', businessId, id],
    queryFn: () => repos.quality.getItpById(businessId as string, id as string),
    enabled: Boolean(businessId && id),
  });
  const itp = itpQuery.data;
  const projectsQuery = useQuery({
    queryKey: ['construction', 'quality-projects', businessId],
    queryFn: () => loadAllProjects(businessId as string),
    enabled: Boolean(businessId),
  });
  const referencesQuery = useQuery({
    queryKey: ['construction', 'quality-references-history', businessId, itp?.project_id],
    queryFn: () => loadChangeOrderProjectReferences(businessId as string, itp?.project_id as string, true),
    enabled: Boolean(businessId && itp?.project_id),
  });
  const checkpointsQuery = useQuery({
    queryKey: ['construction', 'itp-checkpoints', businessId, id],
    queryFn: () => repos.quality.listCheckpointsByItp(businessId as string, id as string),
    enabled: Boolean(businessId && id),
  });

  const project = useMemo(() => (projectsQuery.data ?? []).find((row) => row.id === itp?.project_id), [projectsQuery.data, itp?.project_id]);
  const refs = referencesQuery.data;
  const site = refs?.sites.find((row) => row.id === itp?.site_id);
  const section = refs?.boqSections.find((row) => row.id === itp?.boq_section_id);
  const subcontract = refs?.subcontracts.find((row) => row.id === itp?.subcontract_id);
  const checkpoints = checkpointsQuery.data ?? [];
  const nextSequence = checkpoints.reduce((max, checkpoint) => Math.max(max, checkpoint.sequence_number), 0) + 1;

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['construction', 'itp', businessId, id] }),
      queryClient.invalidateQueries({ queryKey: ['construction', 'itp-checkpoints', businessId, id] }),
      queryClient.invalidateQueries({ queryKey: ['construction', 'itps', businessId] }),
    ]);
  };
  const transitionMutation = useMutation({
    mutationFn: (status: ConstructionItpStatus) => repos.quality.transitionItpStatus(id as string, status),
    onSuccess: refresh,
    onError: () => setActionError(true),
  });
  const checkpointMutation = useMutation({
    mutationFn: ({ checkpointId, status }: { checkpointId: string; status: ConstructionItpCheckpointStatus }) =>
      repos.quality.updateCheckpoint(businessId as string, checkpointId, { status }),
    onSuccess: refresh,
    onError: () => setCheckpointError(true),
  });
  const addCheckpointMutation = useMutation({
    mutationFn: () => repos.quality.createCheckpoint({
      business_id: businessId as string,
      itp_id: id as string,
      sequence_number: nextSequence,
      activity: activity.trim(),
      acceptance_criteria: acceptanceCriteria.trim(),
      hold_type: holdType,
    }),
    onSuccess: async () => {
      setActivity('');
      setAcceptanceCriteria('');
      setHoldType('witness');
      setShowAddCheckpoint(false);
      await refresh();
    },
    onError: () => setCheckpointError(true),
  });

  const confirmTransition = (status: ConstructionItpStatus) => {
    const key = status === 'active' ? 'confirmActivate' : status === 'completed' ? 'confirmComplete' : 'confirmCancel';
    if (!window.confirm(t(`${K}.${key}`))) return;
    setActionError(false);
    transitionMutation.mutate(status);
  };
  const addCheckpoint = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCheckpointError(false);
    addCheckpointMutation.mutate();
  };
  const markCheckpoint = (checkpointId: string, status: ConstructionItpCheckpointStatus) => {
    setCheckpointError(false);
    checkpointMutation.mutate({ checkpointId, status });
  };

  if (itpQuery.isLoading) return <main className="mx-auto max-w-7xl px-4 py-8 text-center text-sm text-gray-500">{t(`${K}.loadingDetail`)}</main>;
  if (itpQuery.isError || !itp) {
    return <main className="mx-auto max-w-7xl px-4 py-8"><p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t(`${K}.errors.detail`)}</p></main>;
  }

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
      <Link to="/construction/itps" className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />{t(`${K}.backToList`)}
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-semibold text-brand-700">{itp.itp_number}</p>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASSES[itp.status]}`}>{t(`${K}.statuses.${itp.status}`)}</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-gray-900">{itp.title}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {itp.status === 'draft' ? <Button type="button" onClick={() => confirmTransition('active')} isLoading={transitionMutation.isPending}><Check className="h-4 w-4" aria-hidden="true" />{t(`${K}.actions.activate`)}</Button> : null}
          {itp.status === 'active' ? <Button type="button" onClick={() => confirmTransition('completed')} isLoading={transitionMutation.isPending}><Check className="h-4 w-4" aria-hidden="true" />{t(`${K}.actions.complete`)}</Button> : null}
          {itp.status === 'draft' || itp.status === 'active' ? <Button type="button" variant="destructive" onClick={() => confirmTransition('cancelled')} isLoading={transitionMutation.isPending}><X className="h-4 w-4" aria-hidden="true" />{t(`${K}.actions.cancel`)}</Button> : null}
        </div>
      </header>

      {actionError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t(`${K}.errors.action`)}</p> : null}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">{t(`${K}.sections.details`)}</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Detail label={t(`${K}.fields.project`)} value={project?.name ?? t(`${K}.notAvailable`)} />
          <Detail label={t(`${K}.fields.site`)} value={site ? `${site.site_code} · ${site.site_name}` : t(`${K}.notAvailable`)} />
          <Detail label={t(`${K}.fields.boqSection`)} value={section ? `${section.code} · ${section.title}` : t(`${K}.notAvailable`)} />
          <Detail label={t(`${K}.fields.subcontract`)} value={subcontract ? `${subcontract.reference} · ${subcontract.title}` : t(`${K}.notAvailable`)} />
          <Detail label={t(`${K}.fields.created`)} value={new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(itp.created_at))} />
        </dl>
        <div className="mt-5 border-t border-gray-100 pt-4">
          <h3 className="text-sm font-semibold text-gray-700">{t(`${K}.fields.scope`)}</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-800">{itp.scope}</p>
        </div>
        {itp.evidence_reference ? <div className="mt-4"><Detail label={t(`${K}.fields.evidenceReference`)} value={itp.evidence_reference} /></div> : null}
      </section>

      <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{t(`${K}.sections.checkpoints`)}</h2>
            <p className="mt-1 text-sm text-gray-500">{t(`${K}.checkpointCount`, { count: checkpoints.length })}</p>
          </div>
          {itp.status === 'draft' ? <Button type="button" variant="secondary" onClick={() => setShowAddCheckpoint((open) => !open)}><Plus className="h-4 w-4" aria-hidden="true" />{t(`${K}.actions.addCheckpoint`)}</Button> : null}
        </header>
        {checkpointError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t(`${K}.errors.checkpoint`)}</p> : null}
        {showAddCheckpoint ? (
          <form onSubmit={addCheckpoint} className="grid gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 md:grid-cols-2">
            <label className="block text-sm font-medium text-gray-700">
              {t(`${K}.fields.sequence`)}
              <input type="number" min="1" value={nextSequence} readOnly className="mt-1 w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm" />
            </label>
            <label className="block text-sm font-medium text-gray-700">
              {t(`${K}.fields.holdType`)}
              <select className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" value={holdType} onChange={(event) => setHoldType(event.target.value as ConstructionItpHoldType)}>
                {HOLD_TYPES.map((value) => <option key={value} value={value}>{t(`${K}.holdTypes.${value}`)}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium text-gray-700 md:col-span-2">
              {t(`${K}.fields.activity`)} <span aria-hidden="true">*</span>
              <input required maxLength={300} value={activity} onChange={(event) => setActivity(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="block text-sm font-medium text-gray-700 md:col-span-2">
              {t(`${K}.fields.acceptanceCriteria`)} <span aria-hidden="true">*</span>
              <textarea required maxLength={10000} rows={3} value={acceptanceCriteria} onChange={(event) => setAcceptanceCriteria(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
            </label>
            <div className="flex justify-end gap-2 md:col-span-2">
              <Button type="button" variant="secondary" onClick={() => setShowAddCheckpoint(false)}>{t('common.cancel')}</Button>
              <Button type="submit" isLoading={addCheckpointMutation.isPending}>{t(`${K}.actions.saveCheckpoint`)}</Button>
            </div>
          </form>
        ) : null}
        {checkpointsQuery.isLoading ? <p className="py-4 text-sm text-gray-500">{t(`${K}.loadingCheckpoints`)}</p> : null}
        {!checkpointsQuery.isLoading && checkpoints.length === 0 ? <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">{t(`${K}.empty.checkpoints`)}</p> : null}
        {checkpoints.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th scope="col" className="px-3 py-3">{t(`${K}.columns.sequence`)}</th>
                  <th scope="col" className="px-3 py-3">{t(`${K}.columns.activity`)}</th>
                  <th scope="col" className="px-3 py-3">{t(`${K}.columns.acceptanceCriteria`)}</th>
                  <th scope="col" className="px-3 py-3">{t(`${K}.columns.holdType`)}</th>
                  <th scope="col" className="px-3 py-3">{t(`${K}.columns.status`)}</th>
                  <th scope="col" className="px-3 py-3">{t(`${K}.columns.inspectedBy`)}</th>
                  <th scope="col" className="px-3 py-3">{t(`${K}.columns.date`)}</th>
                  {itp.status === 'active' ? <th scope="col" className="px-3 py-3">{t('common.actions')}</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {checkpoints.map((checkpoint) => (
                  <tr key={checkpoint.id}>
                    <td className="whitespace-nowrap px-3 py-3 font-semibold text-gray-700">{checkpoint.sequence_number}</td>
                    <td className="min-w-40 px-3 py-3 text-gray-900">{checkpoint.activity}</td>
                    <td className="min-w-56 px-3 py-3 text-gray-700">{checkpoint.acceptance_criteria}</td>
                    <td className="whitespace-nowrap px-3 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${HOLD_CLASSES[checkpoint.hold_type]}`}>{t(`${K}.holdTypes.${checkpoint.hold_type}`)}</span></td>
                    <td className="whitespace-nowrap px-3 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${CHECKPOINT_STATUS_CLASSES[checkpoint.status]}`}>{t(`${K}.checkpointStatuses.${checkpoint.status}`)}</span></td>
                    <td className="whitespace-nowrap px-3 py-3 text-gray-600">{checkpoint.inspected_by ? t(`${K}.teamMember`) : t(`${K}.notAvailable`)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-gray-600">{formatDate(checkpoint.inspected_at, i18n.language, t(`${K}.notAvailable`))}</td>
                    {itp.status === 'active' ? (
                      <td className="whitespace-nowrap px-3 py-3">
                        {checkpoint.status === 'pending' ? (
                          <div className="flex gap-1.5">
                            <Button size="sm" onClick={() => markCheckpoint(checkpoint.id, 'passed')} isLoading={checkpointMutation.isPending} disabled={checkpointMutation.isPending}><Check className="h-3.5 w-3.5" aria-hidden="true" />{t(`${K}.actions.pass`)}</Button>
                            <Button size="sm" variant="destructive" onClick={() => markCheckpoint(checkpoint.id, 'failed')} disabled={checkpointMutation.isPending}>{t(`${K}.actions.fail`)}</Button>
                            <Button size="sm" variant="secondary" onClick={() => markCheckpoint(checkpoint.id, 'waived')} disabled={checkpointMutation.isPending}>{t(`${K}.actions.waive`)}</Button>
                          </div>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</dt><dd className="mt-1 text-sm text-gray-900">{value}</dd></div>;
}
