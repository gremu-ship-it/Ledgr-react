import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { repos } from '@/lib/repositories';
import {
  CreateValuationCommand,
  GenerateInvoiceCommand,
  ReleaseRetentionCommand,
  SubmitValuationCommand,
  UpdateValuationCommand,
} from '@/dal/commands/ProjectValuationCommands';
import type {
  Project,
  ProjectBoqLine,
  ProjectRetentionEntry,
  ProjectValuationDocument,
  ProjectValuationInput,
} from '@/dal/repositories/ProjectRepository';
import { ErrorBanner } from '../constructionUi';
import { PROJECT_BUTTON } from './ProjectForm';

const k = 'construction.projects.valuations';
const valuationCommands = {
  create: new CreateValuationCommand(repos.projects),
  update: new UpdateValuationCommand(repos.projects),
  submit: new SubmitValuationCommand(repos.projects),
  invoice: new GenerateInvoiceCommand(repos.projects),
  release: new ReleaseRetentionCommand(repos.projects),
};
const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const amount = (value: number) => Number(value || 0).toLocaleString(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

type ValuationDraftLine = {
  boq_line_id: string;
  cumulative_pct: string;
  notes: string;
};
type ValuationDraft = {
  valuation_date: string;
  period_start: string;
  period_end: string;
  notes: string;
};

const newDraft = (): ValuationDraft => ({
  valuation_date: today(),
  period_start: '',
  period_end: '',
  notes: '',
});

export function ProjectValuationsPanel({
  project,
  capabilities,
  onNotice,
}: {
  project: Project;
  capabilities: string[];
  onNotice: (message: string) => void;
}) {
  const { t } = useTranslation();
  const cache = useQueryClient();
  const canRead = capabilities.length > 0;
  const canEdit = capabilities.includes('procurement.po.manage')
    || capabilities.includes('procurement.master.manage');
  const canSubmit = capabilities.includes('procurement.master.manage');
  const canRelease = capabilities.includes('procurement.exception.authorize');

  const boqQuery = useQuery({
    queryKey: ['construction', 'boq', project.id],
    queryFn: () => repos.projects.getBoqLines(project.id),
    enabled: canRead,
  });
  const historyQuery = useQuery({
    queryKey: ['construction', 'valuation-history', project.id],
    queryFn: () => repos.projects.getValuationHistory(project.id),
    enabled: canRead,
  });
  const retentionQuery = useQuery({
    queryKey: ['construction', 'retention-summary', project.id],
    queryFn: () => repos.projects.getRetentionSummary(project.id),
    enabled: canRead,
  });

  const [showDraftForm, setShowDraftForm] = useState(false);
  const [editing, setEditing] = useState<ProjectValuationDocument | null>(null);
  const [draft, setDraft] = useState<ValuationDraft>(newDraft);
  const [draftLines, setDraftLines] = useState<ValuationDraftLine[]>([]);
  const [draftError, setDraftError] = useState('');
  const [releaseAmount, setReleaseAmount] = useState('');
  const [releaseDescription, setReleaseDescription] = useState('');
  const [releaseError, setReleaseError] = useState('');

  const boqLines = boqQuery.data ?? [];
  const history = historyQuery.data;
  const valuations = history?.valuations ?? [];
  const retentionSummary = retentionQuery.data;
  const openDraft = valuations.find((document) => document.valuation.status === 'draft');

  const invalidateValuations = () => {
    void cache.invalidateQueries({ queryKey: ['construction', 'valuation-history', project.id] });
    void cache.invalidateQueries({ queryKey: ['construction', 'retention-summary', project.id] });
    void cache.invalidateQueries({ queryKey: ['construction', 'boq-summary', project.id] });
    void cache.invalidateQueries({ queryKey: ['construction', 'project', project.business_id, project.id] });
  };

  const previousValue = (boqLineId: string, beforeNumber?: number) => {
    const prior = valuations
      .filter((document) => document.valuation.status !== 'draft'
        && (beforeNumber === undefined || document.valuation.valuation_number < beforeNumber))
      .sort((a, b) => b.valuation.valuation_number - a.valuation.valuation_number);
    for (const document of prior) {
      const found = document.lines.find((line) => line.boq_line_id === boqLineId);
      if (found) return Number(found.cumulative_value);
    }
    return 0;
  };

  const preview = useMemo(() => {
    const currentNumber = editing?.valuation.valuation_number;
    const rows = draftLines.map((line) => {
      const boq = boqLines.find((candidate) => candidate.id === line.boq_line_id);
      const boqValue = Number(boq?.total_value ?? 0);
      const pct = Number(line.cumulative_pct);
      const cumulative = Number.isFinite(pct) ? cents(boqValue * pct / 100) : 0;
      const prior = previousValue(line.boq_line_id, currentNumber);
      return { line, boq, boqValue, prior, cumulative, period: cents(cumulative - prior) };
    });
    const gross = cents(rows.reduce((sum, row) => sum + row.period, 0));
    const rawRetention = cents(gross * Number(project.retention_pct) / 100);
    const draftRetention = Number(editing?.valuation.retention_amount ?? 0);
    const availableRetention = Math.max(
      0,
      Number(retentionSummary?.balance_held ?? 0) - draftRetention,
    );
    const retention = rawRetention < 0
      ? -Math.min(Math.abs(rawRetention), availableRetention)
      : rawRetention;
    const previous = cents(rows.reduce((sum, row) => sum + row.prior, 0));
    return {
      rows,
      gross,
      previous,
      retention: cents(retention),
      net: cents(gross - retention),
      hasNegativePeriod: rows.some((row) => row.period < 0),
    };
  // previousValue reads the current query result and is intentionally calculated with these inputs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftLines, boqLines, valuations, editing, project.retention_pct, retentionSummary?.balance_held]);

  const saveMutation = useMutation({
    mutationFn: ({ input, valuationId }: { input: ProjectValuationInput; valuationId: string | null }) =>
      valuationId
        ? valuationCommands.update.execute(valuationId, input)
        : valuationCommands.create.execute(project.id, input),
    onSuccess: (result) => {
      setShowDraftForm(false);
      setEditing(null);
      setDraftError('');
      onNotice(t(`${k}.saved`, { number: result.valuation.valuation_number }));
      invalidateValuations();
    },
  });
  const submitMutation = useMutation({
    mutationFn: (valuationId: string) => valuationCommands.submit.execute(valuationId),
    onSuccess: (result) => {
      onNotice(t(`${k}.submittedNotice`, { number: result.valuation.valuation_number }));
      invalidateValuations();
    },
  });
  const invoiceMutation = useMutation({
    mutationFn: (valuationId: string) => valuationCommands.invoice.execute(valuationId),
    onSuccess: (result) => {
      onNotice(t(`${k}.invoiceCreated`, {
        invoiceNumber: result.invoice?.invoice_number ?? '',
        number: result.valuation.valuation_number,
      }));
      invalidateValuations();
    },
  });
  const releaseMutation = useMutation({
    mutationFn: ({ value, description }: { value: number; description: string }) =>
      valuationCommands.release.execute(project.id, value, description),
    onSuccess: (result) => {
      setReleaseAmount('');
      setReleaseDescription('');
      setReleaseError('');
      onNotice(t(`${k}.retention.releasedNotice`, {
        invoiceNumber: result.invoice.invoice_number,
      }));
      invalidateValuations();
    },
  });

  const beginCreate = () => {
    const previousLines = boqLines.map((line) => {
      const previousCumulative = previousValue(line.id);
      const pct = Number(line.total_value) > 0
        ? cents(previousCumulative / Number(line.total_value) * 100)
        : 0;
      return { boq_line_id: line.id, cumulative_pct: String(pct), notes: '' };
    });
    setEditing(null);
    setDraft(newDraft());
    setDraftLines(previousLines);
    setDraftError('');
    setShowDraftForm(true);
  };

  const beginEdit = (document: ProjectValuationDocument) => {
    setEditing(document);
    setDraft({
      valuation_date: document.valuation.valuation_date,
      period_start: document.valuation.period_start ?? '',
      period_end: document.valuation.period_end ?? '',
      notes: document.valuation.notes ?? '',
    });
    setDraftLines(document.lines.map((line) => ({
      boq_line_id: line.boq_line_id,
      cumulative_pct: String(line.cumulative_pct),
      notes: line.notes ?? '',
    })));
    setDraftError('');
    setShowDraftForm(true);
  };

  const saveDraft = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.valuation_date) {
      setDraftError(t(`${k}.validation.dateRequired`));
      return;
    }
    if (draft.period_start && draft.period_end && draft.period_end < draft.period_start) {
      setDraftError(t(`${k}.validation.dates`));
      return;
    }
    if (draftLines.length !== boqLines.length || draftLines.some((line) => {
      const value = line.cumulative_pct.trim();
      return !/^\d{1,3}(?:\.\d{1,2})?$/.test(value)
        || !Number.isFinite(Number(value))
        || Number(value) < 0
        || Number(value) > 100;
    })) {
      setDraftError(t(`${k}.validation.percentages`));
      return;
    }
    if (preview.hasNegativePeriod && !draft.notes.trim()) {
      setDraftError(t(`${k}.validation.negativeReason`));
      return;
    }
    setDraftError('');
    saveMutation.mutate({
      valuationId: editing?.valuation.id ?? null,
      input: {
        valuation_date: draft.valuation_date,
        period_start: draft.period_start || null,
        period_end: draft.period_end || null,
        lines: draftLines.map((line) => ({
          boq_line_id: line.boq_line_id,
          cumulative_pct: Number(line.cumulative_pct),
          notes: line.notes.trim() || null,
        })),
        notes: draft.notes.trim() || null,
      },
    });
  };

  const release = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = Number(releaseAmount);
    const balance = Number(retentionSummary?.balance_held ?? 0);
    if (!Number.isFinite(value) || value <= 0 || value > balance || !/^\d+(?:\.\d{1,2})?$/.test(releaseAmount.trim())) {
      setReleaseError(t(`${k}.retention.invalidAmount`));
      return;
    }
    if (!releaseDescription.trim()) {
      setReleaseError(t(`${k}.retention.descriptionRequired`));
      return;
    }
    setReleaseError('');
    releaseMutation.mutate({ value: cents(value), description: releaseDescription.trim() });
  };

  if (!canRead) return <ErrorBanner message={t(`${k}.error`)} />;
  if (boqQuery.isLoading || historyQuery.isLoading || retentionQuery.isLoading) {
    return <p className="text-sm text-gray-600">{t(`${k}.loading`)}</p>;
  }
  if (boqQuery.isError || historyQuery.isError || retentionQuery.isError || !history || !retentionSummary) {
    return <ErrorBanner message={t(`${k}.error`)} />;
  }

  const retentionBalance = Number(retentionSummary.balance_held);
  const releaseAllowed = retentionSummary.can_release && canRelease && retentionBalance > 0;
  const creationAllowed = project.status === 'active' && canEdit && boqLines.length > 0 && !openDraft;
  const anyMutationError = saveMutation.isError || submitMutation.isError || invoiceMutation.isError;
  const ledgerEntries = history.retention_entries ?? [];

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{t(`${k}.title`)}</h2>
            <p className="mt-1 text-sm text-gray-600">{t(`${k}.description`)}</p>
          </div>
          <button
            type="button"
            className={PROJECT_BUTTON}
            disabled={!creationAllowed}
            onClick={beginCreate}
          >
            {t(`${k}.new`)}
          </button>
        </div>
        {project.status !== 'active' && <p className="text-sm text-amber-800">{t(`${k}.createDisabled`)}</p>}
        {project.status === 'active' && openDraft && !showDraftForm && (
          <p className="text-sm text-amber-800">{t(`${k}.draftExists`)}</p>
        )}
        {boqLines.length === 0 && <p className="text-sm text-amber-800">{t(`${k}.boqRequired`)}</p>}
        {anyMutationError && <ErrorBanner message={t(`${k}.error`)} />}
        {saveMutation.isPending && <p role="status" className="text-sm text-gray-600">{t(`${k}.loading`)}</p>}

        {showDraftForm && (
          <form className="space-y-4 rounded-xl border border-brand-200 bg-brand-50/30 p-4" onSubmit={saveDraft}>
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold">{t(`${k}.${editing ? 'editTitle' : 'createTitle'}`)}</h3>
              <button type="button" className="text-sm text-gray-600 underline" onClick={() => setShowDraftForm(false)}>
                {t(`${k}.cancel`)}
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block text-sm">
                {t(`${k}.fields.valuationDate`)}
                <input type="date" required className="mt-1 w-full rounded-lg border bg-white px-3 py-2" value={draft.valuation_date} onChange={(event) => setDraft((old) => ({ ...old, valuation_date: event.target.value }))} />
              </label>
              <label className="block text-sm">
                {t(`${k}.fields.periodStart`)}
                <input type="date" className="mt-1 w-full rounded-lg border bg-white px-3 py-2" value={draft.period_start} onChange={(event) => setDraft((old) => ({ ...old, period_start: event.target.value }))} />
              </label>
              <label className="block text-sm">
                {t(`${k}.fields.periodEnd`)}
                <input type="date" className="mt-1 w-full rounded-lg border bg-white px-3 py-2" value={draft.period_end} onChange={(event) => setDraft((old) => ({ ...old, period_end: event.target.value }))} />
              </label>
            </div>
            <div className="overflow-x-auto rounded-lg border bg-white">
              <table className="w-full min-w-[1000px] border-collapse text-sm">
                <thead className="bg-gray-50 text-left">
                  <tr>{['lineNumber', 'description', 'boqValue', 'previous', 'cumulativePct', 'cumulativeValue', 'periodValue', 'lineNotes'].map((column) => (
                    <th key={column} className="p-2 font-medium">{t(`${k}.columns.${column}`)}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, index) => (
                    <tr key={row.line.boq_line_id} className="border-t align-top">
                      <td className="p-2">{row.boq?.line_number}</td>
                      <td className="p-2">{row.boq?.description}</td>
                      <td className="p-2 text-right">{amount(row.boqValue)}</td>
                      <td className="p-2 text-right">{amount(row.prior)}</td>
                      <td className="p-2">
                        <input
                          aria-label={`${t(`${k}.columns.cumulativePct`)} ${row.boq?.line_number ?? index + 1}`}
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          className="w-24 rounded border px-2 py-1"
                          value={row.line.cumulative_pct}
                          onChange={(event) => setDraftLines((old) => old.map((line, lineIndex) => lineIndex === index ? { ...line, cumulative_pct: event.target.value } : line))}
                        />
                      </td>
                      <td className="p-2 text-right">{amount(row.cumulative)}</td>
                      <td className={`p-2 text-right ${row.period < 0 ? 'font-semibold text-red-700' : ''}`}>{amount(row.period)}</td>
                      <td className="p-2">
                        <input
                          aria-label={`${t(`${k}.columns.lineNotes`)} ${row.boq?.line_number ?? index + 1}`}
                          className="w-40 rounded border px-2 py-1"
                          value={row.line.notes}
                          onChange={(event) => setDraftLines((old) => old.map((line, lineIndex) => lineIndex === index ? { ...line, notes: event.target.value } : line))}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t bg-gray-50 font-semibold">
                  <tr><td colSpan={3} className="p-2">{t(`${k}.summary.gross`)}</td><td className="p-2 text-right">{amount(preview.previous)}</td><td /><td /><td className="p-2 text-right">{amount(preview.gross)}</td><td /></tr>
                </tfoot>
              </table>
            </div>
            {preview.hasNegativePeriod && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{t(`${k}.negativeReason`)}</p>}
            <label className="block text-sm">
              {t(`${k}.fields.notes`)}
              <textarea className="mt-1 w-full rounded-lg border bg-white px-3 py-2" rows={3} value={draft.notes} onChange={(event) => setDraft((old) => ({ ...old, notes: event.target.value }))} />
            </label>
            <div className="grid gap-3 rounded-lg border bg-white p-3 sm:grid-cols-4">
              <Summary label={t(`${k}.summary.previous`)} value={amount(preview.previous)} />
              <Summary label={t(`${k}.summary.gross`)} value={amount(preview.gross)} />
              <Summary label={t(`${k}.summary.retention`)} value={amount(preview.retention)} />
              <Summary label={t(`${k}.summary.net`)} value={amount(preview.net)} />
            </div>
            {draftError && <p role="alert" className="text-sm text-red-700">{draftError}</p>}
            {saveMutation.isError && <ErrorBanner message={t(`${k}.error`)} />}
            <div className="flex justify-end gap-3">
              <button type="button" className="rounded-lg border px-4 py-2" onClick={() => setShowDraftForm(false)}>{t(`${k}.cancel`)}</button>
              <button type="submit" className={PROJECT_BUTTON} disabled={saveMutation.isPending}>
                {t(`${k}.${editing ? 'updateDraft' : 'saveDraft'}`)}
              </button>
            </div>
          </form>
        )}

        {!valuations.length && !showDraftForm && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-gray-600">{t(`${k}.empty`)}</p>}
        <div className="space-y-3">
          {valuations.map((document) => (
            <ValuationCard
              key={document.valuation.id}
              document={document}
              boqLines={boqLines}
              canEdit={canEdit}
              canSubmit={canSubmit}
              isSubmitting={submitMutation.isPending}
              isGenerating={invoiceMutation.isPending}
              onEdit={() => beginEdit(document)}
              onSubmit={() => submitMutation.mutate(document.valuation.id)}
              onGenerateInvoice={() => invoiceMutation.mutate(document.valuation.id)}
              t={t}
            />
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-xl border p-4">
        <div>
          <h2 className="text-lg font-semibold">{t(`${k}.retention.title`)}</h2>
          <p className="mt-1 text-sm text-gray-600">{t(retentionSummary.can_release ? `${k}.retention.canRelease` : `${k}.retention.cannotRelease`)}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <Summary label={t(`${k}.retention.totalWithheld`)} value={amount(Number(retentionSummary.total_withheld))} />
          <Summary label={t(`${k}.retention.totalReleased`)} value={amount(Number(retentionSummary.total_released))} />
          <Summary label={t(`${k}.retention.balance`)} value={amount(retentionBalance)} />
          <Summary label={t(`${k}.retention.rate`)} value={`${amount(Number(retentionSummary.retention_pct))}%`} />
        </div>
        {releaseAllowed && (
          <form className="grid gap-3 rounded-lg bg-gray-50 p-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end" onSubmit={release}>
            <label className="block text-sm">
              {t(`${k}.retention.amount`)}
              <input type="number" min="0.01" max={retentionBalance} step="0.01" className="mt-1 w-full rounded-lg border bg-white px-3 py-2" value={releaseAmount} onChange={(event) => setReleaseAmount(event.target.value)} />
            </label>
            <label className="block text-sm">
              {t(`${k}.retention.releaseDescription`)}
              <input className="mt-1 w-full rounded-lg border bg-white px-3 py-2" value={releaseDescription} onChange={(event) => setReleaseDescription(event.target.value)} />
            </label>
            <button type="submit" className={PROJECT_BUTTON} disabled={releaseMutation.isPending}>{t(`${k}.retention.release`)}</button>
            {releaseError && <p role="alert" className="text-sm text-red-700 sm:col-span-3">{releaseError}</p>}
            {releaseMutation.isError && <div className="sm:col-span-3"><ErrorBanner message={t(`${k}.error`)} /></div>}
          </form>
        )}
        {!ledgerEntries.length && <p className="text-sm text-gray-600">{t(`${k}.retention.empty`)}</p>}
        {ledgerEntries.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead><tr className="border-b text-left"><th className="p-2">{t(`${k}.retention.date`)}</th><th className="p-2">{t(`${k}.retention.type`)}</th><th className="p-2">{t(`${k}.retention.ledgerDescription`)}</th><th className="p-2 text-right">{t(`${k}.retention.amount`)}</th><th className="p-2">{t(`${k}.retention.invoice`)}</th></tr></thead>
              <tbody>{ledgerEntries.map((entry: ProjectRetentionEntry) => (
                <tr className="border-b" key={entry.id}>
                  <td className="p-2">{new Date(entry.created_at).toLocaleDateString()}</td>
                  <td className="p-2">{t(`${k}.retention.types.${entry.type}`)}</td>
                  <td className="p-2">{entry.description ?? ''}</td>
                  <td className="p-2 text-right">{amount(Number(entry.amount))}</td>
                  <td className="p-2">{entry.invoice?.invoice_number ? t(`${k}.invoiceLabel`, { invoiceNumber: entry.invoice.invoice_number }) : t(`${k}.none`)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md p-2"><span className="block text-xs text-gray-500">{label}</span><strong>{value}</strong></div>;
}

function ValuationCard({
  document,
  boqLines,
  canEdit,
  canSubmit,
  isSubmitting,
  isGenerating,
  onEdit,
  onSubmit,
  onGenerateInvoice,
  t,
}: {
  document: ProjectValuationDocument;
  boqLines: ProjectBoqLine[];
  canEdit: boolean;
  canSubmit: boolean;
  isSubmitting: boolean;
  isGenerating: boolean;
  onEdit: () => void;
  onSubmit: () => void;
  onGenerateInvoice: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const { valuation } = document;
  const lineDetails = document.lines.map((line) => ({
    line,
    boq: boqLines.find((candidate) => candidate.id === line.boq_line_id),
  }));
  return (
    <details className="rounded-xl border bg-white">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 p-4">
        <span className="font-semibold">{t(`${k}.reference`, { number: String(valuation.valuation_number).padStart(3, '0') })} · {new Date(`${valuation.valuation_date}T00:00:00`).toLocaleDateString()}</span>
        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs">{t(`${k}.statuses.${valuation.status}`)}</span>
        <span className="text-sm">{t(`${k}.summary.net`)}: {amount(Number(valuation.net_amount))}</span>
      </summary>
      <div className="space-y-4 border-t p-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <Summary label={t(`${k}.summary.previous`)} value={amount(Number(valuation.previous_cumulative))} />
          <Summary label={t(`${k}.summary.gross`)} value={amount(Number(valuation.gross_amount))} />
          <Summary label={t(`${k}.summary.retention`)} value={amount(Number(valuation.retention_amount))} />
          <Summary label={t(`${k}.summary.net`)} value={amount(Number(valuation.net_amount))} />
        </div>
        {valuation.notes && <p className="whitespace-pre-wrap text-sm text-gray-700">{valuation.notes}</p>}
        <h3 className="font-medium">{t(`${k}.valuationLines`)}</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] border-collapse text-sm">
            <thead><tr className="border-b text-left"><th className="p-2">{t(`${k}.columns.lineNumber`)}</th><th className="p-2">{t(`${k}.columns.description`)}</th><th className="p-2 text-right">{t(`${k}.columns.cumulativePct`)}</th><th className="p-2 text-right">{t(`${k}.columns.previous`)}</th><th className="p-2 text-right">{t(`${k}.columns.cumulativeValue`)}</th><th className="p-2 text-right">{t(`${k}.columns.periodValue`)}</th></tr></thead>
            <tbody>{lineDetails.map(({ line, boq }) => (
              <tr key={line.id} className="border-b">
                <td className="p-2">{boq?.line_number ?? ''}</td>
                <td className="p-2">{boq?.description ?? ''}{line.notes && <span className="block text-xs text-gray-500">{line.notes}</span>}</td>
                <td className="p-2 text-right">{amount(Number(line.cumulative_pct))}%</td>
                <td className="p-2 text-right">{amount(Number(line.previous_cumulative_value))}</td>
                <td className="p-2 text-right">{amount(Number(line.cumulative_value))}</td>
                <td className={`p-2 text-right ${Number(line.period_value) < 0 ? 'text-red-700' : ''}`}>{amount(Number(line.period_value))}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {document.invoice?.invoice_number && <p className="text-sm font-medium">{t(`${k}.invoiceLabel`, { invoiceNumber: document.invoice.invoice_number })}</p>}
        {valuation.status === 'draft' && canEdit && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded-lg border px-4 py-2" onClick={onEdit}>{t(`${k}.edit`)}</button>
            {canSubmit && <button type="button" className={PROJECT_BUTTON} disabled={isSubmitting} onClick={onSubmit}>{t(`${k}.submit`)}</button>}
          </div>
        )}
        {valuation.status === 'submitted' && canSubmit && (
          <button type="button" className={PROJECT_BUTTON} disabled={isGenerating} onClick={onGenerateInvoice}>{t(`${k}.generateInvoice`)}</button>
        )}
      </div>
    </details>
  );
}
