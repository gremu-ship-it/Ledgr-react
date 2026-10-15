import { useRef, useState } from 'react';
import {
  compareMaterialTransferQuantityNotes,
  MATERIAL_TRANSFER_STAGE_LABELS,
  validateMaterialTransferPreparation,
  type LocalMaterialTransferPreparation,
  type MaterialTransferPreparationErrors,
  type MaterialTransferPreparationFields,
  type MaterialTransferPreparationLineField,
  type MaterialTransferPreparationLineFields,
  type MaterialTransferPreparationStage,
} from '@/lib/construction/materialTransferPreparation';

const INPUT_CLASS = 'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const LABEL_CLASS = 'block text-sm font-medium text-gray-800';
const ERROR_CLASS = 'mt-1 text-xs text-red-700';

interface MaterialTransferPreparationSectionProps {
  projectLocalId: number;
  businessId: string;
  projectName: string;
  projectCode: string;
  siteName: string;
  siteLocation: string;
  preparations: LocalMaterialTransferPreparation[];
  onSave: (
    fields: MaterialTransferPreparationFields,
    localId: number | undefined,
    stage: MaterialTransferPreparationStage,
  ) => number | null;
  onDiscard: (localId: number) => void;
}

type SectionView =
  | { mode: 'list' }
  | { mode: 'form'; localId?: number; targetStage: MaterialTransferPreparationStage }
  | { mode: 'detail'; localId: number };

function newLine(lineLocalKey: number): MaterialTransferPreparationLineFields {
  return {
    lineLocalKey,
    materialDescription: '',
    itemCodeNote: '',
    unitNote: '',
    quantityRequested: '',
    quantityDispatched: '',
    quantityReceived: '',
    exceptionNote: '',
  };
}

function emptyFields(siteName: string, siteLocation: string): MaterialTransferPreparationFields {
  return {
    transferReferenceNote: '',
    sourceDocumentReference: '',
    transferDate: '',
    sourceStoreNote: '',
    destinationSiteNote: [siteName, siteLocation].map((value) => value.trim()).filter(Boolean).join(' · '),
    dispatchDate: '',
    dispatchNote: '',
    receiptDate: '',
    receiptNote: '',
    lines: [newLine(1)],
  };
}

function fieldsFromPreparation(preparation: LocalMaterialTransferPreparation): MaterialTransferPreparationFields {
  return {
    transferReferenceNote: preparation.transferReferenceNote,
    sourceDocumentReference: preparation.sourceDocumentReference,
    transferDate: preparation.transferDate,
    sourceStoreNote: preparation.sourceStoreNote,
    destinationSiteNote: preparation.destinationSiteNote,
    dispatchDate: preparation.dispatchDate,
    dispatchNote: preparation.dispatchNote,
    receiptDate: preparation.receiptDate,
    receiptNote: preparation.receiptNote,
    lines: preparation.lines.map((line) => ({ ...line })),
  };
}

function stageHint(stage: MaterialTransferPreparationStage): string {
  switch (stage) {
    case 'draft':
      return 'A local request note only; no stock is reserved or moved.';
    case 'prepared':
      return 'Prepared in this tab only; this is not an approval or a saved transfer.';
    case 'dispatch_noted':
      return 'Dispatch quantities are notes only; source stock was not decreased and no in-transit balance was created.';
    case 'receipt_noted':
      return 'Receipt quantities are notes only; destination stock was not increased and no discrepancy adjustment was posted.';
  }
}

function targetStageLabel(stage: MaterialTransferPreparationStage): string {
  switch (stage) {
    case 'draft': return 'Keep local transfer draft';
    case 'prepared': return 'Mark prepared in this tab';
    case 'dispatch_noted': return 'Save dispatch observation in this tab';
    case 'receipt_noted': return 'Save receipt observation in this tab';
  }
}

function observationComparison(line: MaterialTransferPreparationLineFields): string | null {
  if (!line.quantityDispatched || !line.quantityReceived) return null;
  const comparison = compareMaterialTransferQuantityNotes(line.quantityReceived, line.quantityDispatched);
  if (comparison === null) return null;
  if (comparison < 0) return 'Receipt note is below the dispatch note; review the difference. No adjustment is recorded.';
  if (comparison === 0) return 'Receipt note matches the dispatch quantity note.';
  return 'Receipt note exceeds dispatch quantity; this should not pass local validation.';
}

