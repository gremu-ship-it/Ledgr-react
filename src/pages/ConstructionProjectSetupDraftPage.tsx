import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { Business } from '@/types';
import { useAppStore } from '@/store/useAppStore';

interface DraftFields {
  projectName: string;
  projectCode: string;
  clientNote: string;
  siteNote: string;
  contractValueNote: string;
  approvedBudgetNote: string;
  plannedStartDate: string;
  targetEndDate: string;
  managerNote: string;
  statusNote: string;
}

interface LocalConstructionDraft {
  id: number;
  businessId: string;
  businessName: string;
  fields: DraftFields;
  createdAt: string;
}

const EMPTY_FIELDS: DraftFields = {
  projectName: '',
  projectCode: '',
  clientNote: '',
  siteNote: '',
  contractValueNote: '',
  approvedBudgetNote: '',
  plannedStartDate: '',
  targetEndDate: '',
  managerNote: '',
  statusNote: '',
};

const INPUT_CLASS = 'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const LABEL_CLASS = 'block text-sm font-medium text-gray-800';

export function ConstructionProjectSetupDraftPage() {
  const business = useAppStore((state) => state.currentBusiness?.business ?? null);
  return <DraftWorkspace key={business?.id ?? 'no-business'} business={business} />;
}

function DraftWorkspace({ business }: { business: Business | null }) {
  const [fields, setFields] = useState<DraftFields>({ ...EMPTY_FIELDS });
  const [drafts, setDrafts] = useState<LocalConstructionDraft[]>([]);
  const [notice, setNotice] = useState('');
  const nextDraftId = useRef(1);

  function updateField<K extends keyof DraftFields>(field: K, value: DraftFields[K]) {
    setFields((current) => ({ ...current, [field]: value }));
    setNotice('');
  }

  function keepDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!business) {
      setNotice('Select a business in Ledgr before keeping a draft in this tab.');
      return;
    }

    const draft: LocalConstructionDraft = {
      id: nextDraftId.current,
      businessId: business.id,
      businessName: business.name,
      fields: { ...fields },
      createdAt: new Date().toISOString(),
    };
    nextDraftId.current += 1;
    setDrafts((current) => [draft, ...current]);
    setFields({ ...EMPTY_FIELDS });
    setNotice('Draft kept in this tab only. It has not been saved to Ledgr.');
  }

  function discardDraft(id: number) {
    setDrafts((current) => current.filter((draft) => draft.id !== id));
    setNotice('Local draft discarded. No Ledgr record was changed.');
  }

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 md:px-8" data-module="construction-project-setup-draft">
      <header className="space-y-3">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-800"
        >
          <span aria-hidden="true">←</span>
          Back to dashboard
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Construction Project Setup</h1>
          <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-800">
            Draft workspace
          </span>
        </div>
        <p className="max-w-3xl text-sm leading-6 text-gray-600">
          Capture a temporary project brief while the project schema and access rules are being approved.
          This page does not create or read a Ledgr project.
        </p>
      </header>

      <section aria-label="Draft-only notice" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
        <h2 className="font-semibold text-amber-950">Not connected to persistence</h2>
        <p className="mt-1 text-sm leading-6 text-amber-900">
          Drafts exist only in this page's memory. They are not sent to an API or stored in browser storage and will be cleared
          when you leave or refresh this page, sign out, or switch businesses. No project access is granted here.
        </p>
        <p className="mt-2 text-sm leading-6 text-amber-900">
          Field requirements, code uniqueness, currency rules, status values, and client/manager links are not finalized.
          All fields below are optional notes; this workspace does not validate or reserve them.
        </p>
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
        <form onSubmit={keepDraft} className="space-y-5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Project brief</h2>
              <p className="mt-1 text-sm text-gray-600">Optional working notes; not an official project record.</p>
            </div>
            <div className="rounded-lg bg-gray-50 px-3 py-2 text-right">
              <span className="block text-xs font-medium uppercase tracking-wide text-gray-500">Business context</span>
              <span className="mt-0.5 block text-sm font-semibold text-gray-800">
                {business?.name ?? 'No business selected'}
              </span>
            </div>
          </div>

          {!business && (
            <p role="status" className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
              Select a business in the main Ledgr workspace to label this temporary draft.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <DraftTextField
              id="construction-draft-project-name"
              label="Project name"
              value={fields.projectName}
              onChange={(value) => updateField('projectName', value)}
            />
            <DraftTextField
              id="construction-draft-project-code"
              label="Project code"
              value={fields.projectCode}
              onChange={(value) => updateField('projectCode', value)}
              help="Not normalized or checked for duplicates."
            />
            <DraftTextField
              id="construction-draft-client"
              label="Client note"
              value={fields.clientNote}
              onChange={(value) => updateField('clientNote', value)}
              help="Free text only; not linked to a contact record."
            />
            <DraftTextField
              id="construction-draft-manager"
              label="Project manager note"
              value={fields.managerNote}
              onChange={(value) => updateField('managerNote', value)}
              help="Free text only; not linked to a Ledgr user or employee."
            />
            <DraftTextField
              id="construction-draft-site"
              label="Construction site note"
              value={fields.siteNote}
              onChange={(value) => updateField('siteNote', value)}
              help="Free text only; not linked to an inventory location."
            />
            <DraftTextField
              id="construction-draft-status"
              label="Status note"
              value={fields.statusNote}
              onChange={(value) => updateField('statusNote', value)}
              help="Free text only; there is no approved status list yet."
            />
            <DraftTextField
              id="construction-draft-contract-value"
              label="Contract value note"
              value={fields.contractValueNote}
              onChange={(value) => updateField('contractValueNote', value)}
              help="Free text; no currency, precision, or posting rules are applied."
            />
            <DraftTextField
              id="construction-draft-approved-budget"
              label="Approved budget note"
              value={fields.approvedBudgetNote}
              onChange={(value) => updateField('approvedBudgetNote', value)}
              help="Free text; this does not approve or post a budget."
            />
            <DraftTextField
              id="construction-draft-start-date"
              label="Planned start date"
              type="date"
              value={fields.plannedStartDate}
              onChange={(value) => updateField('plannedStartDate', value)}
            />
            <DraftTextField
              id="construction-draft-target-end-date"
              label="Target end date"
              type="date"
              value={fields.targetEndDate}
              onChange={(value) => updateField('targetEndDate', value)}
            />
          </div>

          <div className="flex flex-wrap gap-3 border-t border-gray-100 pt-4">
            <button
              type="submit"
              disabled={!business}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Keep draft in this tab
            </button>
            <button
              type="button"
              onClick={() => {
                setFields({ ...EMPTY_FIELDS });
                setNotice('Form notes cleared.');
              }}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Clear notes
            </button>
          </div>
          {notice && <p role="status" aria-live="polite" className="text-sm text-gray-700">{notice}</p>}
        </form>

        <section aria-labelledby="construction-drafts-title" className="space-y-4">
          <div>
            <h2 id="construction-drafts-title" className="text-lg font-semibold text-gray-900">Drafts in this tab</h2>
            <p className="mt-1 text-sm text-gray-600">{drafts.length} temporary {drafts.length === 1 ? 'draft' : 'drafts'}</p>
          </div>
          {drafts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-600">
              Your temporary drafts will appear here after you keep one in this tab.
            </div>
          ) : (
            <ul className="space-y-3" aria-label="Temporary construction project drafts">
              {drafts.map((draft) => {
                const title = draft.fields.projectName.trim() || draft.fields.projectCode.trim() || 'Untitled project brief';
                return (
                  <li key={draft.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="break-words font-semibold text-gray-900">{title}</h3>
                        <p className="mt-1 text-xs text-gray-500">{draft.businessName} · Local draft only</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => discardDraft(draft.id)}
                        aria-label={`Discard ${title} draft`}
                        className="shrink-0 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                      >
                        Discard
                      </button>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <DraftSummary label="Code" value={draft.fields.projectCode} />
                      <DraftSummary label="Client note" value={draft.fields.clientNote} />
                      <DraftSummary label="Status note" value={draft.fields.statusNote} />
                      <DraftSummary label="Target end" value={draft.fields.targetEndDate} />
                    </dl>
                    <p className="mt-3 text-xs text-gray-500">Held {new Date(draft.createdAt).toLocaleString()}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </section>
    </main>
  );
}

function DraftTextField({
  id,
  label,
  value,
  onChange,
  type = 'text',
  help,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'date';
  help?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className={LABEL_CLASS}>{label}</label>
      {type === 'date' ? (
        <input id={id} name={id} type="date" value={value} onChange={(event) => onChange(event.target.value)} className={INPUT_CLASS} />
      ) : (
        <input id={id} name={id} type="text" value={value} onChange={(event) => onChange(event.target.value)} className={INPUT_CLASS} />
      )}
      {help && <p className="mt-1 text-xs text-gray-500">{help}</p>}
    </div>
  );
}

function DraftSummary({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-medium text-gray-500">{label}</dt>
      <dd className="mt-0.5 break-words text-gray-800">{value || '—'}</dd>
    </div>
  );
}
