import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Check, Pencil, Send, X } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { Button } from '@/components/ui/Button';
import type { ConstructionRfiPriority, ConstructionRfiStatus } from '@/dal/repositories/ConstructionRfiRepository';
import type { UpdateConstructionRfiInput } from '@/dal/repositories/ConstructionRfiRepository';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';
import { loadAllProjects, loadProjectReferences } from './rfiPageData';
import { RfiFormFields, type RfiFormValues } from './RfiFormFields';

const k = 'construction.rfis';
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

function formatDate(value: string | null, locale: string, missing: string) {
  if (!value) return missing;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? missing : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}

function referenceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function RfiDetailPage() {
  const { t, i18n } = useTranslation();
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const businessId = useAppStore((state) => state.currentBusiness?.business?.id ?? null);
  const [answerOpen, setAnswerOpen] = useState(false);
  const [answer, setAnswer] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editValues, setEditValues] = useState<RfiFormValues>({
    project_id: '', site_id: '', rfi_number: '', title: '', question: '', priority: 'normal',
    due_date: '', evidence: '', proposed_solution: '', boq_item_id: '', subcontract_id: '', drawing_reference: '',
  });
  const [actionError, setActionError] = useState(false);

  const rfiQuery = useQuery({
    queryKey: ['construction', 'rfi', businessId, id],
    queryFn: () => repos.rfi.getById(id),
    enabled: Boolean(businessId && id),
  });
  const rfi = rfiQuery.data;
  const projectsQuery = useQuery({
    queryKey: ['construction', 'rfi-projects', businessId],
    queryFn: () => loadAllProjects(businessId as string),
    enabled: Boolean(businessId && rfi),
  });
  const referencesQuery = useQuery({
    queryKey: ['construction', 'rfi-references', businessId, rfi?.project_id],
    queryFn: () => loadProjectReferences(businessId as string, rfi?.project_id as string),
    enabled: Boolean(businessId && rfi?.project_id),
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['construction', 'rfi', businessId, id] }),
      queryClient.invalidateQueries({ queryKey: ['construction', 'rfis'] }),
    ]);
  };
  const transitionMutation = useMutation({
    mutationFn: ({ status, response }: { status: ConstructionRfiStatus; response?: string }) =>
      repos.rfi.transitionStatus(id, status, response),
    onSuccess: async () => { setActionError(false); setAnswerOpen(false); setAnswer(''); await refresh(); },
    onError: () => setActionError(true),
  });
  const updateMutation = useMutation({
    mutationFn: (changes: UpdateConstructionRfiInput) => repos.rfi.update(id, changes),
    onSuccess: async () => { setActionError(false); setEditOpen(false); await refresh(); },
    onError: () => setActionError(true),
  });

  const status = rfi?.status as ConstructionRfiStatus | undefined;
  const priority = rfi?.priority as ConstructionRfiPriority | undefined;
  const references = referencesQuery.data;
  const project = projectsQuery.data?.find((candidate) => candidate.id === rfi?.project_id);
  const site = references?.sites.find((candidate) => candidate.id === rfi?.site_id);
  const boqItem = references?.boqItems.find((candidate) => candidate.id === rfi?.boq_item_id);
  const subcontract = references?.subcontracts.find((candidate) => candidate.id === rfi?.subcontract_id);

  const confirmTransition = (nextStatus: ConstructionRfiStatus) => {
    const confirmationKey = nextStatus === 'cancelled' ? 'confirmCancel'
      : nextStatus === 'closed' ? 'confirmClose' : 'confirmSubmit';
    if (!window.confirm(t(`${k}.${confirmationKey}`))) return;
    setActionError(false);
    transitionMutation.mutate({ status: nextStatus });
  };

  const openEdit = () => {
    if (!rfi) return;
    setEditValues({
      project_id: rfi.project_id,
      site_id: rfi.site_id ?? '',
      rfi_number: rfi.rfi_number,
      title: rfi.title,
      question: rfi.question,
      priority: rfi.priority as ConstructionRfiPriority,
      due_date: rfi.due_date ?? '',
      evidence: rfi.evidence ?? '',
      proposed_solution: rfi.proposed_solution ?? '',
      boq_item_id: rfi.boq_item_id ?? '',
      subcontract_id: rfi.subcontract_id ?? '',
      drawing_reference: rfi.drawing_reference ?? '',
    });
    setEditOpen(true);
  };

  const saveEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setActionError(false);
    updateMutation.mutate({
      title: editValues.title.trim(),
      question: editValues.question.trim(),
      priority: editValues.priority,
      due_date: editValues.due_date || null,
      evidence: editValues.evidence.trim() || null,
      proposed_solution: editValues.proposed_solution.trim() || null,
      boq_item_id: editValues.boq_item_id || null,
      subcontract_id: editValues.subcontract_id || null,
      drawing_reference: editValues.drawing_reference.trim() || null,
    });
  };

  const submitAnswer = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setActionError(false);
    transitionMutation.mutate({ status: 'answered', response: answer.trim() });
  };

  if (rfiQuery.isLoading) {
    return <main className="mx-auto max-w-5xl px-4 py-8 text-center text-sm text-gray-500">{t(`${k}.loading`)}</main>;
  }
  if (rfiQuery.isError || !rfi || !status || !priority) {
    return (
      <main className="mx-auto max-w-5xl space-y-4 px-4 py-8">
        <Link to="/construction/rfis" className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />{t(`${k}.backToList`)}
        </Link>
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t(`${k}.errors.detail`)}</p>
      </main>
    );
  }

  const canAnswer = status === 'open' || status === 'submitted';
  const canCancel = status === 'draft' || status === 'open' || status === 'submitted';
  const evidenceHref = rfi.evidence ? referenceUrl(rfi.evidence) : null;

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <Link to="/construction/rfis" className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />{t(`${k}.backToList`)}
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-gray-900">{rfi.rfi_number}</h1>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClasses[status]}`}>{t(`${k}.statuses.${status}`)}</span>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${priorityClasses[priority]}`}>{t(`${k}.priorities.${priority}`)}</span>
          </div>
          <p className="text-lg font-medium text-gray-800">{rfi.title}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {status === 'draft' ? (
            <>
              <Button type="button" variant="secondary" onClick={openEdit}>
                <Pencil className="h-4 w-4" aria-hidden="true" />{t(`${k}.actions.edit`)}
              </Button>
              <Button type="button" onClick={() => confirmTransition('submitted')} disabled={transitionMutation.isPending}>
                <Send className="h-4 w-4" aria-hidden="true" />{t(`${k}.actions.submit`)}
              </Button>
            </>
          ) : null}
          {canAnswer ? <Button type="button" onClick={() => { setActionError(false); setAnswerOpen(true); }}>{t(`${k}.actions.answer`)}</Button> : null}
          {status === 'answered' ? <Button type="button" onClick={() => confirmTransition('closed')} disabled={transitionMutation.isPending}>{t(`${k}.actions.close`)}</Button> : null}
          {canCancel ? <Button type="button" variant="destructive" onClick={() => confirmTransition('cancelled')} disabled={transitionMutation.isPending}>{t(`${k}.actions.cancelRfi`)}</Button> : null}
        </div>
      </header>

      {actionError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t(`${k}.errors.action`)}</p> : null}
      {referencesQuery.isError || projectsQuery.isError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t(`${k}.errors.references`)}</p> : null}

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900">{t(`${k}.sections.details`)}</h2>
        <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label={t(`${k}.fields.project`)} value={project?.name ?? t(`${k}.notAvailable`)} />
          <Detail label={t(`${k}.fields.site`)} value={site ? `${site.site_code} · ${site.site_name}` : t(`${k}.notAvailable`)} />
          <Detail label={t(`${k}.fields.boqItem`)} value={boqItem ? `${boqItem.item_number} · ${boqItem.description}` : t(`${k}.notAvailable`)} />
          <Detail label={t(`${k}.fields.subcontract`)} value={subcontract ? `${subcontract.reference} · ${subcontract.title}` : t(`${k}.notAvailable`)} />
          <Detail label={t(`${k}.fields.drawingReference`)} value={rfi.drawing_reference ?? t(`${k}.notAvailable`)} />
          <Detail label={t(`${k}.fields.dueDate`)} value={formatDate(rfi.due_date, i18n.language, t(`${k}.notAvailable`))} />
        </dl>
      </section>

      <TextSection title={t(`${k}.sections.question`)} text={rfi.question} />
      {rfi.proposed_solution ? <TextSection title={t(`${k}.sections.proposedSolution`)} text={rfi.proposed_solution} /> : null}
      {rfi.response || status === 'answered' || status === 'closed' ? (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-5">
          <h2 className="text-base font-semibold text-gray-900">{t(`${k}.sections.response`)}</h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <Detail label={t(`${k}.responseDate`)} value={formatDate(rfi.answered_at, i18n.language, t(`${k}.notAvailable`))} />
            <Detail label={t(`${k}.responder`)} value={rfi.answered_by ? t(`${k}.responseRecordedByTeamMember`) : t(`${k}.notAvailable`)} />
          </dl>
          <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-gray-800">{rfi.response ?? t(`${k}.responsePending`)}</p>
        </section>
      ) : null}
      {rfi.evidence ? (
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="text-base font-semibold text-gray-900">{t(`${k}.sections.evidence`)}</h2>
          {evidenceHref ? <a className="mt-2 inline-block break-all text-sm font-medium text-brand-700 underline" href={evidenceHref} target="_blank" rel="noreferrer">{t(`${k}.openEvidenceReference`)}</a> : <p className="mt-2 break-all text-sm text-gray-700">{rfi.evidence}</p>}
        </section>
      ) : null}

      {answerOpen ? (
        <Dialog title={t(`${k}.dialog.answerTitle`)} onClose={() => setAnswerOpen(false)}>
          <form onSubmit={submitAnswer} className="space-y-4">
            <label className="block text-sm font-medium text-gray-700">
              {t(`${k}.fields.response`)} <span aria-hidden="true">*</span>
              <textarea className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" rows={6} value={answer} onChange={(event) => setAnswer(event.target.value)} required maxLength={20000} />
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setAnswerOpen(false)}>{t('common.cancel')}</Button>
              <Button type="submit" isLoading={transitionMutation.isPending}><Check className="h-4 w-4" aria-hidden="true" />{t(`${k}.actions.saveResponse`)}</Button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {editOpen ? (
        <Dialog title={t(`${k}.dialog.editTitle`)} onClose={() => setEditOpen(false)}>
          <form onSubmit={saveEdit} className="space-y-5">
            <RfiFormFields
              values={editValues}
              setValues={setEditValues}
              projects={projectsQuery.data ?? []}
              sites={references?.sites ?? []}
              boqItems={references?.boqItems ?? []}
              subcontracts={references?.subcontracts ?? []}
              showRfiNumber={false}
              projectDisabled
              siteDisabled
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setEditOpen(false)}>{t('common.cancel')}</Button>
              <Button type="submit" isLoading={updateMutation.isPending}><Check className="h-4 w-4" aria-hidden="true" />{t('common.save')}</Button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </main>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</dt><dd className="mt-1 text-sm text-gray-900">{value}</dd></div>;
}

function TextSection({ title, text }: { title: string; text: string }) {
  return <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"><h2 className="text-base font-semibold text-gray-900">{title}</h2><p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-gray-800">{text}</p></section>;
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-label={title} className="my-8 w-full max-w-3xl rounded-xl bg-white p-5 shadow-xl sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button type="button" className="rounded-md p-1 text-gray-500 hover:bg-gray-100" onClick={onClose} aria-label={t(`${k}.actions.closeDialog`)}>
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
