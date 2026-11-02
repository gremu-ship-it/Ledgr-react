import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Check, Pencil, Send, X } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button } from '@/components/ui/Button';
import type { ConstructionChangeOrderRow, ConstructionChangeOrderStatus } from '@/dal/repositories/ConstructionChangeOrderRepository';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';
import { loadAllProjects, loadChangeOrderProjectReferences } from './changeOrderPageData';
import { ChangeOrderForm, type ChangeOrderFormValues } from './ChangeOrderForm';

const STATUSES: ConstructionChangeOrderStatus[] = ['draft', 'submitted', 'approved', 'rejected', 'cancelled'];
const STATUS_CLASSES: Record<ConstructionChangeOrderStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  submitted: 'bg-blue-100 text-blue-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
  cancelled: 'bg-slate-100 text-slate-700',
};

function knownStatus(status: string): ConstructionChangeOrderStatus {
  return STATUSES.includes(status as ConstructionChangeOrderStatus)
    ? status as ConstructionChangeOrderStatus
    : 'draft';
}

function formatCurrency(value: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

function formatDate(value: string | null, locale: string, missing: string): string {
  if (!value) return missing;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}

function safeReferenceUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function formValues(changeOrder: ConstructionChangeOrderRow): ChangeOrderFormValues {
  return {
    project_id: changeOrder.project_id,
    site_id: changeOrder.site_id ?? '',
    co_number: changeOrder.co_number,
    title: changeOrder.title,
    description: changeOrder.description,
    reason: changeOrder.reason,
    cost_impact: Number(changeOrder.cost_impact),
    time_impact_days: Number(changeOrder.time_impact_days),
    boq_section_id: changeOrder.boq_section_id ?? '',
    subcontract_id: changeOrder.subcontract_id ?? '',
    evidence_reference: changeOrder.evidence_reference ?? '',
  };
}

export function ChangeOrderDetailPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const currentBusiness = useAppStore((state) => state.currentBusiness?.business ?? null);
  const businessId = currentBusiness?.id ?? null;
  const currency = currentBusiness?.base_currency ?? 'MWK';
  const [editOpen, setEditOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [actionError, setActionError] = useState(false);

  const changeOrderQuery = useQuery({
    queryKey: ['construction', 'changeOrder', businessId, id],
    queryFn: () => repos.changeOrder.getById(businessId as string, id as string),
    enabled: Boolean(businessId && id),
  });
  const changeOrder = changeOrderQuery.data;
  const status = changeOrder ? knownStatus(changeOrder.status) : null;
  const projectsQuery = useQuery({
    queryKey: ['construction', 'change-order-projects', businessId],
    queryFn: () => loadAllProjects(businessId as string),
    enabled: Boolean(businessId),
  });
  const referencesQuery = useQuery({
    queryKey: ['construction', 'change-order-references', businessId, changeOrder?.project_id],
    queryFn: () => loadChangeOrderProjectReferences(businessId as string, changeOrder?.project_id as string, true),
    enabled: Boolean(businessId && changeOrder?.project_id),
  });
  const project = useMemo(
    () => (projectsQuery.data ?? []).find((candidate) => candidate.id === changeOrder?.project_id),
    [projectsQuery.data, changeOrder?.project_id],
  );
  const references = referencesQuery.data;
  const site = references?.sites.find((candidate) => candidate.id === changeOrder?.site_id);
  const boqSection = references?.boqSections.find((candidate) => candidate.id === changeOrder?.boq_section_id);
  const subcontract = references?.subcontracts.find((candidate) => candidate.id === changeOrder?.subcontract_id);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['construction', 'changeOrder', businessId, id] }),
      queryClient.invalidateQueries({ queryKey: ['construction', 'changeOrders', businessId] }),
      queryClient.invalidateQueries({ queryKey: ['construction', 'changeOrderSummary', businessId] }),
    ]);
  };
  const transitionMutation = useMutation({
    mutationFn: ({ nextStatus, reason }: { nextStatus: ConstructionChangeOrderStatus; reason?: string }) =>
      repos.changeOrder.transitionStatus(id as string, nextStatus, reason),
    onSuccess: async (_data, variables) => {
      if (variables.nextStatus === 'rejected') {
        setRejectOpen(false);
        setRejectionReason('');
      }
      await refresh();
    },
    onError: () => setActionError(true),
  });
  const updateMutation = useMutation({
    mutationFn: (values: ChangeOrderFormValues) => repos.changeOrder.update(businessId as string, id as string, values),
    onSuccess: async () => {
      setEditOpen(false);
      await refresh();
    },
  });

  const confirmTransition = (nextStatus: ConstructionChangeOrderStatus) => {
    const messageKey = nextStatus === 'submitted'
      ? 'confirmSubmit'
      : nextStatus === 'approved'
        ? 'confirmApprove'
        : 'confirmCancel';
    if (!window.confirm(t(`changeOrders.${messageKey}`))) return;
    setActionError(false);
    transitionMutation.mutate({ nextStatus });
  };

  const submitRejection = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const reason = rejectionReason.trim();
    if (!reason) return;
    setActionError(false);
    transitionMutation.mutate({
      nextStatus: 'rejected',
      reason,
    });
  };

  if (changeOrderQuery.isLoading) {
    return <main className="mx-auto max-w-5xl px-4 py-8 text-center text-sm text-gray-500">{t('changeOrders.loading')}</main>;
  }
  if (changeOrderQuery.isError || !changeOrder || !status) {
    return (
      <main className="mx-auto max-w-5xl space-y-4 px-4 py-8">
        <Link to="/construction/change-orders" className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />{t('changeOrders.backToList')}
        </Link>
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t('changeOrders.errors.detail')}</p>
      </main>
    );
  }

  const costImpact = Number(changeOrder.cost_impact ?? 0);
  const timeImpact = Number(changeOrder.time_impact_days ?? 0);
  const evidenceUrl = changeOrder.evidence_reference ? safeReferenceUrl(changeOrder.evidence_reference) : null;
  const canCancel = status === 'draft' || status === 'submitted';

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <Link to="/construction/change-orders" className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />{t('changeOrders.backToList')}
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-gray-900">{changeOrder.co_number}</h1>
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASSES[status]}`}>{t(`changeOrders.statuses.${status}`)}</span>
          </div>
          <p className="text-lg font-medium text-gray-800">{changeOrder.title}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {status === 'draft' ? (
            <>
              <Button type="button" variant="secondary" onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" aria-hidden="true" />{t('changeOrders.edit')}
              </Button>
              <Button type="button" onClick={() => confirmTransition('submitted')} disabled={transitionMutation.isPending}>
                <Send className="h-4 w-4" aria-hidden="true" />{t('changeOrders.submit')}
              </Button>
            </>
          ) : null}
          {status === 'submitted' ? (
            <>
              <Button type="button" onClick={() => confirmTransition('approved')} disabled={transitionMutation.isPending}>
                <Check className="h-4 w-4" aria-hidden="true" />{t('changeOrders.approve')}
              </Button>
              <Button type="button" variant="destructive" onClick={() => { setActionError(false); setRejectOpen(true); }} disabled={transitionMutation.isPending}>
                <X className="h-4 w-4" aria-hidden="true" />{t('changeOrders.reject')}
              </Button>
            </>
          ) : null}
          {canCancel ? <Button type="button" variant="destructive" onClick={() => confirmTransition('cancelled')} disabled={transitionMutation.isPending}>{t('changeOrders.cancel')}</Button> : null}
        </div>
      </header>

      {actionError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t('changeOrders.errors.action')}</p> : null}
      {referencesQuery.isError || projectsQuery.isError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t('changeOrders.errors.references')}</p> : null}

      {editOpen ? (
        <section aria-labelledby="change-order-edit-heading" className="space-y-4">
          <h2 id="change-order-edit-heading" className="text-lg font-semibold text-gray-900">{t('changeOrders.editTitle')}</h2>
          <ChangeOrderForm
            key={changeOrder.id}
            initialValues={formValues(changeOrder)}
            submitLabel={t('changeOrders.saveChanges')}
            isSubmitting={updateMutation.isPending}
            errorMessage={updateMutation.isError ? t('changeOrders.errors.update') : undefined}
            onCancel={() => setEditOpen(false)}
            onSubmit={(values) => updateMutation.mutate(values)}
          />
        </section>
      ) : null}

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900">{t('changeOrders.sections.details')}</h2>
        <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label={t('changeOrders.fields.project')} value={project?.name ?? t('common.unknown')} />
          <Detail label={t('changeOrders.fields.site')} value={site ? `${site.site_code} · ${site.site_name}` : t('changeOrders.notAvailable')} />
          <Detail label={t('changeOrders.fields.boqSection')} value={boqSection ? `${boqSection.code} · ${boqSection.title}` : t('changeOrders.notAvailable')} />
          <Detail label={t('changeOrders.fields.subcontract')} value={subcontract ? `${subcontract.reference} · ${subcontract.title}` : t('changeOrders.notAvailable')} />
          <Detail label={t('changeOrders.fields.created')} value={formatDate(changeOrder.created_at, i18n.language, t('changeOrders.notAvailable'))} />
        </dl>
      </section>

      <TextSection title={t('changeOrders.sections.description')} text={changeOrder.description} />
      <TextSection title={t('changeOrders.fields.reason')} text={changeOrder.reason} />

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900">{t('changeOrders.sections.impact')}</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <Detail label={t('changeOrders.fields.costImpact')} value={formatCurrency(costImpact, currency, i18n.language)} valueClass={costImpact > 0 ? 'text-emerald-700' : costImpact < 0 ? 'text-red-700' : undefined} />
          <Detail label={t('changeOrders.fields.timeImpact')} value={`${timeImpact > 0 ? '+' : ''}${timeImpact}`} />
        </dl>
      </section>

      {changeOrder.evidence_reference ? (
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="text-base font-semibold text-gray-900">{t('changeOrders.fields.evidenceReference')}</h2>
          {evidenceUrl
            ? <a className="mt-2 inline-block break-all text-sm font-medium text-brand-700 underline" href={evidenceUrl} target="_blank" rel="noreferrer">{changeOrder.evidence_reference}</a>
            : <p className="mt-2 break-all text-sm text-gray-700">{changeOrder.evidence_reference}</p>}
        </section>
      ) : null}

      {status === 'rejected' ? (
        <section className="rounded-xl border border-red-200 bg-red-50 p-5">
          <h2 className="text-base font-semibold text-red-900">{t('changeOrders.rejectionReason')}</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-red-800">{changeOrder.rejection_reason ?? t('changeOrders.notAvailable')}</p>
        </section>
      ) : null}

      {status === 'approved' ? (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-5">
          <h2 className="text-base font-semibold text-gray-900">{t('changeOrders.approvalInfo')}</h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <Detail label={t('changeOrders.approvedBy')} value={changeOrder.approved_by ?? t('changeOrders.notAvailable')} />
            <Detail label={t('changeOrders.approvedAt')} value={formatDate(changeOrder.approved_at, i18n.language, t('changeOrders.notAvailable'))} />
          </dl>
        </section>
      ) : null}

      {changeOrder.submitted_at || changeOrder.submitted_by ? (
        <section className="rounded-xl border border-blue-200 bg-blue-50/50 p-5">
          <h2 className="text-base font-semibold text-gray-900">{t('changeOrders.submissionInfo')}</h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <Detail label={t('changeOrders.submittedBy')} value={changeOrder.submitted_by ?? t('changeOrders.notAvailable')} />
            <Detail label={t('changeOrders.submittedAt')} value={formatDate(changeOrder.submitted_at, i18n.language, t('changeOrders.notAvailable'))} />
          </dl>
        </section>
      ) : null}

      {rejectOpen ? (
        <div role="dialog" aria-modal="true" aria-labelledby="change-order-reject-heading" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <section className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h2 id="change-order-reject-heading" className="text-lg font-semibold text-gray-900">{t('changeOrders.reject')}</h2>
            <p className="mt-2 text-sm text-gray-600">{t('changeOrders.confirmReject')}</p>
            <form onSubmit={submitRejection} className="mt-4 space-y-4">
              <label className="block text-sm font-medium text-gray-700">
                {t('changeOrders.rejectionReason')} <span aria-hidden="true">*</span>
                <textarea required maxLength={10000} rows={4} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} />
              </label>
              {rejectionReason.trim().length === 0 ? <p className="text-sm text-red-700">{t('changeOrders.rejectionRequired')}</p> : null}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setRejectOpen(false)}>{t('common.cancel')}</Button>
                <Button type="submit" variant="destructive" isLoading={transitionMutation.isPending} disabled={!rejectionReason.trim() || transitionMutation.isPending}>{t('changeOrders.reject')}</Button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      <Button type="button" variant="secondary" onClick={() => navigate('/construction/change-orders')}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />{t('changeOrders.backToList')}
      </Button>
    </main>
  );
}

function Detail({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div>
      <dt className="text-sm text-gray-500">{label}</dt>
      <dd className={`mt-1 break-words text-sm font-medium ${valueClass ?? 'text-gray-900'}`}>{value}</dd>
    </div>
  );
}

function TextSection({ title, text }: { title: string; text: string }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-gray-800">{text}</p>
    </section>
  );
}
