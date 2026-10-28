import { useMemo, useRef, useState, type FormEvent } from 'react';
import type { Business } from '@/types';
import { MaterialReceiptPreparationSection } from '@/components/construction/MaterialReceiptPreparationSection';
import { MaterialTransferPreparationSection } from '@/components/construction/MaterialTransferPreparationSection';
import { useAppStore } from '@/store/useAppStore';
import { PlanGate } from '@/components/billing/PlanGate';
import type {
  LocalMaterialReceiptPreparation,
  MaterialReceiptPreparationFields,
  MaterialReceiptPreparationStatus,
} from '@/lib/construction/materialReceiptPreparation';
import type {
  LocalMaterialTransferPreparation,
  MaterialTransferPreparationFields,
  MaterialTransferPreparationStage,
} from '@/lib/construction/materialTransferPreparation';
import {
  CONSTRUCTION_WORKSPACE_STATUSES,
  CONSTRUCTION_WORKSPACE_STATUS_LABELS,
  validateConstructionWorkspaceDraft,
  type ConstructionWorkspaceDraftErrors,
  type ConstructionWorkspaceDraftFields,
  type ConstructionWorkspaceStatus,
} from '@/lib/projectsFundingSources/constructionWorkspaceDraftValidation';

interface LocalConstructionProjectDraft extends ConstructionWorkspaceDraftFields {
  /** Component-local key only; never displayed or sent to Ledgr. */
  localId: number;
  businessId: string;
  businessName: string;
  createdAt: string;
  updatedAt: string;
}

type WorkspaceView =
  | { mode: 'list' }
  | { mode: 'form'; draftId?: number }
  | { mode: 'detail'; draftId: number };

type StatusFilter = 'all' | ConstructionWorkspaceStatus;

type FieldKind = 'text' | 'date' | 'amount' | 'currency';

const FIELD_CLASS = 'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const STATUS_CLASS: Record<ConstructionWorkspaceStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  active: 'bg-emerald-50 text-emerald-700',
  needs_attention: 'bg-amber-50 text-amber-800',
  completed: 'bg-blue-50 text-blue-700',
};

function emptyDraftFields(baseCurrency?: string | null): ConstructionWorkspaceDraftFields {
  const currency = baseCurrency?.trim().toUpperCase() ?? '';
  const defaultCurrency = /^[A-Z]{3}$/.test(currency) ? currency : '';
  return {
    projectCode: '',
    projectName: '',
    clientName: '',
    siteName: '',
    siteLocation: '',
    contractValue: '',
    contractCurrency: defaultCurrency,
    approvedBudget: '',
    budgetCurrency: defaultCurrency,
    plannedStartDate: '',
    plannedCompletionDate: '',
    projectManagerName: '',
    status: 'draft',
  };
}

function fieldsFromDraft(draft: LocalConstructionProjectDraft): ConstructionWorkspaceDraftFields {
  return {
    projectCode: draft.projectCode,
    projectName: draft.projectName,
    clientName: draft.clientName,
    siteName: draft.siteName,
    siteLocation: draft.siteLocation,
    contractValue: draft.contractValue,
    contractCurrency: draft.contractCurrency,
    approvedBudget: draft.approvedBudget,
    budgetCurrency: draft.budgetCurrency,
    plannedStartDate: draft.plannedStartDate,
    plannedCompletionDate: draft.plannedCompletionDate,
    projectManagerName: draft.projectManagerName,
    status: draft.status,
  };
}

export function ConstructionProjectSetupDraftPage() {
  const business = useAppStore((state) => state.currentBusiness?.business ?? null);
  return (
    <PlanGate minPlan="enterprise" featureNameKey="navigation.sections.construction">
      <ConstructionWorkspace key={business?.id ?? 'no-business'} business={business} />
    </PlanGate>
  );
}

export const ConstructionProjectWorkspacePage = ConstructionProjectSetupDraftPage;