export function MaterialTransferPreparationSection({
  projectLocalId,
  businessId,
  projectName,
  projectCode,
  siteName,
  siteLocation,
  preparations,
  onSave,
  onDiscard,
}: MaterialTransferPreparationSectionProps) {
  const [view, setView] = useState<SectionView>({ mode: 'list' });
  const [fields, setFields] = useState<MaterialTransferPreparationFields>(() => emptyFields(siteName, siteLocation));
  const [errors, setErrors] = useState<MaterialTransferPreparationErrors>({});
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const nextLineKey = useRef(2);

  const projectPreparations = preparations.filter((preparation) =>
    preparation.projectLocalId === projectLocalId && preparation.businessId === businessId,
  );
  const selectedPreparation = view.mode === 'detail' || view.mode === 'form'
    ? projectPreparations.find((preparation) => preparation.localId === view.localId)
    : undefined;
  const showDispatchFields = view.mode === 'form'
    && (view.targetStage === 'dispatch_noted' || view.targetStage === 'receipt_noted'
      || fields.lines.some((line) => Boolean(line.quantityDispatched)));
  const showReceiptFields = view.mode === 'form'
    && (view.targetStage === 'receipt_noted' || fields.lines.some((line) => Boolean(line.quantityReceived)));

  function startNew() {
    saveLock.current = false;
    setSaving(false);
    nextLineKey.current = 2;
    setFields(emptyFields(siteName, siteLocation));
    setErrors({});
    setSaveError('');
    setView({ mode: 'form', targetStage: 'draft' });
  }

  function editPreparation(
    preparation: LocalMaterialTransferPreparation,
    targetStage: MaterialTransferPreparationStage,
  ) {
    saveLock.current = false;
    setSaving(false);
    const preparationFields = fieldsFromPreparation(preparation);
    nextLineKey.current = Math.max(0, ...preparationFields.lines.map((line) => line.lineLocalKey)) + 1;
    setFields(preparationFields);
    setErrors({});
    setSaveError('');
    setView({ mode: 'form', localId: preparation.localId, targetStage });
  }

  function updateField(
    field: 'transferReferenceNote' | 'sourceDocumentReference' | 'transferDate' | 'sourceStoreNote'
      | 'destinationSiteNote' | 'dispatchDate' | 'dispatchNote' | 'receiptDate' | 'receiptNote',
    value: string,
  ) {
    setFields((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (field === 'transferReferenceNote' || field === 'sourceDocumentReference' || field === 'dispatchNote' || field === 'receiptNote') {
        return current;
      }
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function updateLine(
    lineLocalKey: number,
    field: MaterialTransferPreparationLineField,
    value: string,
  ) {
    setFields((current) => ({
      ...current,
      lines: current.lines.map((line) => line.lineLocalKey === lineLocalKey ? { ...line, [field]: value } : line),
    }));
    setErrors((current) => {
      const lineErrors = current.lines?.[lineLocalKey];
      if (!lineErrors) return current;
      const nextLineErrors = { ...lineErrors };
      const fieldsToClear: MaterialTransferPreparationLineField[] = [
        'quantityRequested', 'quantityDispatched', 'quantityReceived',
      ].includes(field) ? ['quantityRequested', 'quantityDispatched', 'quantityReceived'] : [field];
      for (const fieldToClear of fieldsToClear) delete nextLineErrors[fieldToClear];
      const nextLines = { ...current.lines, [lineLocalKey]: nextLineErrors };
      if (Object.keys(nextLineErrors).length === 0) delete nextLines[lineLocalKey];
      if (Object.keys(nextLines).length === 0) {
        const nextErrors = { ...current };
        delete nextErrors.lines;
        return nextErrors;
      }
      return { ...current, lines: nextLines };
    });
  }

  function savePreparation(stage: MaterialTransferPreparationStage) {
    if (saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    setSaveError('');

    const validation = validateMaterialTransferPreparation(fields, stage);
    if (!validation.values) {
      setErrors(validation.errors);
      saveLock.current = false;
      setSaving(false);
      return;
    }

    const localId = onSave(validation.values, view.mode === 'form' ? view.localId : undefined, stage);
    if (localId === null) {
      setSaveError('This local project context is no longer available. Return to the workspace and try again.');
      saveLock.current = false;
      setSaving(false);
      return;
    }

    setErrors({});
    setView({ mode: 'detail', localId });
    setSaving(false);
  }

  function discardPreparation(preparation: LocalMaterialTransferPreparation) {
    onDiscard(preparation.localId);
    setSaveError('Local transfer preparation discarded. No inventory record was changed.');
    setView({ mode: 'list' });
  }

  function openDetail(preparation: LocalMaterialTransferPreparation) {
    setSaveError('');
    setView({ mode: 'detail', localId: preparation.localId });
  }

  function beginNextStage(preparation: LocalMaterialTransferPreparation) {
    const targetStage: MaterialTransferPreparationStage = preparation.stage === 'draft'
      ? 'prepared'
      : preparation.stage === 'prepared'
        ? 'dispatch_noted'
        : 'receipt_noted';
    editPreparation(preparation, targetStage);
  }

  return (
    <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="construction-transfer-preparation-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="construction-transfer-preparation-title" className="text-lg font-semibold text-gray-900">Store-to-site transfer preparation</h3>
          <p className="mt-1 text-sm text-gray-600">Project: {projectName}{projectCode ? ` · ${projectCode}` : ''}</p>
        </div>
        {view.mode === 'list' && (
          <button type="button" onClick={startNew} className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800">
            Prepare transfer note
          </button>
        )}
      </div>

      <div role="note" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
        <strong>Local workflow only — not an inventory transfer.</strong> Source store, destination site, and material labels are free-text notes, not verified Ledgr locations or items.
        These notes do not reserve stock, approve a transfer, decrease or increase balances, create in-transit stock, or post accounting. They exist only in this page session.
      </div>

      {saveError && (
        <p role="status" aria-live="polite" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {saveError}
        </p>
      )}

      {view.mode === 'list' && (
        <div className="space-y-3">
          {projectPreparations.length === 0 ? (
            <p role="status" className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-5 text-sm text-gray-600">
              No store-to-site transfer preparations for this local project in this tab.
            </p>
          ) : (
            <ul className="space-y-2" aria-label="Local store-to-site transfer preparations">
              {projectPreparations.map((preparation) => (
                <li key={preparation.localId}>
                  <button
                    type="button"
                    onClick={() => openDetail(preparation)}
                    aria-label={`View transfer preparation ${preparation.transferReferenceNote || preparation.localId}`}
                    className="flex w-full flex-col gap-1 rounded-xl border border-gray-200 px-4 py-3 text-left hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="font-medium text-gray-900">
                      {preparation.transferReferenceNote || 'Transfer note'} · {preparation.sourceStoreNote} → {preparation.destinationSiteNote}
                    </span>
                    <span className="text-xs text-gray-600">{MATERIAL_TRANSFER_STAGE_LABELS[preparation.stage]} · {preparation.lines.length} line{preparation.lines.length === 1 ? '' : 's'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {view.mode === 'form' && (
        <form
          noValidate
          onSubmit={(event) => { event.preventDefault(); savePreparation('draft'); }}
          className="space-y-5 rounded-xl border border-gray-200 bg-gray-50 p-4"
        >
          <div>
            <button type="button" onClick={() => { setErrors({}); setView({ mode: 'list' }); }} className="text-sm font-medium text-gray-600 hover:text-gray-900">
              ← Back to transfer preparations
            </button>
            <h4 className="mt-2 font-semibold text-gray-900">
              {view.localId === undefined ? 'New transfer preparation' : 'Edit transfer preparation'}
            </h4>
            <p className="mt-1 text-xs leading-5 text-gray-600">A local reference helps identify this note only; no stored transfer number or source document is checked.</p>
          </div>

          {Object.keys(errors).length > 0 && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              Correct the highlighted fields before saving this local transfer note.
            </p>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <TransferTextField
              id="transfer-reference-note"
              label="Transfer reference note"
              value={fields.transferReferenceNote}
              onChange={(value) => updateField('transferReferenceNote', value)}
              help="Optional local label; it is not generated or reserved by Ledgr."
            />
            <TransferTextField
              id="transfer-source-document-reference"
              label="Source document reference note"
              value={fields.sourceDocumentReference}
              onChange={(value) => updateField('sourceDocumentReference', value)}
              help="Optional free-text note; no requisition or other source record is linked."
            />
            <TransferTextField
              id="transfer-planned-date"
              label="Transfer date note"
              type="date"
              value={fields.transferDate}
              onChange={(value) => updateField('transferDate', value)}
              error={errors.transferDate}
            />
            <TransferTextField
              id="transfer-source-store"
              label="Source store or location note"
              value={fields.sourceStoreNote}
              onChange={(value) => updateField('sourceStoreNote', value)}
              error={errors.sourceStoreNote}
              help="Free text only; not checked against business, branch, or inventory-location scope."
            />
            <div className="md:col-span-2">
              <TransferTextField
                id="transfer-destination-site"
                label="Destination site or location note"
                value={fields.destinationSiteNote}
                onChange={(value) => updateField('destinationSiteNote', value)}
                error={errors.destinationSiteNote}
                help="Prefilled from the local project brief when available; not a verified branch or inventory location."
              />
            </div>
          </div>

          {showDispatchFields && (
            <div className="grid gap-4 rounded-xl border border-blue-100 bg-blue-50/50 p-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <h5 className="font-semibold text-gray-900">Dispatch observation · local note only</h5>
                <p className="text-xs text-gray-600">Entering quantities here does not dispatch stock or create an in-transit balance.</p>
              </div>
              <TransferTextField
                id="transfer-dispatch-date"
                label="Dispatch date note"
                type="date"
                value={fields.dispatchDate}
                onChange={(value) => updateField('dispatchDate', value)}
                error={errors.dispatchDate}
              />
              <TransferTextField
                id="transfer-dispatch-note"
                label="Dispatch note"
                value={fields.dispatchNote}
                onChange={(value) => updateField('dispatchNote', value)}
              />
            </div>
          )}

          {showReceiptFields && (
            <div className="grid gap-4 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <h5 className="font-semibold text-gray-900">Destination receipt observation · local note only</h5>
                <p className="text-xs text-gray-600">A quantity difference is shown for review only; no stock adjustment or receipt posting occurs.</p>
              </div>
              <TransferTextField
                id="transfer-receipt-date"
                label="Receipt date note"
                type="date"
                value={fields.receiptDate}
                onChange={(value) => updateField('receiptDate', value)}
                error={errors.receiptDate}
              />
              <TransferTextField
                id="transfer-receipt-note"
                label="Receipt note"
                value={fields.receiptNote}
                onChange={(value) => updateField('receiptNote', value)}
              />
            </div>
          )}

          <div className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h5 className="font-semibold text-gray-900">Material lines</h5>
                <p className="text-xs text-gray-600">Requested, dispatched, and received quantities are unverified local observations.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const lineLocalKey = nextLineKey.current;
                  nextLineKey.current += 1;
                  setFields((current) => ({ ...current, lines: [...current.lines, newLine(lineLocalKey)] }));
                  setErrors({});
                }}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                Add material line
              </button>
            </div>

            {errors.form && <p role="alert" className="text-sm text-red-700">{errors.form}</p>}

            {fields.lines.map((line, index) => {
              const lineErrors = errors.lines?.[line.lineLocalKey];
              const lineId = line.lineLocalKey;
              return (
                <fieldset key={lineId} className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
                  <legend className="px-1 text-sm font-semibold text-gray-800">Material line {index + 1}</legend>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <TransferTextField
                      id={`transfer-line-${lineId}-description`}
                      label="Material description"
                      value={line.materialDescription}
                      onChange={(value) => updateLine(lineId, 'materialDescription', value)}
                      error={lineErrors?.materialDescription}
                    />
                    <TransferTextField
                      id={`transfer-line-${lineId}-item-code`}
                      label="Item or code note"
                      value={line.itemCodeNote}
                      onChange={(value) => updateLine(lineId, 'itemCodeNote', value)}
                      help="Optional note; not checked against the item catalogue."
                    />
                    <TransferTextField
                      id={`transfer-line-${lineId}-unit`}
                      label="Unit note"
                      value={line.unitNote}
                      onChange={(value) => updateLine(lineId, 'unitNote', value)}
                      error={lineErrors?.unitNote}
                    />
                    <TransferTextField
                      id={`transfer-line-${lineId}-requested`}
                      label="Requested quantity"
                      type="number"
                      min="0"
                      step="any"
                      value={line.quantityRequested}
                      onChange={(value) => updateLine(lineId, 'quantityRequested', value)}
                      error={lineErrors?.quantityRequested}
                    />
                    {showDispatchFields && (
                      <TransferTextField
                        id={`transfer-line-${lineId}-dispatched`}
                        label="Dispatched quantity note"
                        type="number"
                        min="0"
                        step="any"
                        value={line.quantityDispatched}
                        onChange={(value) => updateLine(lineId, 'quantityDispatched', value)}
                        error={lineErrors?.quantityDispatched}
                        help="Leave blank if this line was not dispatched in the observation."
                      />
                    )}
                    {showReceiptFields && (
                      <TransferTextField
                        id={`transfer-line-${lineId}-received`}
                        label="Received quantity note"
                        type="number"
                        min="0"
                        step="any"
                        value={line.quantityReceived}
                        onChange={(value) => updateLine(lineId, 'quantityReceived', value)}
                        error={lineErrors?.quantityReceived}
                        help="Zero is a recorded observation; blank is not assessed."
                      />
                    )}
                  </div>
                  <TransferTextField
                    id={`transfer-line-${lineId}-exception`}
                    label="Difference or condition note"
                    value={line.exceptionNote}
                    onChange={(value) => updateLine(lineId, 'exceptionNote', value)}
                    help="Optional note only; no damage, shortage, loss, or accounting classification is inferred."
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setFields((current) => ({
                        ...current,
                        lines: current.lines.filter((candidate) => candidate.lineLocalKey !== lineId),
                      }));
                      setErrors({});
                    }}
                    className="text-xs font-medium text-red-700 underline"
                  >
                    Remove material line {index + 1}
                  </button>
                </fieldset>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-2 border-t border-gray-200 pt-4">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50"
            >
              Save local transfer draft
            </button>
            <button
              type="button"
              onClick={() => savePreparation(view.targetStage === 'draft' ? 'prepared' : view.targetStage)}
              disabled={saving}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
            >
              {saving ? 'Keeping transfer note…' : targetStageLabel(view.targetStage === 'draft' ? 'prepared' : view.targetStage)}
            </button>
            <button
              type="button"
              onClick={() => { setErrors({}); setSaveError(''); setView({ mode: 'list' }); }}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-white"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {view.mode === 'detail' && selectedPreparation && (
        <TransferPreparationDetails
          preparation={selectedPreparation}
          onNextStage={() => beginNextStage(selectedPreparation)}
          onEdit={() => editPreparation(selectedPreparation, selectedPreparation.stage)}
          onDiscard={() => discardPreparation(selectedPreparation)}
        />
      )}
      {view.mode === 'detail' && !selectedPreparation && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          This local transfer preparation is no longer available. Return to the list and try again.
          <button type="button" onClick={() => setView({ mode: 'list' })} className="ml-2 font-semibold underline">Back to transfer preparations</button>
        </p>
      )}
    </section>
  );
}

function TransferTextField({
  id,
  label,
  value,
  onChange,
  type = 'text',
  min,
  step,
  error,
  help,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'date' | 'number';
  min?: string;
  step?: string;
  error?: string;
  help?: string;
}) {
  const errorId = `${id}-error`;
  const helpId = `${id}-help`;
  return (
    <div>
      <label className={LABEL_CLASS} htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        min={min}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : help ? helpId : undefined}
        className={`${INPUT_CLASS} ${error ? 'border-red-400 focus:border-red-500 focus:ring-red-100' : ''}`}
      />
      {help && !error && <p id={helpId} className="mt-1 text-xs text-gray-500">{help}</p>}
      {error && <p id={errorId} className={ERROR_CLASS}>{error}</p>}
    </div>
  );
}

function TransferPreparationDetails({
  preparation,
  onNextStage,
  onEdit,
  onDiscard,
}: {
  preparation: LocalMaterialTransferPreparation;
  onNextStage: () => void;
  onEdit: () => void;
  onDiscard: () => void;
}) {
  const stageHintText = stageHint(preparation.stage);
  const nextAction = preparation.stage === 'draft'
    ? 'Continue to prepare'
    : preparation.stage === 'prepared'
      ? 'Add dispatch observation'
      : preparation.stage === 'dispatch_noted'
        ? 'Add receipt observation'
        : 'Review receipt observation';

  return (
    <div data-testid="material-transfer-preparation-detail" className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">{MATERIAL_TRANSFER_STAGE_LABELS[preparation.stage]}</p>
          <h4 className="mt-1 text-lg font-semibold text-gray-900">{preparation.transferReferenceNote || 'Transfer preparation'}</h4>
          <p className="mt-1 text-sm text-gray-600">{preparation.sourceStoreNote} → {preparation.destinationSiteNote}</p>
        </div>
        <p className="text-xs text-gray-500">{preparation.transferDate || 'Transfer date not added'}</p>
      </div>

      {preparation.sourceDocumentReference && (
        <p className="text-sm text-gray-700"><span className="font-semibold">Source document note:</span> {preparation.sourceDocumentReference}</p>
      )}
      {(preparation.dispatchDate || preparation.dispatchNote) && (
        <p className="text-sm text-gray-700">
          <span className="font-semibold">Dispatch observation:</span>{' '}
          {preparation.dispatchDate ? `Date note: ${preparation.dispatchDate}` : 'Date not added'}
          {preparation.dispatchNote ? ` · ${preparation.dispatchNote}` : ''}
        </p>
      )}
      {(preparation.receiptDate || preparation.receiptNote) && (
        <p className="text-sm text-gray-700">
          <span className="font-semibold">Receipt observation:</span>{' '}
          {preparation.receiptDate ? `Date note: ${preparation.receiptDate}` : 'Date not added'}
          {preparation.receiptNote ? ` · ${preparation.receiptNote}` : ''}
        </p>
      )}
      <p role="note" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">{stageHintText}</p>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-[820px] w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Material note</th>
              <th className="px-3 py-2">Unit</th>
              <th className="px-3 py-2 text-right">Requested</th>
              <th className="px-3 py-2 text-right">Dispatched note</th>
              <th className="px-3 py-2 text-right">Received note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {preparation.lines.map((line) => (
              <tr key={line.lineLocalKey}>
                <td className="px-3 py-2">
                  <span className="font-medium text-gray-900">{line.materialDescription}</span>
                  {line.itemCodeNote && <span className="block text-xs text-gray-500">Code note: {line.itemCodeNote}</span>}
                  {line.exceptionNote && <span className="block text-xs text-amber-800">Difference note: {line.exceptionNote}</span>}
                  {observationComparison(line) && <span className="block text-xs text-amber-800">{observationComparison(line)}</span>}
                </td>
                <td className="px-3 py-2 text-gray-700">{line.unitNote}</td>
                <td className="px-3 py-2 text-right text-gray-700">{line.quantityRequested}</td>
                <td className="px-3 py-2 text-right text-gray-700">{line.quantityDispatched || 'Not noted'}</td>
                <td className="px-3 py-2 text-right text-gray-700">{line.quantityReceived || 'Not noted'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-3">
        {preparation.stage !== 'receipt_noted' && (
          <button type="button" onClick={onNextStage} className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800">{nextAction}</button>
        )}
        <button type="button" onClick={onEdit} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">Edit local note</button>
        <button type="button" onClick={onDiscard} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50">Discard preparation</button>
      </div>
    </div>
  );
}