function ConstructionWorkspace({ business }: { business: Business | null }) {
  const [drafts, setDrafts] = useState<LocalConstructionProjectDraft[]>([]);
  const [receiptPreparations, setReceiptPreparations] = useState<LocalMaterialReceiptPreparation[]>([]);
  const [transferPreparations, setTransferPreparations] = useState<LocalMaterialTransferPreparation[]>([]);
  const [view, setView] = useState<WorkspaceView>({ mode: 'list' });
  const [fields, setFields] = useState<ConstructionWorkspaceDraftFields>(() => emptyDraftFields(business?.base_currency));
  const [errors, setErrors] = useState<ConstructionWorkspaceDraftErrors>({});
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submissionLock = useRef(false);
  const nextLocalId = useRef(1);
  const nextReceiptLocalId = useRef(1);
  const nextTransferLocalId = useRef(1);

  const currentDraft = view.mode === 'detail' || view.mode === 'form'
    ? drafts.find((draft) => draft.localId === view.draftId)
    : undefined;

  const visibleDrafts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return drafts.filter((draft) => {
      if (statusFilter !== 'all' && draft.status !== statusFilter) return false;
      if (!query) return true;
      return [
        draft.projectName,
        draft.projectCode,
        draft.clientName,
        draft.siteName,
        draft.siteLocation,
        CONSTRUCTION_WORKSPACE_STATUS_LABELS[draft.status],
      ].some((value) => value.toLocaleLowerCase().includes(query));
    });
  }, [drafts, search, statusFilter]);

  const activeCount = drafts.filter((draft) => draft.status === 'active').length;
  const completedCount = drafts.filter((draft) => draft.status === 'completed').length;
  const attentionCount = drafts.filter((draft) => draft.status === 'needs_attention').length;

  function startNewDraft() {
    submissionLock.current = false;
    setSubmitting(false);
    setFields(emptyDraftFields(business?.base_currency));
    setErrors({});
    setFeedback('');
    setView({ mode: 'form' });
  }

  function openDraft(draft: LocalConstructionProjectDraft) {
    setFeedback('');
    setView({ mode: 'detail', draftId: draft.localId });
  }

  function editDraft(draft: LocalConstructionProjectDraft) {
    submissionLock.current = false;
    setSubmitting(false);
    setFields(fieldsFromDraft(draft));
    setErrors({});
    setFeedback('');
    setView({ mode: 'form', draftId: draft.localId });
  }

  function returnToList() {
    submissionLock.current = false;
    setSubmitting(false);
    setFeedback('');
    setView({ mode: 'list' });
  }

  function updateField<K extends keyof ConstructionWorkspaceDraftFields>(
    field: K,
    value: ConstructionWorkspaceDraftFields[K],
  ) {
    setFields((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function submitDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionLock.current) return;
    if (!business) {
      setErrors({ projectName: 'Select a business before keeping a local draft.' });
      return;
    }

    submissionLock.current = true;
    setSubmitting(true);
    const validation = validateConstructionWorkspaceDraft(fields);
    if (!validation.values) {
      setErrors(validation.errors);
      submissionLock.current = false;
      setSubmitting(false);
      return;
    }

    const now = new Date().toISOString();
    const editingId = view.mode === 'form' ? view.draftId : undefined;
    let localId: number;

    if (editingId !== undefined) {
      const existing = drafts.find((draft) => draft.localId === editingId);
      if (!existing) {
        setErrors({ projectName: 'This local draft is no longer available. Return to the workspace and try again.' });
        submissionLock.current = false;
        setSubmitting(false);
        return;
      }
      localId = editingId;
      const updated: LocalConstructionProjectDraft = {
        ...existing,
        ...validation.values,
        updatedAt: now,
      };
      setDrafts((current) => current.map((draft) => draft.localId === localId ? updated : draft));
      setFeedback('Local draft updated in this tab only. No Ledgr project record was changed.');
    } else {
      localId = nextLocalId.current;
      nextLocalId.current += 1;
      const created: LocalConstructionProjectDraft = {
        ...validation.values,
        localId,
        businessId: business.id,
        businessName: business.name,
        createdAt: now,
        updatedAt: now,
      };
      setDrafts((current) => [created, ...current]);
      setFeedback('Draft kept in this tab only. It has not been saved to Ledgr.');
    }

    setErrors({});
    setView({ mode: 'detail', draftId: localId });
    // Keep the lock until the user explicitly starts or edits another draft.
    // This prevents a second submit event in the same render from duplicating a draft.
    setSubmitting(false);
  }

  function discardDraft(draft: LocalConstructionProjectDraft) {
    setDrafts((current) => current.filter((item) => item.localId !== draft.localId));
    setReceiptPreparations((current) => current.filter((preparation) => preparation.projectLocalId !== draft.localId));
    setTransferPreparations((current) => current.filter((preparation) => preparation.projectLocalId !== draft.localId));
    submissionLock.current = false;
    setSubmitting(false);
    setFeedback('Local draft discarded. No Ledgr project record was changed.');
    setView({ mode: 'list' });
  }

  function saveReceiptPreparation(
    project: LocalConstructionProjectDraft,
    values: MaterialReceiptPreparationFields,
    localId: number | undefined,
    status: MaterialReceiptPreparationStatus,
  ): number | null {
    if (!business || project.businessId !== business.id) return null;
    if (!drafts.some((draft) => draft.localId === project.localId && draft.businessId === business.id)) return null;

    const now = new Date().toISOString();
    if (localId !== undefined) {
      const existing = receiptPreparations.find((preparation) =>
        preparation.localId === localId
          && preparation.projectLocalId === project.localId
          && preparation.businessId === business.id,
      );
      if (!existing) return null;

      setReceiptPreparations((current) => current.map((preparation) => preparation.localId === localId
        ? { ...preparation, ...values, status, updatedAt: now }
        : preparation));
      return localId;
    }

    const createdLocalId = nextReceiptLocalId.current;
    nextReceiptLocalId.current += 1;
    const created: LocalMaterialReceiptPreparation = {
      ...values,
      localId: createdLocalId,
      projectLocalId: project.localId,
      businessId: business.id,
      status,
      createdAt: now,
      updatedAt: now,
    };
    setReceiptPreparations((current) => [created, ...current]);
    return createdLocalId;
  }

  function discardReceiptPreparation(project: LocalConstructionProjectDraft, localId: number) {
    setReceiptPreparations((current) => current.filter((preparation) => !(
      preparation.localId === localId
        && preparation.projectLocalId === project.localId
        && preparation.businessId === project.businessId
    )));
  }

  function saveTransferPreparation(
    project: LocalConstructionProjectDraft,
    values: MaterialTransferPreparationFields,
    localId: number | undefined,
    stage: MaterialTransferPreparationStage,
  ): number | null {
    if (!business || project.businessId !== business.id) return null;
    if (!drafts.some((draft) => draft.localId === project.localId && draft.businessId === business.id)) return null;

    const now = new Date().toISOString();
    if (localId !== undefined) {
      const existing = transferPreparations.find((preparation) =>
        preparation.localId === localId
          && preparation.projectLocalId === project.localId
          && preparation.businessId === business.id,
      );
      if (!existing) return null;

      setTransferPreparations((current) => current.map((preparation) => preparation.localId === localId
        && preparation.projectLocalId === project.localId
        && preparation.businessId === business.id
        ? { ...preparation, ...values, stage, updatedAt: now }
        : preparation));
      return localId;
    }

    const createdLocalId = nextTransferLocalId.current;
    nextTransferLocalId.current += 1;
    const created: LocalMaterialTransferPreparation = {
      ...values,
      localId: createdLocalId,
      projectLocalId: project.localId,
      businessId: business.id,
      stage,
      createdAt: now,
      updatedAt: now,
    };
    setTransferPreparations((current) => [created, ...current]);
    return createdLocalId;
  }

  function discardTransferPreparation(project: LocalConstructionProjectDraft, localId: number) {
    setTransferPreparations((current) => current.filter((preparation) => !(
      preparation.localId === localId
        && preparation.projectLocalId === project.localId
        && preparation.businessId === project.businessId
    )));
  }

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 md:px-8" data-module="construction-project-workspace">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Construction workspace</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-600">
            Organise project briefs for {business?.name ?? 'the selected business'} and review their details.
            This workspace is available for local drafts only.
          </p>
        </div>
        {view.mode === 'list' && (
          <button
            type="button"
            onClick={startNewDraft}
            disabled={!business}
            className="inline-flex shrink-0 items-center justify-center rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Create project draft
          </button>
        )}
      </header>

      <section aria-label="Workspace persistence status" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
        <h2 className="font-semibold text-amber-950">Local drafts only — not connected to saved projects</h2>
        <p className="mt-1 text-sm leading-6 text-amber-900">
          No saved project records are loaded or changed here. Project briefs, material receipt preparations, and store-to-site transfer notes exist only in this page's memory,
          are not sent to an API, and are not stored in browser storage or shared across users/devices. They clear when you leave or refresh this page,
          sign out, or switch businesses. No sample project data is shown as real business data.
        </p>
        <p className="mt-2 text-sm leading-6 text-amber-900">
          Codes, client and manager names, dates, currency codes, and statuses remain notes only; they are not linked,
          reserved, approved, or checked against Ledgr records.
        </p>
      </section>

      {!business && (
        <p role="status" className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
          Select a business in Ledgr before keeping a local draft. Project data is not loaded by this workspace.
        </p>
      )}

      {feedback && (
        <p role="status" aria-live="polite" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {feedback}
        </p>
      )}

      {view.mode === 'list' && (
        <>
          <section aria-label="Local draft summaries" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard label="Total projects" value={drafts.length} note="Local drafts in this tab" />
            <SummaryCard label="Active projects" value={activeCount} note="Local draft status only" />
            <SummaryCard label="Completed projects" value={completedCount} note="Local draft status only" />
            <SummaryCard label="Requiring attention" value={attentionCount} note="Local draft status only" />
          </section>

          <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="construction-project-list-title">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 id="construction-project-list-title" className="text-lg font-semibold text-gray-900">Projects in this tab</h2>
                <p className="mt-1 text-sm text-gray-600">Only drafts created during this page session appear below.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-[minmax(14rem,1fr)_12rem]">
                <div>
                  <label htmlFor="construction-project-search" className="block text-xs font-semibold uppercase tracking-wide text-gray-500">Search</label>
                  <input
                    id="construction-project-search"
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Project name, code, client, site…"
                    className={FIELD_CLASS}
                  />
                </div>
                <div>
                  <label htmlFor="construction-project-status-filter" className="block text-xs font-semibold uppercase tracking-wide text-gray-500">Status</label>
                  <select
                    id="construction-project-status-filter"
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                    className={FIELD_CLASS}
                  >
                    <option value="all">All statuses</option>
                    {CONSTRUCTION_WORKSPACE_STATUSES.map((status) => (
                      <option key={status} value={status}>{CONSTRUCTION_WORKSPACE_STATUS_LABELS[status]}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {drafts.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-5 py-10 text-center">
                <h3 className="font-semibold text-gray-900">No project drafts in this tab yet</h3>
                <p className="mx-auto mt-1 max-w-lg text-sm text-gray-600">
                  Start a local project brief. It will not become an official Ledgr project or sync to another device.
                </p>
                <button
                  type="button"
                  onClick={startNewDraft}
                  disabled={!business}
                  className="mt-4 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Create the first project draft
                </button>
              </div>
            ) : visibleDrafts.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-5 py-8 text-center">
                <h3 className="font-semibold text-gray-900">No drafts match these filters</h3>
                <p className="mt-1 text-sm text-gray-600">Try a different search term or status.</p>
                <button
                  type="button"
                  onClick={() => { setSearch(''); setStatusFilter('all'); }}
                  className="mt-3 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="min-w-[920px] w-full divide-y divide-gray-200 text-left text-sm">
                  <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th scope="col" className="px-4 py-3">Project code</th>
                      <th scope="col" className="px-4 py-3">Project name</th>
                      <th scope="col" className="px-4 py-3">Client</th>
                      <th scope="col" className="px-4 py-3">Site</th>
                      <th scope="col" className="px-4 py-3">Status</th>
                      <th scope="col" className="px-4 py-3">Planned dates</th>
                      <th scope="col" className="px-4 py-3">Budget note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {visibleDrafts.map((draft) => (
                      <tr key={draft.localId} className="align-top hover:bg-gray-50">
                        <td className="whitespace-nowrap px-4 py-3 text-gray-700">{draft.projectCode || '—'}</td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => openDraft(draft)}
                            aria-label={`View ${draft.projectName} draft`}
                            className="font-semibold text-blue-700 underline-offset-2 hover:underline"
                          >
                            {draft.projectName}
                          </button>
                          <span className="mt-1 block text-xs text-gray-500">Local draft</span>
                        </td>
                        <td className="px-4 py-3 text-gray-700">{draft.clientName || '—'}</td>
                        <td className="px-4 py-3 text-gray-700">{formatSite(draft)}</td>
                        <td className="px-4 py-3"><StatusBadge status={draft.status} /></td>
                        <td className="whitespace-nowrap px-4 py-3 text-gray-700">{formatDateRange(draft)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-gray-700">{formatAmount(draft.approvedBudget, draft.budgetCurrency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {view.mode === 'form' && (
        <section className="space-y-4" aria-labelledby="construction-project-form-title">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <button type="button" onClick={returnToList} className="mb-2 text-sm font-medium text-gray-600 hover:text-gray-900">
                ← Back to workspace
              </button>
              <h2 id="construction-project-form-title" className="text-xl font-semibold text-gray-900">
                {view.draftId === undefined ? 'New project draft' : 'Continue project draft'}
              </h2>
              <p className="mt-1 text-sm text-gray-600">Only a project name is required to keep a draft in this tab. Other details are optional notes.</p>
            </div>
          </div>

          <form noValidate onSubmit={submitDraft} className="max-w-4xl space-y-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
            {Object.keys(errors).length > 0 && (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                Please correct the highlighted fields before keeping this local draft.
              </p>
            )}
            <div className="grid gap-5 md:grid-cols-2">
              <section className="space-y-4 md:col-span-2" aria-labelledby="construction-identity-title">
                <h3 id="construction-identity-title" className="font-semibold text-gray-900">Project identity</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <DraftField
                    id="construction-project-name"
                    label="Project name"
                    value={fields.projectName}
                    onChange={(value) => updateField('projectName', value)}
                    error={errors.projectName}
                    required
                  />
                  <DraftField
                    id="construction-project-code"
                    label="Project code"
                    value={fields.projectCode}
                    onChange={(value) => updateField('projectCode', value)}
                    error={errors.projectCode}
                    help="Optional note; it is not checked or reserved against Ledgr projects."
                  />
                </div>
              </section>

              <section className="space-y-4" aria-labelledby="construction-client-site-title">
                <h3 id="construction-client-site-title" className="font-semibold text-gray-900">Client and site notes</h3>
                <DraftField
                  id="construction-client-name"
                  label="Client or customer"
                  value={fields.clientName}
                  onChange={(value) => updateField('clientName', value)}
                  error={errors.clientName}
                  help="Free text only; not linked to a contact record."
                />
                <DraftField
                  id="construction-site-name"
                  label="Site name"
                  value={fields.siteName}
                  onChange={(value) => updateField('siteName', value)}
                  error={errors.siteName}
                />
                <DraftField
                  id="construction-site-location"
                  label="Site location"
                  value={fields.siteLocation}
                  onChange={(value) => updateField('siteLocation', value)}
                  error={errors.siteLocation}
                />
              </section>

              <section className="space-y-4" aria-labelledby="construction-commercial-notes-title">
                <h3 id="construction-commercial-notes-title" className="font-semibold text-gray-900">Commercial notes</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <DraftField
                    id="construction-contract-value"
                    label="Contract value"
                    kind="amount"
                    value={fields.contractValue}
                    onChange={(value) => updateField('contractValue', value)}
                    error={errors.contractValue}
                    help="Optional non-negative amount; no accounting or posting action occurs."
                  />
                  <DraftField
                    id="construction-contract-currency"
                    label="Contract currency code"
                    kind="currency"
                    value={fields.contractCurrency}
                    onChange={(value) => updateField('contractCurrency', value)}
                    error={errors.contractCurrency}
                    help="Note only; not verified against a currency table."
                  />
                  <DraftField
                    id="construction-approved-budget"
                    label="Approved project budget"
                    kind="amount"
                    value={fields.approvedBudget}
                    onChange={(value) => updateField('approvedBudget', value)}
                    error={errors.approvedBudget}
                    help="Optional note; this does not approve or post a budget."
                  />
                  <DraftField
                    id="construction-budget-currency"
                    label="Budget currency code"
                    kind="currency"
                    value={fields.budgetCurrency}
                    onChange={(value) => updateField('budgetCurrency', value)}
                    error={errors.budgetCurrency}
                    help="Note only; not verified against a currency table."
                  />
                </div>
              </section>

              <section className="space-y-4" aria-labelledby="construction-planning-title">
                <h3 id="construction-planning-title" className="font-semibold text-gray-900">Planning notes</h3>
                <DraftField
                  id="construction-planned-start-date"
                  label="Planned start date"
                  kind="date"
                  value={fields.plannedStartDate}
                  onChange={(value) => updateField('plannedStartDate', value)}
                  error={errors.plannedStartDate}
                />
                <DraftField
                  id="construction-planned-completion-date"
                  label="Planned completion date"
                  kind="date"
                  value={fields.plannedCompletionDate}
                  onChange={(value) => updateField('plannedCompletionDate', value)}
                  error={errors.plannedCompletionDate}
                />
                <DraftField
                  id="construction-project-manager"
                  label="Project manager note"
                  value={fields.projectManagerName}
                  onChange={(value) => updateField('projectManagerName', value)}
                  error={errors.projectManagerName}
                  help="Free text only; not linked to a Ledgr user or employee."
                />
                <div>
                  <label htmlFor="construction-local-status" className="block text-sm font-medium text-gray-800">Local status</label>
                  <select
                    id="construction-local-status"
                    value={fields.status}
                    onChange={(event) => updateField('status', event.target.value as ConstructionWorkspaceStatus)}
                    aria-invalid={errors.status ? true : undefined}
                    aria-describedby={errors.status ? 'construction-local-status-error' : 'construction-local-status-help'}
                    className={FIELD_CLASS}
                  >
                    {CONSTRUCTION_WORKSPACE_STATUSES.map((status) => (
                      <option key={status} value={status}>{CONSTRUCTION_WORKSPACE_STATUS_LABELS[status]}</option>
                    ))}
                  </select>
                  {errors.status ? (
                    <p id="construction-local-status-error" className="mt-1 text-xs text-red-700">{errors.status}</p>
                  ) : (
                    <p id="construction-local-status-help" className="mt-1 text-xs text-gray-500">Status is a local draft label, not an official Ledgr project status.</p>
                  )}
                </div>
              </section>
            </div>

            <div className="flex flex-wrap gap-3 border-t border-gray-100 pt-4">
              <button
                type="submit"
                disabled={submitting || !business}
                className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? 'Keeping draft…' : 'Keep draft in this tab'}
              </button>
              <button type="button" onClick={returnToList} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                Cancel
              </button>
              {currentDraft && (
                <button type="button" onClick={() => discardDraft(currentDraft)} className="rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50">
                  Discard draft
                </button>
              )}
            </div>
          </form>
        </section>
      )}

      {view.mode === 'detail' && currentDraft && (
        <ConstructionProjectDetails
          draft={currentDraft}
          receiptPreparations={receiptPreparations}
          transferPreparations={transferPreparations}
          onBack={returnToList}
          onEdit={() => editDraft(currentDraft)}
          onDiscard={() => discardDraft(currentDraft)}
          onSaveReceiptPreparation={(values, localId, status) =>
            saveReceiptPreparation(currentDraft, values, localId, status)}
          onDiscardReceiptPreparation={(localId) => discardReceiptPreparation(currentDraft, localId)}
          onSaveTransferPreparation={(values, localId, stage) =>
            saveTransferPreparation(currentDraft, values, localId, stage)}
          onDiscardTransferPreparation={(localId) => discardTransferPreparation(currentDraft, localId)}
        />
      )}
      {view.mode === 'detail' && !currentDraft && (
        <section role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          This local draft is no longer available. Return to the workspace to continue.
          <button type="button" onClick={returnToList} className="ml-2 font-semibold underline">Back to workspace</button>
        </section>
      )}
    </main>
  );
}

function SummaryCard({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <article className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
      <p className="mt-1 text-xs text-gray-500">{note}</p>
    </article>
  );
}

function DraftField({
  id,
  label,
  value,
  onChange,
  kind = 'text',
  error,
  help,
  required = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  kind?: FieldKind;
  error?: string;
  help?: string;
  required?: boolean;
}) {
  const inputType = kind === 'amount' ? 'number' : kind === 'date' ? 'date' : 'text';
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : help ? helpId : undefined;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-800">
        {label}{required && <span aria-hidden="true" className="ml-1 text-red-600">*</span>}
      </label>
      <input
        id={id}
        name={id}
        type={inputType}
        min={kind === 'amount' ? '0' : undefined}
        step={kind === 'amount' ? 'any' : undefined}
        maxLength={kind === 'currency' ? 3 : undefined}
        autoCapitalize={kind === 'currency' ? 'characters' : undefined}
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`${FIELD_CLASS} ${error ? 'border-red-400 focus:border-red-500 focus:ring-red-100' : ''}`}
      />
      {help && !error && <p id={helpId} className="mt-1 text-xs text-gray-500">{help}</p>}
      {error && <p id={errorId} className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: ConstructionWorkspaceStatus }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASS[status]}`}>
      {CONSTRUCTION_WORKSPACE_STATUS_LABELS[status]} · local
    </span>
  );
}

function ConstructionProjectDetails({
  draft,
  receiptPreparations,
  transferPreparations,
  onBack,
  onEdit,
  onDiscard,
  onSaveReceiptPreparation,
  onDiscardReceiptPreparation,
  onSaveTransferPreparation,
  onDiscardTransferPreparation,
}: {
  draft: LocalConstructionProjectDraft;
  receiptPreparations: LocalMaterialReceiptPreparation[];
  transferPreparations: LocalMaterialTransferPreparation[];
  onBack: () => void;
  onEdit: () => void;
  onDiscard: () => void;
  onSaveReceiptPreparation: (
    fields: MaterialReceiptPreparationFields,
    localId: number | undefined,
    status: MaterialReceiptPreparationStatus,
  ) => number | null;
  onDiscardReceiptPreparation: (localId: number) => void;
  onSaveTransferPreparation: (
    fields: MaterialTransferPreparationFields,
    localId: number | undefined,
    stage: MaterialTransferPreparationStage,
  ) => number | null;
  onDiscardTransferPreparation: (localId: number) => void;
}) {
  return (
    <section className="space-y-4" aria-labelledby="construction-project-details-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button type="button" onClick={onBack} className="mb-2 text-sm font-medium text-gray-600 hover:text-gray-900">
            ← Back to workspace
          </button>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Local draft · {draft.businessName}</p>
          <h2 id="construction-project-details-title" className="mt-1 text-2xl font-bold text-gray-900">{draft.projectName}</h2>
          <p className="mt-1 text-sm text-gray-600">This information exists only in this page session; it is not a saved Ledgr project.</p>
        </div>
        <StatusBadge status={draft.status} />
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
        <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          <DetailItem label="Project code note" value={draft.projectCode} />
          <DetailItem label="Client / customer note" value={draft.clientName} />
          <DetailItem label="Site name" value={draft.siteName} />
          <DetailItem label="Site location" value={draft.siteLocation} />
          <DetailItem label="Contract value note" value={formatAmount(draft.contractValue, draft.contractCurrency)} />
          <DetailItem label="Approved budget note" value={formatAmount(draft.approvedBudget, draft.budgetCurrency)} />
          <DetailItem label="Planned start date" value={draft.plannedStartDate} />
          <DetailItem label="Planned completion date" value={draft.plannedCompletionDate} />
          <DetailItem label="Project manager note" value={draft.projectManagerName} />
          <DetailItem label="Local status" value={CONSTRUCTION_WORKSPACE_STATUS_LABELS[draft.status]} />
        </dl>
        <div className="mt-6 flex flex-wrap gap-3 border-t border-gray-100 pt-4">
          <button type="button" onClick={onEdit} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800">
            Continue editing draft
          </button>
          <button type="button" onClick={onDiscard} className="rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50">
            Discard local draft
          </button>
        </div>
      </div>

      <MaterialReceiptPreparationSection
        projectLocalId={draft.localId}
        businessId={draft.businessId}
        projectName={draft.projectName}
        projectCode={draft.projectCode}
        siteName={draft.siteName}
        siteLocation={draft.siteLocation}
        preparations={receiptPreparations}
        onSave={onSaveReceiptPreparation}
        onDiscard={onDiscardReceiptPreparation}
      />
      <MaterialTransferPreparationSection
        projectLocalId={draft.localId}
        businessId={draft.businessId}
        projectName={draft.projectName}
        projectCode={draft.projectCode}
        siteName={draft.siteName}
        siteLocation={draft.siteLocation}
        preparations={transferPreparations}
        onSave={onSaveTransferPreparation}
        onDiscard={onDiscardTransferPreparation}
      />
    </section>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-1 break-words text-sm text-gray-900">{value || 'Not added'}</dd>
    </div>
  );
}

function formatSite(draft: LocalConstructionProjectDraft): string {
  const site = [draft.siteName, draft.siteLocation].filter(Boolean).join(' · ');
  return site || '—';
}

function formatDateRange(draft: LocalConstructionProjectDraft): string {
  if (draft.plannedStartDate && draft.plannedCompletionDate) {
    return `${draft.plannedStartDate} – ${draft.plannedCompletionDate}`;
  }
  return draft.plannedStartDate || draft.plannedCompletionDate || '—';
}

function formatAmount(amount: string, currency: string): string {
  if (!amount) return '—';
  return `${currency} ${amount}`.trim();
}
